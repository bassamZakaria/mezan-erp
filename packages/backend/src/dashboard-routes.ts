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
  insecureHeaderAuthContextResolver,
  type AuthContextResolver,
} from "@mezan/api";

/**
 * The accounts the dashboard's ذمم مدينة tile means: trade, instalment and
 * bounced-cheque receivables owed by CUSTOMERS. Retention (1150) and employee
 * advances (1160) are receivables of a different kind and belong on the balance
 * sheet, not in a collections KPI.
 *
 * 1360 stays for a ledger written before D192, when a bounce parked the debt
 * there and left AR credited; a bounce now reverses onto AR, so on any newer
 * tenant 1360 reads zero. Either way the tile and the aging ladder count the
 * same debt, and the two must agree.
 */
const CUSTOMER_RECEIVABLE_ACCOUNTS = new Set(["1105", "1110", "1360"]);

export interface DashboardDeps {
  readonly accounts: Pick<AccountRepository, "list">;
  readonly ledger: Pick<LedgerRepository, "accountBalance" | "list">;
  readonly countCustomers: () => Promise<number>;
  readonly countSuppliers: () => Promise<number>;
  readonly countItems: () => Promise<number>;
  readonly uow: Pick<UnitOfWork, "users">;
  /** Revenue accounts the income statement shows as other income (D229); they net against expenses here too, so the tile ties to its revenue section. */
  readonly otherIncomeExpenseAccountIds?: () => Promise<readonly string[]>;
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
function periodPnl(entries: readonly JournalEntry[], typeById: Map<string, Account["type"]>, otherIncome: ReadonlySet<string>) {
  let revenue = Money.zero();
  let expenses = Money.zero();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const type = typeById.get(line.accountId);
      if (type === "revenue" && !otherIncome.has(line.accountId)) revenue = revenue.add(line.credit).add(line.debit.negate());
      else if (type === "expense" || type === "revenue") expenses = expenses.add(line.debit).add(line.credit.negate());
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
  resolveAuthContext: AuthContextResolver,
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
    // A reversed entry stays in the books beside its mirror: dropping the
    // original while keeping the mirror counted every reversal twice.
    const onTheBooks = allEntries.filter((e) => e.status === "posted" || e.status === "reversed");
    const inRange = onTheBooks.filter(
      (e) => (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate),
    );

    const otherIncome = new Set(await deps.otherIncomeExpenseAccountIds?.());
    const { revenue, expenses } = periodPnl(inRange, typeById, otherIncome);
    const netProfit = revenue.add(expenses.negate());
    const cash = await sumBalanceWhere(deps.ledger, accounts, toDate, (a) => a.type === "asset" && a.code.startsWith("13"));
    // Customer receivables only — what the aging report means by the word.
    // Summing the whole 11xx subtree swept in employee advances and an
    // inventory provision, so the tile and the report never agreed (D37).
    const receivables = await sumBalanceWhere(deps.ledger, accounts, toDate, (a) => CUSTOMER_RECEIVABLE_ACCOUNTS.has(a.code));
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
