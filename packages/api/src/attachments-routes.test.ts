import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createSqliteAttachmentStore, type SqliteAttachmentStoreHandle } from "@mezan/persistence";
import { ATTACHMENT_MAX_BYTES, AttachmentPermission, QuotaKind, SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE, createEntitlements } from "@mezan/domain";
import { createAttachmentsRoutes } from "./attachments-routes.js";
import { entitlementsBinding } from "./module-gate.js";
import { createPlanUsageRoutes } from "./plan-usage-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteAttachmentStoreHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const store = createSqliteAttachmentStore();
  handles.push(store);
  const app = createAttachmentsRoutes({ repo: store.attachments }, insecureHeaderAuthContextResolver);
  return { app, repo: store.attachments };
}

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function json(res: Response) {
  return res.json();
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

const CUSTOMER_MANAGE = "sales.customer.edit";
const CUSTOMER_VIEW = "sales.customer.view";
const EMPLOYEE_VIEW = "hr.employee.view";
const EMPLOYEE_MANAGE = "hr.employee.edit";

function customerUpload(overrides: Record<string, unknown> = {}) {
  return {
    id: "ATT-C1",
    entityType: "customer",
    entityId: "CUST-1",
    fileName: "contract.pdf",
    mimeType: "application/pdf",
    contentBase64: b64("hello customer file"),
    ...overrides,
  };
}

describe("attachments router — permission gates", () => {
  it("refuses an upload without the entity's manage permission, and creates nothing", async () => {
    const { app, repo } = newApp();
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify(customerUpload()) }));
    expect(res.status).toBe(403);
    expect(await repo.listAll()).toHaveLength(0);
  });

  it("holding only the VIEW permission is not enough to upload — a similar but different code", async () => {
    const { app, repo } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: CUSTOMER_VIEW, body: JSON.stringify(customerUpload()) }),
    );
    expect(res.status).toBe(403);
    expect(await repo.listAll()).toHaveLength(0);
  });

  it("uploads once the caller holds the entity's manage permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload()) }),
    );
    expect(res.status).toBe(201);
    const body = (await json(res)) as { id: string; entityType: string; fileName: string };
    expect(body).toMatchObject({ id: "ATT-C1", entityType: "customer", fileName: "contract.pdf" });
  });

  it("refuses DELETE without the manage permission, and the row survives", async () => {
    const { app, repo } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload()) }));
    const res = await app.fetch(req("/ATT-C1", { method: "DELETE", permissions: CUSTOMER_VIEW }));
    expect(res.status).toBe(403);
    expect(await repo.findById("ATT-C1")).not.toBeNull();
  });

  it("refuses GET /:id without the entity's view permission, from an unrelated permission entirely", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload()) }));
    const res = await app.fetch(req("/ATT-C1", { permissions: "inventory.item.view" }));
    expect(res.status).toBe(403);
  });
});

describe("attachments router — GET /:id and ?entityType= without an entityId", () => {
  it("GET /:id returns the metadata once the caller may view that entity type", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload()) }));
    const res = await app.fetch(req("/ATT-C1", { permissions: CUSTOMER_VIEW }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { id: string; fileName: string };
    expect(body).toMatchObject({ id: "ATT-C1", fileName: "contract.pdf" });
  });

  it("?entityType= with NO entityId lists every attachment of that type, across entities", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ id: "ATT-CUST1", entityId: "CUST-1" })) }));
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ id: "ATT-CUST2", entityId: "CUST-2" })) }));
    await app.fetch(
      req("/", { method: "POST", permissions: EMPLOYEE_MANAGE, body: JSON.stringify({ id: "ATT-EMP", entityType: "employee", entityId: "EMP-1", fileName: "x.jpg", contentBase64: b64("x") }) }),
    );

    const res = await app.fetch(req("/?entityType=customer", { permissions: CUSTOMER_VIEW }));
    const rows = (await json(res)) as Array<{ id: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(["ATT-CUST1", "ATT-CUST2"]);
  });
});

