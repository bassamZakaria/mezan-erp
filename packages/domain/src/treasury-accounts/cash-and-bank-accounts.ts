import type { Account } from "../accounts/account.js";

export const CASH_AND_BANK_ROUTING_KEY = "control.cash_and_bank";
export const RESTRICTED_CASH_ROUTING_KEY = "contracting.restricted_cash";

export interface CashAndBankSources {
  readonly parentAccountId: string | null;
  readonly restrictedAccountIds?: readonly (string | null)[];
  readonly treasuryLedgerAccountIds?: readonly (string | null)[];
}

const MAX_CHART_DEPTH = 32;

export function sitsUnderAccount(account: Pick<Account, "parentId">, ancestorId: string, byId: ReadonlyMap<string, Pick<Account, "parentId">>): boolean {
  let parentId = account.parentId;
  for (let depth = 0; parentId && depth < MAX_CHART_DEPTH; depth++) {
    if (parentId === ancestorId) return true;
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

/**
 * LEDGER INVARIANT: every statement that says "cash" reads this one set — the
 * postable assets under the tenant's cash-and-bank header plus whatever a
 * treasury account posts through — so a drawer opened later is cash everywhere
 * the day it is opened.
 */
export function cashAndBankLedgerAccountIds(accounts: readonly Account[], sources: CashAndBankSources): string[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const restricted = new Set(sources.restrictedAccountIds ?? []);
  const linked = new Set(sources.treasuryLedgerAccountIds ?? []);
  const parentId = sources.parentAccountId;
  return accounts
    .filter((account) => !account.isHeader && account.type === "asset" && !restricted.has(account.id))
    .filter((account) => linked.has(account.id) || (parentId !== null && sitsUnderAccount(account, parentId, byId)))
    .map((account) => account.id);
}
