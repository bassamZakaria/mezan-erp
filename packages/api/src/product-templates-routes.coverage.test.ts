import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteProductTemplateStore,
  createSqliteItemStore,
  createSqliteItemSpecificationStore,
} from "@mezan/persistence";
import { createProductTemplatesRoutes, type ProductTemplatesRoutesDeps } from "./product-templates-routes.js";

const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

async function newApp(opts: { withSpecifications?: boolean } = {}) {
  const store = createSqliteProductTemplateStore();
  const items = createSqliteItemStore();
  const specStore = createSqliteItemSpecificationStore();
  closers.push(store, items, specStore);

  if (opts.withSpecifications) {
    await specStore.specifications.create({
      code: "COLOR",
      nameAr: "اللون",
      nameEn: "Colour",
      type: "select",
      values: ["أحمر", "أزرق"],
      unit: null,
      filterable: true,
      status: "active",
    });
  }

  let n = 0;
  const deps: ProductTemplatesRoutesDeps = {
    templates: store.templates,
    variants: store.variants,
    items,
    specifications: opts.withSpecifications ? specStore.specifications : undefined,
    idGen: () => `id-${++n}`,
  };
  return { app: createProductTemplatesRoutes(deps), store, items };
}

type App = Awaited<ReturnType<typeof newApp>>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(app: App, method: string, path: string, payload?: unknown, permissions?: string) {
  return app.fetch(
    req(path, { method, permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const template = {
  code: "TSHIRT",
  nameAr: "تيشيرت",
  baseUnitCode: "PCS",
  defaultSalePrice: "150.00",
  defaultCost: "80.00",
};

interface Template {
  id: string;
  code: string;
  defaultSalePrice: string | null;
  defaultCost: string | null;
  attributes: Array<{ id: string; nameAr: string; values: string[]; specificationCode: string | null }>;
}

describe("product-templates-routes — templates", () => {
  it("keeps an omitted price and cost null rather than inventing a zero", async () => {
    const { app } = await newApp();
    const created = await json<Template>(
      await send(app, "POST", "/", { code: "PLAIN", nameAr: "بسيط", baseUnitCode: "PCS" }),
    );
    expect(created.defaultSalePrice).toBeNull();
    expect(created.defaultCost).toBeNull();
  });

  it("carries a supplied price and cost through exactly", async () => {
    const { app } = await newApp();
    const created = await json<Template>(await send(app, "POST", "/", template));
    expect(created.defaultSalePrice).toBe("150.000000");
    expect(created.defaultCost).toBe("80.000000");
  });

  it("400s a create body the schema rejects and lists what it stored", async () => {
    const { app } = await newApp();
    expect((await send(app, "POST", "/", { nameAr: "بلا كود" })).status).toBe(400);
    await send(app, "POST", "/", template);
    expect(await json<unknown[]>(await send(app, "GET", "/"))).toHaveLength(1);
  });
});

describe("product-templates-routes — attributes built by hand or from المواصفات", () => {
  async function withTemplate(app: App) {
    return json<Template>(await send(app, "POST", "/", template));
  }

  it("400s an attribute that names neither its own values nor a specification", async () => {
    const { app } = await newApp();
    const t = await withTemplate(app);
    const res = await send(app, "POST", `/${t.id}/attributes`, { nameAr: "المقاس" });
    expect(res.status).toBe(400);
    expect((await json<{ message: string }>(res)).message).toBe("اسم الخاصية وقيمها مطلوبة.");
  });

  it("400s an attribute body the schema rejects", async () => {
    const { app } = await newApp();
    const t = await withTemplate(app);
    expect((await send(app, "POST", `/${t.id}/attributes`, { values: [] })).status).toBe(400);
  });

  it("builds an attribute out of a registry specification, keeping its code", async () => {
    const { app } = await newApp({ withSpecifications: true });
    const t = await withTemplate(app);

    const res = await send(app, "POST", `/${t.id}/attributes`, { specificationCode: "COLOR" });
    expect(res.status).toBe(201);
    const next = await json<Template>(res);
    expect(next.attributes[0]).toMatchObject({
      nameAr: "اللون",
      values: ["أحمر", "أزرق"],
      specificationCode: "COLOR",
    });
  });

  it("lets the request's own values override the registry's while keeping its name", async () => {
    const { app } = await newApp({ withSpecifications: true });
    const t = await withTemplate(app);

    const next = await json<Template>(
      await send(app, "POST", `/${t.id}/attributes`, { specificationCode: "COLOR", values: ["أخضر"] }),
    );
    expect(next.attributes[0]).toMatchObject({ nameAr: "اللون", values: ["أخضر"], specificationCode: "COLOR" });
  });

  it("404s an attribute naming a specification the registry does not hold", async () => {
    const { app } = await newApp({ withSpecifications: true });
    const t = await withTemplate(app);

    const res = await send(app, "POST", `/${t.id}/attributes`, { specificationCode: "GHOST" });
    expect(res.status).toBe(404);
    expect((await json<{ error: string }>(res)).error).toBe("ITEM_SPECIFICATION_NOT_FOUND");
  });

  it("404s a specification-built attribute when no registry is mounted at all", async () => {
    const { app } = await newApp();
    const t = await withTemplate(app);
    expect((await send(app, "POST", `/${t.id}/attributes`, { specificationCode: "COLOR" })).status).toBe(404);
  });

  it("records an attribute typed out by hand with no specification code", async () => {
    const { app } = await newApp({ withSpecifications: true });
    const t = await withTemplate(app);

    const next = await json<Template>(
      await send(app, "POST", `/${t.id}/attributes`, { nameAr: "المقاس", nameEn: "Size", values: ["S", "M"] }),
    );
    expect(next.attributes[0]).toMatchObject({ nameAr: "المقاس", specificationCode: null });
  });

  it("409s a second attribute with the same name, and a duplicate value on one attribute", async () => {
    const { app } = await newApp();
    const t = await withTemplate(app);
    const withAttr = await json<Template>(
      await send(app, "POST", `/${t.id}/attributes`, { nameAr: "المقاس", values: ["S"] }),
    );
    const attributeId = withAttr.attributes[0]!.id;

    expect((await send(app, "POST", `/${t.id}/attributes`, { nameAr: "المقاس", values: ["L"] })).status).toBe(409);
    expect((await send(app, "POST", `/${t.id}/attributes/${attributeId}/values`, { value: "S" })).status).toBe(409);
  });

  it("404s every attribute action naming a template or an attribute that is gone", async () => {
    const { app } = await newApp();
    const t = await withTemplate(app);

    expect((await send(app, "POST", "/nope/attributes", { nameAr: "x", values: ["1"] })).status).toBe(404);
    expect((await send(app, "DELETE", `/${t.id}/attributes/ghost`)).status).toBe(404);
    expect((await send(app, "POST", `/${t.id}/attributes/ghost/values`, { value: "S" })).status).toBe(404);
    expect((await send(app, "DELETE", `/${t.id}/attributes/ghost/values/S`)).status).toBe(404);
  });

  it("adds and removes a value, and decodes one that had to be percent-encoded", async () => {
    const { app } = await newApp();
    const t = await withTemplate(app);
    const withAttr = await json<Template>(
      await send(app, "POST", `/${t.id}/attributes`, { nameAr: "اللون", values: ["أحمر"] }),
    );
    const attributeId = withAttr.attributes[0]!.id;

    const added = await json<Template>(
      await send(app, "POST", `/${t.id}/attributes/${attributeId}/values`, { value: "أزرق" }),
    );
    expect(added.attributes[0]!.values).toEqual(["أحمر", "أزرق"]);

    const removed = await json<Template>(
      await send(app, "DELETE", `/${t.id}/attributes/${attributeId}/values/${encodeURIComponent("أزرق")}`),
    );
    expect(removed.attributes[0]!.values).toEqual(["أحمر"]);
  });

  it("removes a whole attribute while no variant depends on it", async () => {
    const { app } = await newApp();
    const t = await withTemplate(app);
    const withAttr = await json<Template>(
      await send(app, "POST", `/${t.id}/attributes`, { nameAr: "المقاس", values: ["S"] }),
    );
    const removed = await json<Template>(
      await send(app, "DELETE", `/${t.id}/attributes/${withAttr.attributes[0]!.id}`),
    );
    expect(removed.attributes).toEqual([]);
  });
});

describe("product-templates-routes — generating variants", () => {
  it("422s a generate on a template with no attributes at all", async () => {
    const { app } = await newApp();
    const t = await json<Template>(await send(app, "POST", "/", template));
    const res = await send(app, "POST", `/${t.id}/variants/generate`, { selections: [{ values: {} }] });
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("NO_ATTRIBUTES_DEFINED");
  });

  it("400s a generate body the schema rejects, and 404s an unknown template", async () => {
    const { app } = await newApp();
    expect((await send(app, "POST", "/nope/variants/generate", {})).status).toBe(400);
    expect((await send(app, "POST", "/nope/variants/generate", { selections: [] })).status).toBe(400);
    expect((await send(app, "POST", "/nope/variants/generate", { selections: [{ values: {} }] })).status).toBe(404);
  });

  it("lists no variants for a template that has generated none", async () => {
    const { app } = await newApp();
    const t = await json<Template>(await send(app, "POST", "/", template));
    expect(await json<unknown[]>(await send(app, "GET", `/${t.id}/variants`))).toEqual([]);
  });

  it("403s each surface for a caller holding only the neighbouring permission", async () => {
    const { app } = await newApp();
    expect((await send(app, "POST", "/", template, "inventory.template.view")).status).toBe(403);
    expect((await send(app, "GET", "/", undefined, "inventory.item.view")).status).toBe(403);
    expect((await send(app, "DELETE", "/t/attributes/a", undefined, "inventory.template.view")).status).toBe(403);
  });
});
