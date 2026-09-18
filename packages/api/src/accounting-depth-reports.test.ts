import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  postJournalEntry,
  type Account,
  type JournalPostingDeps,
} from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteCostCenterRepository,
  createSqliteExchangeRateRepository,
} from "@mezan/persistence";
import { createCostCenterPnLRoutes } from "./cost-center-pl-routes.js";
import { createFxRevaluationRoutes } from "./fx-revaluation-routes.js";
import { createReconciliationRoutes } from "./reconciliation-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

async function seed() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const costCenters = createSqliteCostCenterRepository();
  const exchangeRates = createSqliteExchangeRateRepository();
  closers.push(ledger, accounts, periods, costCenters, exchangeRates);

  await accounts.create(account("1100")); // AR
  await accounts.create(account("1200")); // inventory control
  await accounts.create(account("1300")); // cash
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("5000", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("4940", { type: "revenue", naturalBalance: "credit" })); // unrealised FX gain
  await accounts.create(account("5940", { type: "expense", naturalBalance: "debit" })); // unrealised FX loss
  await costCenters.create({ id: "cc-a", code: "CC-A", nameAr: "قسم أ", nameEn: null, type: "general", departmentId: null, branchId: null, parentId: null, notes: null, status: "active" });
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await periods.create({ id: "fp-09", year: 2026, periodNumber: 9, startDate: "2026-09-01", endDate: "2026-09-30", status: "open" });
  await exchangeRates.create({ id: "usd", currency: "USD", rate: "55", effectiveDate: "2026-08-01", rateType: "standard", source: "manual", status: "approved" });

  const deps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-31T10:00:00.000Z" };

  // AR sale in USD, booked at rate 50 → 100 USD; revenue tagged cc-a.
  await postJournalEntry({ id: "je1", date: "2026-08-10", memo: "sale", source: "system", lines: [
    { accountId: "1100", debit: Money.fromMajor("5000"), credit: Money.zero(), currency: "USD", fxRate: "50" },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("5000"), costCenterId: "cc-a" },
  ] }, deps);
  // Expense tagged cc-a.
  await postJournalEntry({ id: "je2", date: "2026-08-11", memo: "expense", source: "system", lines: [
    { accountId: "5000", debit: Money.fromMajor("300"), credit: Money.zero(), costCenterId: "cc-a" },
    { accountId: "1300", debit: Money.zero(), credit: Money.fromMajor("300") },
  ] }, deps);
  // Manual line hitting the inventory control account → unlinked.
  await postJournalEntry({ id: "je3", date: "2026-08-12", memo: "manual adj", source: "manual", lines: [
    { accountId: "1200", debit: Money.fromMajor("100"), credit: Money.zero() },
    { accountId: "1300", debit: Money.zero(), credit: Money.fromMajor("100") },
  ] }, deps);

  return { ledger, accounts, periods, costCenters, exchangeRates };
}

describe("cost-center-pl router", () => {
  it("returns P&L grouped by cost center", async () => {
    const { ledger, accounts, costCenters } = await seed();
    const app = createCostCenterPnLRoutes({ ledger, accounts, costCenters }, insecureHeaderAuthContextResolver);
    expect((await app.fetch(req("/"))).status).toBe(403);
    const res = await app.fetch(req("/?fromDate=2026-08-01&toDate=2026-08-31", { permissions: "accounting.reports.view" }));
    const body = await res.json() as { rows: Array<{ costCenterId: string | null; profit: string }>; totals: { profit: string } };
    const a = body.rows.find((r) => r.costCenterId === "cc-a")!;
    expect(a.profit).toBe(Money.fromMajor("4700").toString());
    expect(body.totals.profit).toBe(Money.fromMajor("4700").toString());
  });
});

