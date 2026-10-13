import { describe, it, expect, afterEach } from "vitest";
import { createSqliteTaxRateRepository, createSqliteUnitOfWork, type SqliteTaxRateRepositoryHandle } from "@mezan/persistence";
import { SYSTEM_NOT_SUBJECT_TAX_RATE_ID, ensureSystemTaxRates } from "@mezan/domain";
import { createTaxRatesRoutes } from "./tax-rates-routes.js";
import { createApp } from "./app.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteTaxRateRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteTaxRateRepository();
  handles.push(repo);
  const app = createTaxRatesRoutes(repo, insecureHeaderAuthContextResolver, { isReferenced: async () => false });
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = { id: "t1", code: "VAT14", name: "ضريبة القيمة المضافة 14%", rate: 14 };

describe("tax-rates router — the pickers on document forms (D79)", () => {
  it("a role holding only the document-create permission can read the rates its line picker lists", async () => {
    for (const create of ["sales.invoice.create", "sales.quote.create", "purchases.invoice.create"]) {
      const { app, repo } = newApp();
      await repo.create({ ...payload, calculationType: "exclusive", isDefault: true, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active" });
      const res = await app.fetch(req("/", { permissions: create }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { id: string }[]).map((r) => r.id)).toEqual(["t1"]);
      const manage = await app.fetch(
        req("/t1", { method: "PATCH", permissions: create, headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) }),
      );
      expect(manage.status).toBe(403);
    }
  });

  it("answers 409 with an Arabic and an English message when a referenced rate's percent or sub-type is edited", async () => {
    const repo = createSqliteTaxRateRepository();
    handles.push(repo);
    const app = createTaxRatesRoutes(repo, insecureHeaderAuthContextResolver, { isReferenced: async (id: string) => id === "t1" });
    await repo.create({ ...payload, calculationType: "exclusive", isDefault: true, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active" });
    const patch = (body: unknown) =>
      app.fetch(req("/t1", { method: "PATCH", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

    const rate = await patch({ rate: 15 });
    expect(rate.status).toBe(409);
    const body = (await rate.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("TAX_RATE_IN_USE");
    expect(body.message).toMatch(/[\u0600-\u06FF]/);
    expect(body.message).toContain(payload.name);
    expect(body.messageEn).toMatch(/Create a new tax rate/);
    expect((await patch({ etaSubType: "V003" })).status).toBe(409);
    expect((await patch({ status: "inactive" })).status).toBe(200);
    expect((await repo.findById("t1"))?.rate).toBe(14);
  });
});

describe("tax-rates router — the system «غير خاضع» rate (D79 round 3)", () => {
  async function seeded() {
    const { app, repo } = newApp();
    await ensureSystemTaxRates(repo);
    return { app, repo };
  }
  const patch = (app: ReturnType<typeof newApp>["app"], body: unknown) =>
    app.fetch(req(`/${SYSTEM_NOT_SUBJECT_TAX_RATE_ID}`, { method: "PATCH", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("lists it as a system rate at 0% under V004, and the tenant's own rates as not", async () => {
    const { app, repo } = await seeded();
    await repo.create({ ...payload, calculationType: "exclusive", isDefault: true, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active" });
    const listed = (await (await app.fetch(req("/", { permissions: "accounting.tax.view" }))).json()) as { id: string; rate: number; etaSubType: string; status: string; isSystem: boolean }[];
    expect(listed.find((r) => r.id === SYSTEM_NOT_SUBJECT_TAX_RATE_ID)).toMatchObject({ rate: 0, etaSubType: "V004", status: "active", isSystem: true });
    expect(listed.find((r) => r.id === "t1")?.isSystem).toBe(false);
  });

  it.each([{ name: "معفى" }, { rate: 14 }, { etaSubType: "V003" }, { status: "inactive" }, { isDefault: true }])(
    "answers 409 TAX_RATE_SYSTEM_LOCKED in Arabic and English for %j, and the row does not change",
    async (change) => {
      const { app, repo } = await seeded();
      const res = await patch(app, change);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; message: string; messageEn: string };
      expect(body.error).toBe("TAX_RATE_SYSTEM_LOCKED");
      expect(body.message).toMatch(/غير خاضع/);
      expect(body.messageEn).toMatch(/defined by the system/);
      expect(await repo.findById(SYSTEM_NOT_SUBJECT_TAX_RATE_ID)).toMatchObject({ name: "غير خاضع", rate: 0, etaSubType: "V004", status: "active", isDefault: false });
    },
  );

  it("answers 409 for a create under its id", async () => {
    const { app } = await seeded();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: SYSTEM_NOT_SUBJECT_TAX_RATE_ID }) }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("DUPLICATE_ID");
  });
});

describe("tax-rates router — create never overwrites (review round 2, skill rule 8)", () => {
  const post = (app: ReturnType<typeof newApp>["app"], body: unknown) =>
    app.fetch(req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("answers 409 for an id that already exists and leaves the stored rate exactly as it was", async () => {
    const { app, repo } = newApp();
    expect((await post(app, payload)).status).toBe(201);
    const before = await repo.findById("t1");

    const res = await post(app, { id: "t1", code: "VAT14B", name: "x", rate: 10 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("DUPLICATE_ID");
    expect(body.message).toMatch(/[\u0600-\u06FF]/);
    expect(body.message).toContain("t1");
    expect(body.messageEn).toMatch(/already belongs to an existing record/);
    expect(await repo.findById("t1")).toEqual(before);
    expect(await repo.list()).toHaveLength(1);
  });

  it("the repository's create is an insert: a second create of the same id throws rather than overwriting", async () => {
    const { repo } = newApp();
    const row = { ...payload, calculationType: "exclusive" as const, isDefault: false, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto" as const, status: "active" as const };
    await repo.create(row);
    await expect(repo.create({ ...row, code: "OTHER", rate: 10 })).rejects.toThrow();
    expect((await repo.findById("t1"))?.rate).toBe(14);
  });

  it("an update of an id that does not exist changes nothing", async () => {
    const { repo } = newApp();
    await repo.update({ ...payload, calculationType: "exclusive", isDefault: false, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active" });
    expect(await repo.list()).toEqual([]);
  });
});

describe("an app wired with no tax-rate usage port (review round 2)", () => {
  it("treats every rate as referenced: its percent and sub-type are locked, its name and status are not", async () => {
    const uow = createSqliteUnitOfWork();
    const repo = createSqliteTaxRateRepository();
    handles.push(repo);
    try {
      const app = createApp(uow, { taxRateRepo: repo });
      await repo.create({ ...payload, calculationType: "exclusive", isDefault: true, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active" });
      const patch = (body: unknown) =>
        app.fetch(req("/tax-rates/t1", { method: "PATCH", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

      const rate = await patch({ rate: 15 });
      expect(rate.status).toBe(409);
      expect(((await rate.json()) as { error: string }).error).toBe("TAX_RATE_IN_USE");
      expect((await patch({ etaSubType: "V003" })).status).toBe(409);
      expect((await patch({ name: "ضريبة القيمة المضافة" })).status).toBe(200);
      expect(await repo.findById("t1")).toMatchObject({ rate: 14, etaSubType: "auto", name: "ضريبة القيمة المضافة" });
    } finally {
      uow.close();
    }
  });
});

describe("tax-rates router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("accounting.tax.view");
  });

  it("allows GET / with accounting.tax.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "accounting.tax.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.tax.view", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows POST / with accounting.tax.manage", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(res.status).toBe(201);
  });

  it("the '*' wildcard bypasses the gate entirely", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "*" }));
    expect(res.status).toBe(200);
  });
});

describe("tax-rates router — CRUD", () => {
  it("creates a tax rate and retrieves it by id", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(createRes.status).toBe(201);

    const getRes = await app.fetch(req("/t1", { permissions: "accounting.tax.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { code: string; rate: number };
    expect(body).toMatchObject({ id: "t1", code: "VAT14", rate: 14, isDefault: false, status: "active" });
  });

  it("404s for an unknown tax rate", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "accounting.tax.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "VAT14" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("409s a duplicate tax code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "t2" }) }),
    );
    expect(res.status).toBe(409);
  });

  it("422s an out-of-range rate", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, id: "t2", code: "BAD", rate: 150 }) }),
    );
    expect(res.status).toBe(422);
  });

  it("PATCH edits a tax rate (e.g. deactivate)", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }));
    const res = await app.fetch(
      req("/t1", { method: "PATCH", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "inactive" }) }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("inactive");
  });

  it("PATCH 404s an unknown tax rate", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", { method: "PATCH", permissions: "accounting.tax.manage", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "inactive" }) }),
    );
    expect(res.status).toBe(404);
  });
});