describe("attachments router — bytes round-trip exactly", () => {
  it("the uploaded bytes come back byte-for-byte through GET /:id/content", async () => {
    const { app } = newApp();
    const original = "قيمة الملف بالعربية والإنجليزية 123 — should survive intact.";
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: CUSTOMER_MANAGE,
        body: JSON.stringify(customerUpload({ contentBase64: b64(original) })),
      }),
    );
    const res = await app.fetch(req("/ATT-C1/content", { permissions: CUSTOMER_VIEW }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { contentBase64: string; byteSize: number };
    expect(Buffer.from(body.contentBase64, "base64").toString("utf8")).toBe(original);
    expect(body.byteSize).toBe(Buffer.byteLength(original, "utf8"));
  });

  it("404s content for an id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/GHOST/content", { permissions: CUSTOMER_VIEW }));
    expect(res.status).toBe(404);
  });
});

describe("attachments router — create validation (domain errors)", () => {
  it("rejects a contract-malformed body (unknown entityType) with 400", async () => {
    const { app, repo } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ entityType: "not-a-real-type" })) }),
    );
    expect(res.status).toBe(400);
    expect(await repo.listAll()).toHaveLength(0);
  });

  it("rejects a truly empty body at the contract layer with 400", async () => {
    const { app, repo } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ contentBase64: "" })) }),
    );
    expect(res.status).toBe(400);
    expect(await repo.listAll()).toHaveLength(0);
  });

  it("422s a file over the 5 MiB limit via the domain's own validation, and creates nothing", async () => {
    const { app, repo } = newApp();
    const oversized = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 65).toString("base64");
    const res = await app.fetch(
      req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ contentBase64: oversized })) }),
    );
    expect(res.status).toBe(422);
    const body = (await json(res)) as { error: string; reasons: string[] };
    expect(body.error).toBe("INVALID_ATTACHMENT");
    expect(body.reasons.some((r) => r.includes("يتجاوز"))).toBe(true);
    expect(await repo.listAll()).toHaveLength(0);
  });

  it("409s a duplicate id instead of silently overwriting the first upload", async () => {
    const { app, repo } = newApp();
    const first = await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload()) }));
    expect(first.status).toBe(201);
    const second = await app.fetch(
      req("/", {
        method: "POST",
        permissions: CUSTOMER_MANAGE,
        body: JSON.stringify(customerUpload({ fileName: "different-file.pdf", contentBase64: b64("different bytes") })),
      }),
    );
    expect(second.status).toBe(409);
    // The FIRST upload's bytes are untouched — a 409 that had overwritten
    // them would be the exact defect this status code exists to prevent.
    const stillFirst = await repo.readContent("ATT-C1");
    expect(Buffer.from(stillFirst!.bytes).toString("utf8")).toBe("hello customer file");
    expect((await repo.listAll())).toHaveLength(1);
  });
});

describe("attachments router — deleting one attachment leaves the others", () => {
  it("deletes exactly the targeted row; a sibling on the SAME entity survives", async () => {
    const { app, repo } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ id: "ATT-A" })) }));
    await app.fetch(
      req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ id: "ATT-B", fileName: "second.pdf" })) }),
    );
    const del = await app.fetch(req("/ATT-A", { method: "DELETE", permissions: CUSTOMER_MANAGE }));
    expect(del.status).toBe(204);
    expect(await repo.findById("ATT-A")).toBeNull();
    expect(await repo.findById("ATT-B")).not.toBeNull();
  });

  it("404s deleting an id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/GHOST", { method: "DELETE", permissions: CUSTOMER_MANAGE }));
    expect(res.status).toBe(404);
  });
});

