import type { Account, AccountType } from "../accounts/account.js";
import { YEAR_END_CLOSE_DOC_TYPE, type JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";

/**
 * Shared GL helpers for the financial-statement reports
 * (docs/catalog/08-reports.md — القوائم المالية). Every statement below is a
 * `ReportDefinition` that aggregates the same primitive: net (debit − credit)
 * movement per account over posted journal entries. This module owns that one
 * aggregation plus the account classification the statements group by, so the
 * reports themselves stay declarative.
 */

/** The data source every financial-statement report reads from. */
export interface GlReportContext {
  readonly accounts: readonly Account[];
  readonly journalEntries: readonly JournalEntry[];
  /**
   * The GL accounts that are cash/bank (النقدية وما في حكمها), when the tenant's
   * chart of accounts does not follow the 11xx-is-cash code convention
   * {@link classifyAccount} falls back to. Authoritative when given.
   */
  readonly cashAccountIds?: readonly string[];
}

/**
 * Balance-sheet / cash-flow section an account rolls up to. Derived from the
 * account `type` (authoritative for the five statement classes) refined by
 * code range: current vs non-current, and whether an asset is cash/bank.
 */
export type AccountSection =
  | "cash"
  | "current-asset"
  | "non-current-asset"
  | "current-liability"
  | "non-current-liability"
  | "equity"
  | "revenue"
  | "expense";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "الأصول",
  liability: "الالتزامات",
  equity: "حقوق الملكية",
  revenue: "الإيرادات",
  expense: "المصروفات",
};

export const ACCOUNT_SECTION_LABELS: Record<AccountSection, string> = {
  cash: "النقدية وما في حكمها",
  "current-asset": "الأصول المتداولة",
  "non-current-asset": "الأصول غير المتداولة",
  "current-liability": "الالتزامات المتداولة",
  "non-current-liability": "الالتزامات غير المتداولة",
  equity: "حقوق الملكية",
  revenue: "الإيرادات",
  expense: "المصروفات",
};

/** Leading two digits of the account code, or NaN for non-numeric codes. */
function codeGroup(code: string): number {
  return Number.parseInt(code.slice(0, 2), 10);
}

/**
 * Classify an account into its statement section. `cashAccountIds`, when
 * supplied, is the authoritative cash/bank set; otherwise the code convention
 * applies: asset codes 11xx = cash/bank, 12xx–14xx = other current assets,
 * 15xx+ = non-current; liability codes 21xx–24xx = current, 25xx+ =
 * non-current. `type` always wins for the top-level class.
 */
export function classifyAccount(account: Account, cashAccountIds?: readonly string[]): AccountSection {
  const group = codeGroup(account.code);
  switch (account.type) {
    case "asset":
      if (cashAccountIds) {
        if (cashAccountIds.includes(account.id)) return "cash";
      } else if (group === 11) {
        return "cash";
      }
      return group >= 15 ? "non-current-asset" : "current-asset";
    case "liability":
      return group >= 25 ? "non-current-liability" : "current-liability";
    case "equity":
      return "equity";
    case "revenue":
      return "revenue";
    case "expense":
      return "expense";
  }
}

export function isCashAccount(account: Account, cashAccountIds?: readonly string[]): boolean {
  return classifyAccount(account, cashAccountIds) === "cash";
}

/** `Money` → its exact major-unit value as a JS number, for report rows/totals. */
export function moneyToNumber(money: Money): number {
  return Number(money.toString());
}

export interface DateRange {
  /** Inclusive lower bound (YYYY-MM-DD). Omit for "from the beginning of time". */
  readonly from?: string;
  /** Inclusive upper bound (YYYY-MM-DD). Omit for "up to the end of time". */
  readonly to?: string;
}

function inRange(date: string, range: DateRange): boolean {
  if (range.from !== undefined && date < range.from) return false;
  if (range.to !== undefined && date > range.to) return false;
  return true;
}

/**
 * Whether an entry's lines are in effect on the ledger. A reversed entry still
 * counts: reversal never mutates or deletes it, it posts a mirror-image entry
 * alongside (gl/reverse.ts), so dropping the original while keeping the mirror
 * would unbalance every statement. Same rule as
 * `LedgerRepository.accountBalance` (`status IN ('posted','reversed')`).
 * Drafts and pending entries are excluded.
 */
export function isLedgerEffective(entry: JournalEntry): boolean {
  return entry.status === "posted" || entry.status === "reversed";
}

/** True for the year-end closing entry, which no performance statement counts as activity. */
export function isYearEndClose(entry: JournalEntry): boolean {
  return entry.sourceDocType === YEAR_END_CLOSE_DOC_TYPE;
}

/**
 * Net (debit − credit) movement per account across every posted line whose
 * entry date falls in `range`. Positive = net debit (debit-normal balance),
 * negative = net credit. The one primitive all seven statements build on.
 *
 * `excludeYearEndClose` drops the closing entry — pass it for a performance
 * statement (income, cash flow), never for a position one (balance sheet).
 */
export function netBalancesByAccount(
  journalEntries: readonly JournalEntry[],
  range: DateRange = {},
  options: { readonly excludeYearEndClose?: boolean } = {},
): Map<string, Money> {
  const balances = new Map<string, Money>();
  for (const entry of journalEntries) {
    if (!isLedgerEffective(entry)) continue;
    if (options.excludeYearEndClose === true && isYearEndClose(entry)) continue;
    if (!inRange(entry.date, range)) continue;
    for (const line of entry.lines) {
      const net = line.debit.add(line.credit.negate());
      balances.set(line.accountId, (balances.get(line.accountId) ?? Money.zero()).add(net));
    }
  }
  return balances;
}

/** Net (debit − credit) movement for a single account over `range`, as a number. */
export function accountNet(
  journalEntries: readonly JournalEntry[],
  accountId: string,
  range: DateRange = {},
): number {
  return moneyToNumber(netBalancesByAccount(journalEntries, range).get(accountId) ?? Money.zero());
}
