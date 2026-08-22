import { describe, it, expect } from "vitest";
import { createDocumentsRoutes } from "./documents-routes.js";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

function post(path: string, body: unknown, permissions = "accounting.journal.view") {
  return req(path, {
    method: "POST",
    permissions,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("documents router — permission gate", () => {
  it("rejects unauthenticated access with 403", async () => {
    const app = createDocumentsRoutes();
    const res = await app.fetch(req("/types"));
    expect(res.status).toBe(403);
  });
});

describe("documents router — type registry", () => {
  it("lists the journal document type and its hooks", async () => {
    const app = createDocumentsRoutes();
    const res = await app.fetch(req("/types", { permissions: "accounting.journal.view" }));
    expect(res.status).toBe(200);
    const types = (await res.json()) as Array<{ code: string; gateActionType: string; hooks: Record<string, boolean> }>;
    const journal = types.find((t) => t.code === "JOURNAL_ENTRY");
    expect(journal).toBeDefined();
    expect(journal?.gateActionType).toBe("ACCOUNTING_JOURNAL_POST");
    expect(journal?.hooks.gl).toBe(true);
    expect(journal?.hooks.stock).toBe(false);
  });

  it("lists the phase4/inventory-ops document types (stock adjustment + transfer)", async () => {
    const app = createDocumentsRoutes();
    const res = await app.fetch(req("/types", { permissions: "accounting.journal.view" }));
    const types = (await res.json()) as Array<{ code: string; hooks: Record<string, boolean> }>;
    const adjustment = types.find((t) => t.code === "STOCK_ADJUSTMENT");
    const transfer = types.find((t) => t.code === "STOCK_TRANSFER");
    expect(adjustment?.hooks.stock).toBe(true);
    expect(adjustment?.hooks.gl).toBe(false); // GL posting happens inside the stock hook, not a standalone buildGlPosting
    expect(transfer?.hooks.stock).toBe(true);
    expect(transfer?.hooks.gl).toBe(false);
  });
});

describe("documents router — journal effects", () => {
  it("computes a balanced descriptor", async () => {
    const app = createDocumentsRoutes();
    const res = await app.fetch(
      post("/journal/effects", {
        lines: [
          { accountId: "1300-1", debit: "100.00", credit: "0" },
          { accountId: "4000", debit: "0", credit: "100.00" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balanced: boolean; blocked: boolean; totalDebit: string };
    expect(body.balanced).toBe(true);
    expect(body.blocked).toBe(false);
    expect(body.totalDebit).toBe("100.000000");
  });

  it("flags an unbalanced descriptor as blocked", async () => {
    const app = createDocumentsRoutes();
    const res = await app.fetch(
      post("/journal/effects", {
        lines: [
          { accountId: "1300-1", debit: "100.00", credit: "0" },
          { accountId: "4000", debit: "0", credit: "90.00" },
        ],
      }),
    );
    const body = (await res.json()) as { balanced: boolean; blocked: boolean; blockedReason: string };
    expect(body.balanced).toBe(false);
    expect(body.blocked).toBe(true);
    expect(body.blockedReason).toContain("غير متوازن");
  });
});