describe("attachments router — an attachment cannot be read across a boundary it should not cross", () => {
  it("a caller who may see CUSTOMER files may not read an EMPLOYEE attachment by guessing its id", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: EMPLOYEE_MANAGE,
        body: JSON.stringify({
          id: "ATT-EMP",
          entityType: "employee",
          entityId: "EMP-1",
          fileName: "id-card.jpg",
          contentBase64: b64("employee id card bytes"),
        }),
      }),
    );
    // The caller can see customers, and knows the attachment's exact id — but
    // holds no HR permission at all.
    const res = await app.fetch(req("/ATT-EMP", { permissions: `${CUSTOMER_VIEW},${CUSTOMER_MANAGE}` }));
    expect(res.status).toBe(403);
    const content = await app.fetch(req("/ATT-EMP/content", { permissions: `${CUSTOMER_VIEW},${CUSTOMER_MANAGE}` }));
    expect(content.status).toBe(403);
  });

  it("GET / (unfiltered) narrows to only what the caller's permissions cover, never the full table", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload()) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: EMPLOYEE_MANAGE,
        body: JSON.stringify({ id: "ATT-EMP", entityType: "employee", entityId: "EMP-1", fileName: "x.jpg", contentBase64: b64("x") }),
      }),
    );
    const res = await app.fetch(req("/", { permissions: CUSTOMER_VIEW }));
    const rows = (await json(res)) as Array<{ entityType: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityType).toBe("customer");
  });

  it("?entityType=&entityId= isolates ONE entity's files from a sibling entity of the same type", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ id: "ATT-CUST1", entityId: "CUST-1" })) }));
    await app.fetch(req("/", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ id: "ATT-CUST2", entityId: "CUST-2" })) }));

    const res = await app.fetch(req("/?entityType=customer&entityId=CUST-1", { permissions: CUSTOMER_VIEW }));
    const rows = (await json(res)) as Array<{ id: string; entityId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "ATT-CUST1", entityId: "CUST-1" });
  });

  it("refuses a scoped ?entityType= list without permission for THAT entity type", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/?entityType=employee&entityId=EMP-1", { permissions: CUSTOMER_VIEW }));
    expect(res.status).toBe(403);
  });

  it("400s an unknown ?entityType= value", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/?entityType=not-real", { permissions: CUSTOMER_VIEW }));
    expect(res.status).toBe(400);
  });
});

describe("module gate — the entity's module, not just its permission", () => {
  function newBoundApp(activeModules: string[]) {
    const store = createSqliteAttachmentStore();
    handles.push(store);
    const entitlements = createEntitlements({ plan: "core", activeModules, features: {}, seats: 1, expiresAt: null });
    const wrapper = new Hono();
    wrapper.use("*", entitlementsBinding(() => entitlements));
    wrapper.route("/", createAttachmentsRoutes({ repo: store.attachments }, insecureHeaderAuthContextResolver));
    return { app: wrapper, repo: store.attachments };
  }

  it("refuses a scoped ?entityType= list into an unlicensed module even with the permission", async () => {
    const { app } = newBoundApp(["sales"]);
    const res = await app.fetch(req("/?entityType=employee&entityId=EMP-1", { permissions: "*" }));
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "MODULE_NOT_LICENSED", module: "hr" });
  });

  it("refuses an upload into an unlicensed module even with the manage permission", async () => {
    const { app } = newBoundApp(["sales"]);
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "*",
        body: JSON.stringify({ id: "ATT-EMP", entityType: "employee", entityId: "EMP-1", fileName: "x.jpg", contentBase64: b64("x") }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "MODULE_NOT_LICENSED", module: "hr" });
  });

  it("drops an unlicensed module's rows from the unfiltered list, even though the permission is held", async () => {
    const store = createSqliteAttachmentStore();
    handles.push(store);
    const licensed = createEntitlements({ plan: "core", activeModules: ["hr", "sales"], features: {}, seats: 1, expiresAt: null });
    const writer = new Hono();
    writer.use("*", entitlementsBinding(() => licensed));
    writer.route("/", createAttachmentsRoutes({ repo: store.attachments }, insecureHeaderAuthContextResolver));
    await writer.fetch(
      req("/", {
        method: "POST",
        permissions: "*",
        body: JSON.stringify({ id: "ATT-EMP", entityType: "employee", entityId: "EMP-1", fileName: "x.jpg", contentBase64: b64("x") }),
      }),
    );
    await writer.fetch(req("/", { method: "POST", permissions: "*", body: JSON.stringify(customerUpload()) }));

    const salesOnly = createEntitlements({ plan: "core", activeModules: ["sales"], features: {}, seats: 1, expiresAt: null });
    const reader = new Hono();
    reader.use("*", entitlementsBinding(() => salesOnly));
    reader.route("/", createAttachmentsRoutes({ repo: store.attachments }, insecureHeaderAuthContextResolver));
    const res = await reader.fetch(req("/", { permissions: "*" }));
    const rows = (await json(res)) as Array<{ entityType: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityType).toBe("customer");
  });

  it("passes when the entity's module is licensed", async () => {
    const { app } = newBoundApp(["hr"]);
    const res = await app.fetch(req("/?entityType=employee&entityId=EMP-1", { permissions: "*" }));
    expect(res.status).toBe(200);
  });
});