describe("fx-revaluation router", () => {
  it("previews the open USD AR balance revalued at the closing rate (gain)", async () => {
    const { ledger, accounts, periods, exchangeRates } = await seed();
    const app = createFxRevaluationRoutes({ ledger, accounts, periods, numbering: ledger.numbering, exchangeRates, differenceAccounts: async () => ({ gainAccountId: "4940", lossAccountId: "5940" }), now: () => "2026-08-31T10:00:00.000Z" }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/preview", { method: "POST", permissions: "accounting.journal.post", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-08-31" }) }));
    const body = await res.json() as { totalGain: string; reversalDate: string; hasImpact: boolean; details: unknown[] };
    expect(body.hasImpact).toBe(true);
    expect(body.totalGain).toBe(Money.fromMajor("500").toString());
    expect(body.reversalDate).toBe("2026-09-01");
  });

  it("posts the revaluation and its auto-reversal", async () => {
    const { ledger, accounts, periods, exchangeRates } = await seed();
    const app = createFxRevaluationRoutes({ ledger, accounts, periods, numbering: ledger.numbering, exchangeRates, differenceAccounts: async () => ({ gainAccountId: "4940", lossAccountId: "5940" }), now: () => "2026-08-31T10:00:00.000Z" }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/post", { method: "POST", permissions: "accounting.journal.post", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-08-31", autoReverse: true }) }));
    expect(res.status).toBe(201);
    const body = await res.json() as { entryId: string | null; reversalId: string | null };
    expect(body.entryId).not.toBeNull();
    expect(body.reversalId).not.toBeNull();
    // Net AR movement after reversal is zero.
    const bal = await ledger.accountBalance("1100");
    expect(bal.balance.toString()).toBe(Money.fromMajor("5000").toString()); // original 5000 only; reval + reversal cancel
  });

  it("422s when the closing rate is missing (strict policy)", async () => {
    const { ledger, accounts, periods, exchangeRates } = await seed();
    // Wipe the USD rate by using a currency filter for an unrated currency present in the ledger is not possible;
    // instead post an EUR balance with no rate.
    const deps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-31T10:00:00.000Z" };
    await postJournalEntry({ id: "je-eur", date: "2026-08-13", memo: "eur", source: "system", lines: [
      { accountId: "1100", debit: Money.fromMajor("600"), credit: Money.zero(), currency: "EUR", fxRate: "60" },
      { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("600") },
    ] }, deps);
    const app = createFxRevaluationRoutes({ ledger, accounts, periods, numbering: ledger.numbering, exchangeRates, differenceAccounts: async () => ({ gainAccountId: "4940", lossAccountId: "5940" }), now: () => "2026-08-31T10:00:00.000Z" }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/preview", { method: "POST", permissions: "accounting.journal.post", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: "2026-08-31", currencies: ["EUR"] }) }));
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toBe("FX_RATE_MISSING");
  });
});

describe("reconciliation router", () => {
  it("reconciles control accounts and flags unlinked manual lines", async () => {
    const { ledger } = await seed();
    const app = createReconciliationRoutes({
      ledger,
      resolveControls: async () => [
        // Inventory GL balance is 100 (from the manual adj); sub-ledger says 100 → matched.
        { key: "inventory", label: "المخزون", controlAccountId: "1200", naturalBalance: "debit", subLedgerBalance: Money.fromMajor("100") },
        // AR GL balance is 5000; sub-ledger says 4900 → mismatch of 100.
        { key: "ar", label: "ذمم مدينة", controlAccountId: "1100", naturalBalance: "debit", subLedgerBalance: Money.fromMajor("4900") },
      ],
    }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/", { permissions: "accounting.reports.view" }));
    const body = await res.json() as { rows: Array<{ key: string; matched: boolean; difference: string }>; allMatched: boolean; unlinked: Array<{ accountId: string }> };
    expect(body.rows.find((r) => r.key === "inventory")!.matched).toBe(true);
    expect(body.rows.find((r) => r.key === "ar")!.matched).toBe(false);
    expect(body.allMatched).toBe(false);
    expect(body.unlinked.some((u) => u.accountId === "1200")).toBe(true);
  });
});
