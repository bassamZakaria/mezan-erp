import { describe, it, expect, afterEach } from "vitest";
import { Money, type Account } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteVoucherStore,
  createSqliteCostCenterRepository,
} from "@mezan/persistence";
import { createVouchersRoutes, type VoucherRoutesDeps } from "./vouchers-routes.js";
import { createCostCentersRoutes } from "./cost-centers-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
/**
 * Branch scope is only real if the other branch data is actually absent. Two
 * branches are seeded with money in both, the caller is scoped to one, and the
 * question asked of every read surface is the same: are the other branch ids
 * there. The list surfaces narrow. The single-GET-by-id surfaces do not — that
 * is what these tests pin.
 */

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

const CASH_A = "1300-1";
const CASH_B = "1300-2";
const COUNTERPARTY = "1100";

function account(id: string): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
  };
}

function req(path: string, init: RequestInit & { permissions?: string; branchScope?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  headers.set("x-user-id", "clerk-b1");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function voucherHarness() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const treasury = createSqliteTreasuryAccountRepository();
  const store = createSqliteVoucherStore();
  closers.push(ledger, accounts, periods, treasury, store);

  await accounts.create(account(CASH_A));
  await accounts.create(account(CASH_B));
  await accounts.create(account(COUNTERPARTY));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });
  for (const branch of ["b1", "b2"]) {
    await treasury.create({
      id: `ta-${branch}`,
      code: `CASH-${branch}`,
      name: `صندوق ${branch}`,
      nameEn: null,
      type: "cash",
      currency: "EGP",
      branchId: branch,
      glAccountId: branch === "b1" ? CASH_A : CASH_B,
      openingBalance: Money.zero(),
      openingBalanceDate: null,
      status: "active",
    });
  }

  let seq = 0;
  const deps: VoucherRoutesDeps = {
    documents: store.documents,
    allocations: store.allocations,
    invoices: store.invoices,
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    treasuryAccounts: treasury,
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => `gen-${++seq}`,
  };
  const app = createVouchersRoutes(deps, insecureHeaderAuthContextResolver);

  for (const branch of ["b1", "b2"]) {
    const payload = {
      id: `v-${branch}`,
      date: "2026-08-22",
      voucherType: "customer_collection",
      amount: branch === "b1" ? "300.00" : "7500.00",
      branchId: branch,
      paymentMethod: "cash",
      treasuryAccountId: `ta-${branch}`,
      treasuryGlAccountId: branch === "b1" ? CASH_A : CASH_B,
      counterpartyGlAccountId: COUNTERPARTY,
      customerId: `cust-${branch}`,
    };
    const created = await app.fetch(req("/", { method: "POST", permissions: "*", body: JSON.stringify(payload) }));
    expect(created.status).toBe(201);
    const confirmed = await app.fetch(req(`/v-${branch}/confirm`, { method: "POST", permissions: "*" }));
    expect(confirmed.status).toBe(200);
  }

  return app;
}

const SCOPED = { permissions: "treasury.cash_voucher.view", branchScope: "b1" };

describe("a branch-scoped clerk reading the voucher LIST", () => {
  it("sees only their own branch rows, and no query parameter widens that", async () => {
    const app = await voucherHarness();

    const listed = await app.fetch(req("/", SCOPED));
    const rows = (await listed.json()) as Array<{ id: string; branchId: string; amount: string }>;
    expect(rows.map((r) => r.id)).toEqual(["v-b1"]);
    expect(rows.map((r) => r.branchId)).toEqual(["b1"]);

    const widened = await app.fetch(req("/?branchId=b2", SCOPED));
    expect((await widened.json()) as unknown[]).toEqual([]);
  });

  it("counts and totals only their own branch — the KPI strip cannot report money they may not see", async () => {
    const app = await voucherHarness();

    const counts = (await (await app.fetch(req("/counts", SCOPED))).json()) as Record<string, number>;
    expect(counts.all).toBe(1);
    expect(counts.confirmed).toBe(1);

    const stats = (await (await app.fetch(req("/stats", SCOPED))).json()) as { count: number; receipts: string };
    expect(stats.count).toBe(1);
    // 7,500.00 belongs to b2. If it appears here the scope is cosmetic.
    expect(stats.receipts).toBe("300.000000");

    const unscoped = (await (await app.fetch(req("/stats", { permissions: "*" }))).json()) as { receipts: string };
    expect(unscoped.receipts).toBe("7800.000000");
  });
});

describe("the same clerk fetching the other branch document BY ID", () => {
  it("LIMITATION: GET /vouchers/:id ignores branch scope and serves the other branch voucher in full", async () => {
    const app = await voucherHarness();

    const res = await app.fetch(req("/v-b2", SCOPED));

    // What SHOULD happen: 404, exactly as the own-visibility narrowing on
    // sales invoices does — whether a document they may not see exists is
    // itself information. What DOES happen:
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { id: string; branchId: string; amount: string };
    expect(doc.id).toBe("v-b2");
    expect(doc.branchId).toBe("b2");
    expect(doc.amount).toBe("7500.000000");
  });

  it("LIMITATION: the allocations of the other branch voucher are readable by id too", async () => {
    const app = await voucherHarness();
    const res = await app.fetch(req("/v-b2/allocations", { permissions: "treasury.allocation.view", branchScope: "b1" }));
    expect(res.status).toBe(200);
  });
});

describe("cost centres — the list narrows, the tree and the detail do not", () => {
  async function costCenterApp() {
    const repo = createSqliteCostCenterRepository();
    closers.push(repo);
    const app = createCostCentersRoutes(repo, insecureHeaderAuthContextResolver);
    for (const branch of ["b1", "b2"]) {
      const payload = { id: `cc-${branch}`, code: `CC-${branch}`, nameAr: `مركز ${branch}`, branchId: branch };
      const res = await app.fetch(req("/", { method: "POST", permissions: "*", body: JSON.stringify(payload) }));
      expect(res.status).toBe(201);
    }
    return app;
  }

  const viewer = { permissions: "accounting.coa.view", branchScope: "b1" };

  it("excludes the other branch cost centre from GET /", async () => {
    const app = await costCenterApp();
    const rows = (await (await app.fetch(req("/", viewer))).json()) as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["cc-b1"]);
  });

  it("LIMITATION: GET /cost-centers/tree reads the whole table with no scope at all", async () => {
    const app = await costCenterApp();
    const tree = (await (await app.fetch(req("/tree", viewer))).json()) as Array<{ id: string }>;
    // The list above returned one row. The tree — the shape the screen renders
    // — returns both branches.
    expect(tree.map((n) => n.id).sort()).toEqual(["cc-b1", "cc-b2"]);
  });

  it("LIMITATION: GET /cost-centers/:id serves the other branch cost centre", async () => {
    const app = await costCenterApp();
    const res = await app.fetch(req("/cc-b2", viewer));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { branchId: string }).branchId).toBe("b2");
  });
});