describe("#125 separate attachment permissions — only where the plan carries the feature", () => {
  function editionApp(features: Record<string, boolean>) {
    const store = createSqliteAttachmentStore();
    handles.push(store);
    const entitlements = createEntitlements({ plan: "enterprise", activeModules: ["sales", "admin"], features, seats: 1, expiresAt: null });
    const wrapper = new Hono();
    wrapper.use("*", entitlementsBinding(() => entitlements));
    wrapper.route("/", createAttachmentsRoutes({ repo: store.attachments }, insecureHeaderAuthContextResolver));
    return { app: wrapper, repo: store.attachments };
  }
  const topEdition = { [SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE]: true };
  const upload = (app: Hono, permissions: string) =>
    app.fetch(req("/", { method: "POST", permissions, body: JSON.stringify(customerUpload()) }));

  it("below the top edition the parent entity alone governs, exactly as before", async () => {
    const { app } = editionApp({});
    expect((await upload(app, CUSTOMER_MANAGE)).status).toBe(201);
    expect((await app.fetch(req("/?entityType=customer&entityId=CUST-1", { permissions: CUSTOMER_VIEW }))).status).toBe(200);
    expect((await app.fetch(req("/ATT-C1/content", { permissions: CUSTOMER_VIEW }))).status).toBe(200);
    expect((await app.fetch(req("/ATT-C1", { method: "DELETE", permissions: CUSTOMER_MANAGE }))).status).toBe(204);
  });

  it("in the top edition an upload also needs admin.attachment.upload", async () => {
    const { app, repo } = editionApp(topEdition);
    const refused = await upload(app, CUSTOMER_MANAGE);
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ permission: AttachmentPermission.Upload });
    expect(await repo.listAll()).toHaveLength(0);
    expect((await upload(app, `${CUSTOMER_MANAGE},${AttachmentPermission.Upload}`)).status).toBe(201);
  });

  it("in the top edition the attachment permission never stands in for the parent's", async () => {
    const { app } = editionApp(topEdition);
    expect((await upload(app, `${CUSTOMER_VIEW},${AttachmentPermission.Upload}`)).status).toBe(403);
  });

  it("in the top edition reading a file needs admin.attachment.view on top of the parent's view", async () => {
    const { app } = editionApp(topEdition);
    expect((await upload(app, `${CUSTOMER_MANAGE},${AttachmentPermission.Upload}`)).status).toBe(201);
    const scoped = await app.fetch(req("/?entityType=customer&entityId=CUST-1", { permissions: CUSTOMER_VIEW }));
    expect(scoped.status).toBe(403);
    expect(await json(scoped)).toMatchObject({ permission: AttachmentPermission.View });
    expect((await app.fetch(req("/ATT-C1", { permissions: CUSTOMER_VIEW }))).status).toBe(403);
    expect((await app.fetch(req("/ATT-C1/content", { permissions: CUSTOMER_VIEW }))).status).toBe(403);
    expect(await json(await app.fetch(req("/", { permissions: CUSTOMER_VIEW })))).toEqual([]);
    const granted = `${CUSTOMER_VIEW},${AttachmentPermission.View}`;
    expect((await app.fetch(req("/ATT-C1/content", { permissions: granted }))).status).toBe(200);
    expect(await json(await app.fetch(req("/", { permissions: granted })))).toHaveLength(1);
  });

  it("in the top edition deleting needs admin.attachment.delete, which upload does not imply", async () => {
    const { app, repo } = editionApp(topEdition);
    expect((await upload(app, `${CUSTOMER_MANAGE},${AttachmentPermission.Upload}`)).status).toBe(201);
    const refused = await app.fetch(req("/ATT-C1", { method: "DELETE", permissions: `${CUSTOMER_MANAGE},${AttachmentPermission.Upload}` }));
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ permission: AttachmentPermission.Delete });
    expect(await repo.listAll()).toHaveLength(1);
    expect((await app.fetch(req("/ATT-C1", { method: "DELETE", permissions: `${CUSTOMER_MANAGE},${AttachmentPermission.Delete}` }))).status).toBe(204);
  });
});

