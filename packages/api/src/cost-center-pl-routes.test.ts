import { describe, it, expect, afterEach } from "vitest";
import { Money, postJournalEntry, type Account, type JournalPostingDeps } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteCostCenterRepository,
} from "@mezan/persistence";
import { createSessionRegistry, createSessionAuthContextResolver } from "./session-auth.js";
import { createCostCenterPnLRoutes } from "./cost-center-pl-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

function grant(sessions: ReturnType<typeof createSessionRegistry>, permissions: string[]) {
  const token = sessions.issue({ userId: "u1", permissions, roleCode: null, branchScope: "*", warehouseScope: "*" });
  return { headers: { authorization: `Bearer ${token}` } };
}

function req(path: string, init: RequestInit = {}) {
  return new Request(`http://local${path}`, init);
}

async function seed() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const costCenters = createSqliteCostCenterRepository();
  closers.push(ledger, accounts, periods, costCenters);

  await accounts.create(account("1300"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("5000", { type: "expense", naturalBalance: "debit" }));
  await costCenters.create({ id: "cc-a", code: "CC-A", nameAr: "قسم أ", nameEn: null, type: "general", departmentId: null, branchId: null, parentId: null, notes: null, status: "active" });
  await costCenters.create({ id: "cc-b", code: "CC-B", nameAr: "قسم ب", nameEn: null, type: "general", departmentId: null, branchId: null, parentId: null, notes: null, status: "active" });
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const deps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-31T10:00:00.000Z" };

  await postJournalEntry({ id: "je1", date: "2026-08-10", memo: "sale cc-a", source: "system", lines: [
    { accountId: "1300", debit: Money.fromMajor("5000"), credit: Money.zero() },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("5000"), costCenterId: "cc-a" },
  ] }, deps);
  await postJournalEntry({ id: "je2", date: "2026-08-11", memo: "expense cc-a", source: "system", lines: [
    { accountId: "5000", debit: Money.fromMajor("300"), credit: Money.zero(), costCenterId: "cc-a" },
    { accountId: "1300", debit: Money.zero(), credit: Money.fromMajor("300") },
  ] }, deps);
  await postJournalEntry({ id: "je3", date: "2026-08-12", memo: "sale cc-b", source: "system", lines: [
    { accountId: "1300", debit: Money.fromMajor("1000"), credit: Money.zero() },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("1000"), costCenterId: "cc-b" },
  ] }, deps);
  await postJournalEntry({ id: "je4", date: "2026-08-13", memo: "expense no cc", source: "system", lines: [
    { accountId: "5000", debit: Money.fromMajor("50"), credit: Money.zero() },
    { accountId: "1300", debit: Money.zero(), credit: Money.fromMajor("50") },
  ] }, deps);

  return { ledger, accounts, costCenters };
}

function newApp(deps: Awaited<ReturnType<typeof seed>>) {
  const sessions = createSessionRegistry();
  const app = createCostCenterPnLRoutes(deps, createSessionAuthContextResolver(sessions));
  return { app, sessions };
}

describe("cost-center-pl router — permission gate", () => {
  it("401s an unauthenticated caller", async () => {
    const deps = await seed();
    const { app } = newApp(deps);
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(401);
  });

  it("403s a caller without accounting.reports.view", async () => {
    const deps = await seed();
    const { app, sessions } = newApp(deps);
    const res = await app.fetch(req("/", grant(sessions, ["accounting.coa.view"])));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission: string }).permission).toBe("accounting.reports.view");
  });
});

describe("cost-center-pl router — GET /", () => {
  it("groups posted revenue/expense lines by cost center, unassigned bucketed separately, totals reconcile", async () => {
    const deps = await seed();
    const { app, sessions } = newApp(deps);
    const res = await app.fetch(req("/?fromDate=2026-08-01&toDate=2026-08-31", grant(sessions, ["accounting.reports.view"])));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ costCenterId: string | null; code: string; revenue: string; expense: string; profit: string }>;
      totals: { revenue: string; expense: string; profit: string };
    };

    const a = body.rows.find((r) => r.costCenterId === "cc-a")!;
    expect(a.revenue).toBe(Money.fromMajor("5000").toString());
    expect(a.expense).toBe(Money.fromMajor("300").toString());
    expect(a.profit).toBe(Money.fromMajor("4700").toString());

    const b = body.rows.find((r) => r.costCenterId === "cc-b")!;
    expect(b.profit).toBe(Money.fromMajor("1000").toString());

    const unassigned = body.rows.find((r) => r.costCenterId === null)!;
    expect(unassigned.expense).toBe(Money.fromMajor("50").toString());
    expect(unassigned.profit).toBe(Money.fromMajor("-50").toString());

    expect(body.totals.revenue).toBe(Money.fromMajor("6000").toString());
    expect(body.totals.expense).toBe(Money.fromMajor("350").toString());
    expect(body.totals.profit).toBe(Money.fromMajor("5650").toString());
  });

  it("returns empty rows and zero totals for a date range with no activity", async () => {
    const deps = await seed();
    const { app, sessions } = newApp(deps);
    const res = await app.fetch(req("/?fromDate=2020-01-01&toDate=2020-01-31", grant(sessions, ["accounting.reports.view"])));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; totals: { profit: string } };
    expect(body.rows).toEqual([]);
    expect(body.totals.profit).toBe(Money.zero().toString());
  });
});

describe("cost-center-pl router — branch scope (D111)", () => {
  it("never counts another branch's lines for a branch-scoped caller, and keeps unattributed ones", async () => {
    const deps = await seed();
    const posting: JournalPostingDeps = {
      ledger: deps.ledger,
      accounts: deps.accounts,
      periods: { findByDate: async () => ({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" }) },
      numbering: deps.ledger.numbering,
      now: () => "2026-08-31T10:00:00.000Z",
    };
    await postJournalEntry({ id: "je-alex", date: "2026-08-14", memo: "sale cc-a alex", source: "system", lines: [
      { accountId: "1300", debit: Money.fromMajor("700"), credit: Money.zero(), branchId: "BR-ALEX" },
      { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("700"), costCenterId: "cc-a", branchId: "BR-ALEX" },
    ] }, posting);
    await postJournalEntry({ id: "je-main", date: "2026-08-15", memo: "sale cc-a main", source: "system", lines: [
      { accountId: "1300", debit: Money.fromMajor("900"), credit: Money.zero(), branchId: "BR-MAIN" },
      { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("900"), costCenterId: "cc-a", branchId: "BR-MAIN" },
    ] }, posting);

    const { app, sessions } = newApp(deps);
    const revenueOfA = async (branchScope: "*" | string[]) => {
      const token = sessions.issue({ userId: "u1", permissions: ["accounting.reports.view"], roleCode: null, branchScope, warehouseScope: "*" });
      const res = await app.fetch(req("/", { headers: { authorization: `Bearer ${token}` } }));
      const body = (await res.json()) as { rows: { costCenterId: string; revenue: string }[] };
      return body.rows.find((row) => row.costCenterId === "cc-a")?.revenue;
    };

    expect(await revenueOfA("*")).toBe("6600.000000");
    expect(await revenueOfA(["BR-ALEX"])).toBe("5700.000000");
    expect(await revenueOfA(["BR-MAIN"])).toBe("5900.000000");
  });
});
