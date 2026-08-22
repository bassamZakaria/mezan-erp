import { Hono } from "hono";
import {
  Money,
  type Account,
  type AccountRepository,
  type JournalEntry,
  type LedgerRepository,
  type UnitOfWork,
} from "@mezan/domain";
import type { DashboardSummaryDTO } from "@mezan/contracts";
import {
  createPermissionGate,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "@mezan/api";

export interface DashboardDeps {
  readonly accounts: Pick<AccountRepository, "list">;
  readonly ledger: Pick<LedgerRepository, "accountBalance" | "list">;
  readonly countCustomers: () => Promise<number>;
  readonly countSuppliers: () => Promise<number>;
  readonly countItems: () => Promise<number>;
  readonly uow: Pick<UnitOfWork, "users">;
  readonly now?: () => Date;
}

/** Cumulative natural-sign balance of one account as of a date: credit-natural accounts flip debit−credit so "more" is always positive. */
async function naturalBalanceAsOf(
  ledger: DashboardDeps["ledger"],
  account: Account,
  asOf: string | undefined,
): Promise<Money> {
  const b = await ledger.accountBalance(account.id, asOf);
  return account.naturalBalance === "credit" ? b.balance.negate() : b.balance;
}

async function sumBalanceWhere(
  ledger: DashboardDeps["ledger"],
  accounts: readonly Account[],
  asOf: string | undefined,
  predicate: (a: Account) => boolean,
): Promise<Money> {
  let total = Money.zero();
  for (const account of accounts) {
    if (account.isHeader || !predicate(account)) continue;
    total = total.add(await naturalBalanceAsOf(ledger, account, asOf));
  }
  return total;
}

/** Period P&L, summed directly from posted entry lines so a date range genuinely re-scopes revenue/expenses. */
function periodPnl(entries: readonly JournalEntry[], typeById: Map<string, Account["type"]>) {
  let revenue = Money.zero();
  let expenses = Money.zero();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const type = typeById.get(line.accountId);
      if (type === "revenue") revenue = revenue.add(line.credit).add(line.debit.negate());
      else if (type === "expense") expenses = expenses.add(line.debit).add(line.credit.negate());
    }
  }
  return { revenue, expenses };
}

/**
 * `GET /dashboard/summary` (لوحة التحكم) — every figure is computed from real
 * persisted data. Accepts optional `fromDate` / `toDate` (ISO YYYY-MM-DD): the
 * P&L figures (revenue/expenses/net profit) are summed from POSTED journal
 * entry lines within that window, so the range control genuinely re-scopes
 * them; balance-sheet figures (cash/receivables/payables/inventory) are the
 * cumulative balance as of `toDate`. An empty tenant yields zeros and an empty
 * activity list — no fabricated numbers.
 */
export function createDashboardRoutes(
  deps: DashboardDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const now = deps.now ?? (() => new Date());

  app.get("/dashboard/summary", gate("accounting.journal.view"), async (c) => {
    const fromDate = c.req.query("fromDate") || undefined;
    const toDate = c.req.query("toDate") || undefined;

    const accounts = await deps.accounts.list();
    const typeById = new Map(accounts.map((a) => [a.id, a.type]));

    const allEntries = await deps.ledger.list({});
    const posted = allEntries.filter((e) => e.status === "posted");
    const inRange = posted.filter(
      (e) => (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate),
    );

    const { revenue, expenses } = periodPnl(inRange, typeById);
    const netProfit = revenue.add(expenses.negate());
    const cash = await sumBalanceWhere(deps.ledger, accounts, toDate, (a) => a.type === "asset" && a.code.startsWith("13"));
    const receivables = await sumBalanceWhere(deps.ledger, accounts, toDate, (a) => a.type === "asset" && a.code.startsWith("11"));
    const inventoryValue = await sumBalanceWhere(deps.ledger, accounts, toDate, (a) => a.type === "asset" && a.code.startsWith("12"));
    const payables = await sumBalanceWhere(deps.ledger, accounts, toDate, (a) => a.type === "liability" && a.code !== "2200");

    const [customers, suppliers, items, users] = await Promise.all([
      deps.countCustomers(),
      deps.countSuppliers(),
      deps.countItems(),
      deps.uow.users.list().then((u) => u.length),
    ]);

    const recentActivity = [...posted]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 8)
      .map((e) => ({ id: e.id, entryNo: e.entryNo ?? null, date: e.date, memo: e.memo ?? "" }));

    const summary: DashboardSummaryDTO = {
      generatedAt: now().toISOString(),
      counts: {
        accounts: accounts.length,
        customers,
        suppliers,
        items,
        users,
        journalEntries: allEntries.length,
      },
      gl: {
        revenue: revenue.toString(),
        expenses: expenses.toString(),
        netProfit: netProfit.toString(),
        cash: cash.toString(),
        receivables: receivables.toString(),
        payables: payables.toString(),
        inventoryValue: inventoryValue.toString(),
      },
      recentActivity,
    };
    return c.json(summary);
  });

  return app;
}