describe("plan storage limit — uploads against the plan's attachment space", () => {
  const MB = 1024 * 1024;
  const chunk = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

  function storageApp(storageMb: number | undefined) {
    const store = createSqliteAttachmentStore();
    handles.push(store);
    const entitlements = createEntitlements({
      plan: "starter",
      activeModules: ["sales", "admin"],
      features: {},
      seats: 1,
      expiresAt: null,
      ...(storageMb === undefined ? {} : { quotas: { [QuotaKind.StorageMb]: storageMb } }),
    });
    const storage = { usedBytes: () => store.attachments.totalBytes(), serializeWrite: <T,>(fn: () => Promise<T>) => fn() };
    const wrapper = new Hono();
    wrapper.use("*", entitlementsBinding(() => entitlements));
    wrapper.route("/attachments", createAttachmentsRoutes({ repo: store.attachments, storage }, insecureHeaderAuthContextResolver));
    wrapper.route("/plan-usage", createPlanUsageRoutes({ storage }, insecureHeaderAuthContextResolver));
    const upload = (id: string, bytes: number) =>
      wrapper.fetch(req("/attachments", { method: "POST", permissions: CUSTOMER_MANAGE, body: JSON.stringify(customerUpload({ id, contentBase64: chunk(bytes) })) }));
    return { app: wrapper, repo: store.attachments, upload };
  }

  it("uploads while the file fits in the plan's space", async () => {
    const { upload, repo } = storageApp(1);
    expect((await upload("A1", 0.4 * MB)).status).toBe(201);
    expect((await upload("A2", 0.4 * MB)).status).toBe(201);
    expect(await repo.listAll()).toHaveLength(2);
  });

  it("refuses the file that would not fit, bilingual and naming the limit, and stores nothing", async () => {
    const { upload, repo } = storageApp(1);
    expect((await upload("A1", 0.6 * MB)).status).toBe(201);
    const res = await upload("A2", 0.6 * MB);
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: "PLAN_LIMIT_REACHED", limit: "storage_mb", allowed: 1, used: 1 });
    const body = (await json(await upload("A3", 0.6 * MB))) as { message: string; messageEn: string };
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.messageEn).toContain("attachment storage");
    expect((await repo.listAll()).map((a) => a.id)).toEqual(["A1"]);
  });

  it("deleting a file frees room for the next upload", async () => {
    const { app, upload } = storageApp(1);
    await upload("A1", 0.6 * MB);
    expect((await upload("A2", 0.6 * MB)).status).toBe(409);
    expect((await app.fetch(req("/attachments/A1", { method: "DELETE", permissions: CUSTOMER_MANAGE }))).status).toBe(204);
    expect((await upload("A2", 0.6 * MB)).status).toBe(201);
  });

  it("a plan with no storage limit is unlimited", async () => {
    const { upload } = storageApp(undefined);
    expect((await upload("A1", 3 * MB)).status).toBe(201);
    expect((await upload("A2", 3 * MB)).status).toBe(201);
  });

  it("GET /plan-usage reports storage used in MB, rounded up", async () => {
    const { app, upload } = storageApp(5);
    await upload("A1", 0.2 * MB);
    const res = await app.fetch(req("/plan-usage", { permissions: "admin.settings.view" }));
    expect(res.status).toBe(200);
    const body = (await json(res)) as { limits: Array<{ limit: string; allowed: number; used: number }> };
    expect(body.limits).toContainEqual({ limit: "storage_mb", allowed: 5, used: 1 });
  });

  it("GET /plan-usage has no storage entry when the plan has no storage limit", async () => {
    const { app } = storageApp(undefined);
    const body = (await json(await app.fetch(req("/plan-usage", { permissions: "admin.settings.view" })))) as { limits: Array<{ limit: string }> };
    expect(body.limits.map((l) => l.limit)).not.toContain("storage_mb");
  });
});
