import { describe, it, expect, afterEach } from "vitest";
import { createSqliteProductTemplateStore, createSqliteItemStore } from "@mezan/persistence";
import { createProductTemplatesRoutes, type ProductTemplatesRoutesDeps } from "./product-templates-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

async function newApp() {
  const store = createSqliteProductTemplateStore();
  const items = createSqliteItemStore();
  closers.push(store, items);

  let n = 0;
  const deps: ProductTemplatesRoutesDeps = {
    templates: store.templates,
    variants: store.variants,
    items,
    idGen: () => `id-${++n}`,
  };

  return { app: createProductTemplatesRoutes(deps, insecureHeaderAuthContextResolver), store, items };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const templatePayload = { code: "TSHIRT", nameAr: "تيشيرت", baseUnitCode: "PCS", defaultSalePrice: "150.00", defaultCost: "80.00" };

describe("product-templates router — permission gate", () => {
  it("rejects GET / with no permissions", async () => {
    const h = await newApp();
    const res = await h.app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("inventory.template.view");
  });

  it("rejects POST /:id/variants/generate with only manage permission (needs .generate)", async () => {
    const h = await newApp();
    const created = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify(templatePayload) }));
    const template = (await created.json()) as { id: string };
    const res = await h.app.fetch(
      req(`/${template.id}/variants/generate`, { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify({ selections: [] }) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("product-templates router — template + attribute CRUD", () => {
  it("creates a template and 409s a duplicate code", async () => {
    const h = await newApp();
    const created = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify(templatePayload) }));
    expect(created.status).toBe(201);
    const body = (await created.json()) as { attributes: unknown[]; defaultSalePrice: string };
    expect(body.attributes).toEqual([]);
    expect(body.defaultSalePrice).toBe("150.000000");

    const dup = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify(templatePayload) }));
    expect(dup.status).toBe(409);
  });

  it("adds an attribute and a value, then guards deleting the value/attribute once a variant exists", async () => {
    const h = await newApp();
    const created = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify(templatePayload) }));
    const template = (await created.json()) as { id: string };

    const withAttr = await h.app.fetch(
      req(`/${template.id}/attributes`, { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify({ nameAr: "اللون", values: ["أحمر", "أزرق"] }) }),
    );
    expect(withAttr.status).toBe(201);
    const templateWithAttr = (await withAttr.json()) as { attributes: { id: string; values: string[] }[] };
    const attributeId = templateWithAttr.attributes[0]!.id;
    expect(templateWithAttr.attributes[0]!.values).toEqual(["أحمر", "أزرق"]);

    const withValue = await h.app.fetch(
      req(`/${template.id}/attributes/${attributeId}/values`, { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify({ value: "أخضر" }) }),
    );
    expect(withValue.status).toBe(201);

    const genRes = await h.app.fetch(
      req(`/${template.id}/variants/generate`, {
        method: "POST",
        permissions: "inventory.template.generate",
        body: JSON.stringify({ selections: [{ values: { [attributeId]: "أحمر" } }] }),
      }),
    );
    expect(genRes.status).toBe(201);
    const genBody = (await genRes.json()) as { created: { itemId: string; itemCode: string }[]; skippedExisting: number };
    expect(genBody.created).toHaveLength(1);
    expect(genBody.created[0]!.itemCode).toBe("TSHIRT-أحمر");

    const deleteValueRes = await h.app.fetch(
      req(`/${template.id}/attributes/${attributeId}/values/${encodeURIComponent("أحمر")}`, { method: "DELETE", permissions: "inventory.template.manage" }),
    );
    expect(deleteValueRes.status).toBe(409);

    const deleteAttrRes = await h.app.fetch(
      req(`/${template.id}/attributes/${attributeId}`, { method: "DELETE", permissions: "inventory.template.manage" }),
    );
    expect(deleteAttrRes.status).toBe(409);

    // an unused value deletes cleanly
    const deleteUnusedRes = await h.app.fetch(
      req(`/${template.id}/attributes/${attributeId}/values/${encodeURIComponent("أخضر")}`, { method: "DELETE", permissions: "inventory.template.manage" }),
    );
    expect(deleteUnusedRes.status).toBe(200);
  });
});

describe("product-templates router — variant generation is idempotent", () => {
  it("skips a combination already generated on a second call, and lists variants", async () => {
    const h = await newApp();
    const created = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify(templatePayload) }));
    const template = (await created.json()) as { id: string };
    const withAttr = await h.app.fetch(
      req(`/${template.id}/attributes`, { method: "POST", permissions: "inventory.template.manage", body: JSON.stringify({ nameAr: "المقاس", values: ["S", "M"] }) }),
    );
    const templateWithAttr = (await withAttr.json()) as { attributes: { id: string }[] };
    const attributeId = templateWithAttr.attributes[0]!.id;

    await h.app.fetch(
      req(`/${template.id}/variants/generate`, {
        method: "POST",
        permissions: "inventory.template.generate",
        body: JSON.stringify({ selections: [{ values: { [attributeId]: "S" } }] }),
      }),
    );
    const second = await h.app.fetch(
      req(`/${template.id}/variants/generate`, {
        method: "POST",
        permissions: "inventory.template.generate",
        body: JSON.stringify({ selections: [{ values: { [attributeId]: "S" } }, { values: { [attributeId]: "M" } }] }),
      }),
    );
    const secondBody = (await second.json()) as { created: unknown[]; skippedExisting: number };
    expect(secondBody.created).toHaveLength(1);
    expect(secondBody.skippedExisting).toBe(1);

    const listRes = await h.app.fetch(req(`/${template.id}/variants`, { permissions: "inventory.template.view" }));
    const list = (await listRes.json()) as unknown[];
    expect(list).toHaveLength(2);
  });

  it("GET /:id 404s an unknown template", async () => {
    const h = await newApp();
    const res = await h.app.fetch(req("/nope", { permissions: "inventory.template.view" }));
    expect(res.status).toBe(404);
  });
});
