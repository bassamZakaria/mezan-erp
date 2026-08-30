import { describe, it, expect, afterEach } from "vitest";
import { Money, postJournalEntry, type Account, type JournalPostingDeps } from "@mezan/domain";
import { createSqliteLedgerStore, createSqliteAccountRepository, createSqliteFiscalPeriodRepository } from "@mezan/persistence";
import { createSessionRegistry, createSessionAuthContextResolver } from "./session-auth.js";
import { createReconciliationRoutes, type ReconciliationControl } from "./reconciliation-routes.js";

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
  closers.push(ledger, accounts, periods);

  await accounts.create(account("1100")); // AR
  await accounts.create(account("1200")); // inventory control
  await accounts.create(account("1300")); // cash
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const deps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-31T10:00:00.000Z" };

  await postJournalEntry({ id: "je1", date: "2026-08-10", memo: "sale", source: "system", lines: [
    { accountId: "1100", debit: Money.fromMajor("5000"), credit: Money.zero() },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("5000") },
  ] }, deps);
  await postJournalEntry({ id: "je2", date: "2026-08-12", memo: "manual inventory adj", source: "manual", lines: [
    { accountId: "1200", debit: Money.fromMajor("100"), credit: Money.zero() },
    { accountId: "1300", debit: Money.zero(), credit: Money.fromMajor("100") },
  ] }, deps);

  return { ledger, accounts };
}

function newApp(deps: Awaited<ReturnType<typeof seed>>, resolveControls: () => Promise<readonly ReconciliationControl[]>) {
  const sessions = createSessionRegistry();
  const app = createReconciliationRoutes({ ledger: deps.ledger, resolveControls }, createSessionAuthContextResolver(sessions));
  return { app, sessions };
}

describe("reconciliation router — permission gate", () => {
  it("401s an unauthenticated caller", async () => {
    const deps = await seed();
    const { app } = newApp(deps, async () => []);
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(401);
  });

  it("403s a caller without accounting.reports.view", async () => {
    const deps = await seed();
    const { app, sessions } = newApp(deps, async () => []);
    const res = await app.fetch(req("/", grant(sessions, ["accounting.coa.view"])));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission: string }).permission).toBe("accounting.reports.view");
  });
});

describe("reconciliation router — GET /", () => {
  it("matches a control account whose sub-ledger balance agrees with the GL, and flags a mismatch", async () => {
    const deps = await seed();
    const controls: ReconciliationControl[] = [
      { key: "inventory", label: "المخزون", controlAccountId: "1200", naturalBalance: "debit", subLedgerBalance: Money.fromMajor("100") },
      { key: "ar", label: "ذمم مدينة", controlAccountId: "1100", naturalBalance: "debit", subLedgerBalance: Money.fromMajor("4900") },
    ];
    const { app, sessions } = newApp(deps, async () => controls);
    const res = await app.fetch(req("/", grant(sessions, ["accounting.reports.view"])));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{ key: string; controlAccountId: string; subLedgerBalance: string; glBalance: string; difference: string; matched: boolean }>;
      allMatched: boolean;
      unlinked: Array<{ accountId: string; entryId: string }>;
    };

    const inv = body.rows.find((r) => r.key === "inventory")!;
    expect(inv.glBalance).toBe(Money.fromMajor("100").toString());
    expect(inv.subLedgerBalance).toBe(Money.fromMajor("100").toString());
    expect(inv.matched).toBe(true);
    expect(inv.difference).toBe(Money.zero().toString());

    const ar = body.rows.find((r) => r.key === "ar")!;
    expect(ar.glBalance).toBe(Money.fromMajor("5000").toString());
    expect(ar.subLedgerBalance).toBe(Money.fromMajor("4900").toString());
    expect(ar.matched).toBe(false);
    expect(ar.difference).toBe(Money.fromMajor("-100").toString());

    expect(body.allMatched).toBe(false);
    expect(body.unlinked.some((u) => u.accountId === "1200" && u.entryId === "je2")).toBe(true);
  });

  it("allMatched is true and unlinked is empty when every control ties out and no manual line touches a control account", async () => {
    const deps = await seed();
    const controls: ReconciliationControl[] = [
      { key: "ar", label: "ذمم مدينة", controlAccountId: "1100", naturalBalance: "debit", subLedgerBalance: Money.fromMajor("5000") },
    ];
    const { app, sessions } = newApp(deps, async () => controls);
    const res = await app.fetch(req("/", grant(sessions, ["accounting.reports.view"])));
    const body = (await res.json()) as { allMatched: boolean; unlinked: unknown[] };
    // The 1200 manual line still exists in the ledger but 1200 is not a control here, so it never surfaces as unlinked.
    expect(body.allMatched).toBe(true);
    expect(body.unlinked).toEqual([]);
  });

  it("returns an empty rows array and allMatched true with no controls configured", async () => {
    const deps = await seed();
    const { app, sessions } = newApp(deps, async () => []);
    const res = await app.fetch(req("/", grant(sessions, ["accounting.reports.view"])));
    const body = (await res.json()) as { rows: unknown[]; allMatched: boolean };
    expect(body.rows).toEqual([]);
    expect(body.allMatched).toBe(true);
  });
});
