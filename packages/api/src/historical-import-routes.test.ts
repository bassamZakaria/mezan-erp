import { describe, it, expect } from "vitest";
import type { HistoricalPurchaseArchive, HistoricalPurchaseArchiveRepository, HistoricalPurchaseDocType, HistoricalImportGlPosting, HistoricalImportGlPostingPort } from "@mezan/domain";
import { createHistoricalImportRoutes } from "./historical-import-routes.js";

class InMemoryArchiveRepo implements HistoricalPurchaseArchiveRepository {
  private readonly rows = new Map<string, HistoricalPurchaseArchive>();
  async create(archive: HistoricalPurchaseArchive) {
    this.rows.set(archive.id, archive);
  }
  async list() {
    return [...this.rows.values()];
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByOriginalNumber(docType: HistoricalPurchaseDocType, originalNumber: string) {
    return [...this.rows.values()].find((a) => a.docType === docType && a.originalNumber === originalNumber) ?? null;
  }
}

class FakeGlPort implements HistoricalImportGlPostingPort {
  readonly posted: HistoricalImportGlPosting[] = [];
  async post(posting: HistoricalImportGlPosting) {
    this.posted.push(posting);
  }
}

function newApp(opts: { withGl?: boolean } = {}) {
  const archives = new InMemoryArchiveRepo();
  const gl = opts.withGl ? new FakeGlPort() : undefined;
  const accounts = opts.withGl ? { openingBalanceAccountId: "3900-ob", payableAccountId: "2100-ap" } : undefined;
  const app = createHistoricalImportRoutes({ archives, gl, accounts, now: () => "2026-08-21T09:00:00.000Z" });
  return { app, archives, gl };
}

const ADMIN = "*";
function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    rowNumber: 1,
    docType: "PURCHASE_INVOICE",
    documentNumber: "INV-9001",
    supplierId: "sup-1",
    date: "2026-01-15",
    qty: "10",
    unitCost: "25.00",
    amountPaid: "250.00",
    ...overrides,
  };
}

describe("historical-import-routes — preview", () => {
  it("groups valid rows without writing anything", async () => {
    const { app, archives } = newApp();
    const res = await app.fetch(
      req("/preview", { method: "POST", permissions: ADMIN, body: JSON.stringify({ rows: [row()] }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: { documentNumber: string; total: string; settled: boolean }[]; errors: unknown[] };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.documentNumber).toBe("INV-9001");
    expect(body.groups[0]?.total).toBe("250.000000");
    expect(body.groups[0]?.settled).toBe(true);
    expect(body.errors).toHaveLength(0);
    expect(await archives.list()).toHaveLength(0);
  });

  it("reports domain-level row errors without a 4xx (zero qty passes schema, fails domain validation)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/preview", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ rows: [row({ qty: "0" })] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: unknown[]; errors: { rowNumber: number; reasons: string[] }[] };
    expect(body.groups).toHaveLength(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.rowNumber).toBe(1);
    expect(body.errors[0]?.reasons.join(" ")).toMatch(/qty/);
  });

  it("400s a malformed body (row missing a required field)", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/preview", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ rows: [{ rowNumber: 1, docType: "PURCHASE_INVOICE" }] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });
});

describe("historical-import-routes — commit", () => {
  it("archives valid rows and returns archivedIds (201)", async () => {
    const { app, archives } = newApp();
    const res = await app.fetch(
      req("/commit", { method: "POST", permissions: ADMIN, body: JSON.stringify({ rows: [row()] }) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { archivedIds: string[]; errors: unknown[] };
    expect(body.archivedIds).toHaveLength(1);
    expect(body.errors).toHaveLength(0);
    expect(await archives.list()).toHaveLength(1);
  });

  it("posts a GL entry only for the unsettled document, none for the settled one", async () => {
    const { app, archives, gl } = newApp({ withGl: true });
    const res = await app.fetch(
      req("/commit", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({
          rows: [
            // settled: paid in full (250 == 10*25.00)
            row({ documentNumber: "INV-SETTLED", amountPaid: "250.00" }),
            // unsettled: partial payment (100 < 250)
            row({ documentNumber: "INV-UNSETTLED", amountPaid: "100.00" }),
          ],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { archivedIds: string[] };
    expect(body.archivedIds).toHaveLength(2);

    expect(gl?.posted).toHaveLength(1);
    expect(gl?.posted[0]?.sourceDocNumber).toBe("INV-UNSETTLED");

    const all = await archives.list();
    const settled = all.find((a) => a.originalNumber === "INV-SETTLED");
    const unsettled = all.find((a) => a.originalNumber === "INV-UNSETTLED");
    expect(settled?.settled).toBe(true);
    expect(unsettled?.settled).toBe(false);
  });

  it("re-committing the same documentNumber/docType reports an already-imported error and does not duplicate", async () => {
    const { app, archives } = newApp();
    await app.fetch(req("/commit", { method: "POST", permissions: ADMIN, body: JSON.stringify({ rows: [row()] }) }));

    const res2 = await app.fetch(
      req("/commit", { method: "POST", permissions: ADMIN, body: JSON.stringify({ rows: [row()] }) }),
    );
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { archivedIds: string[]; errors: { reasons: string[] }[] };
    expect(body2.archivedIds).toHaveLength(0);
    expect(body2.errors).toHaveLength(1);
    expect(body2.errors[0]?.reasons.join(" ")).toMatch(/already imported/);

    expect(await archives.list()).toHaveLength(1);
  });

  it("400s a malformed commit body", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/commit", {
        method: "POST",
        permissions: ADMIN,
        body: JSON.stringify({ rows: [{ rowNumber: 1 }] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });
});

describe("historical-import-routes — archives listing", () => {
  it("lists archived documents with Money/Qty serialized as strings", async () => {
    const { app } = newApp();
    await app.fetch(req("/commit", { method: "POST", permissions: ADMIN, body: JSON.stringify({ rows: [row()] }) }));

    const res = await app.fetch(req("/archives", { permissions: ADMIN }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { originalNumber: string; total: string; lines: { qty: string; unitCost: string }[] }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.originalNumber).toBe("INV-9001");
    expect(body[0]?.total).toBe("250.000000");
    expect(body[0]?.lines[0]?.qty).toBe("10.000000");
    expect(body[0]?.lines[0]?.unitCost).toBe("25.000000");
  });
});

describe("historical-import-routes — permission gates", () => {
  it("403s /preview and /commit without purchases.invoice.create", async () => {
    const { app } = newApp();
    const previewRes = await app.fetch(
      req("/preview", { method: "POST", permissions: "purchases.invoice.view", body: JSON.stringify({ rows: [row()] }) }),
    );
    expect(previewRes.status).toBe(403);

    const commitRes = await app.fetch(
      req("/commit", { method: "POST", permissions: "purchases.invoice.view", body: JSON.stringify({ rows: [row()] }) }),
    );
    expect(commitRes.status).toBe(403);
  });

  it("403s /archives without purchases.invoice.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/archives", { permissions: "" }));
    expect(res.status).toBe(403);
  });
});
