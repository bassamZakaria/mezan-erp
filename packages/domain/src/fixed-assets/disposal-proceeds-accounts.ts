import type { Account } from "../accounts/account.js";
import { sitsUnderAccount } from "../treasury-accounts/cash-and-bank-accounts.js";

export enum DisposalProceedsAccountKind {
  Cash = "cash",
  Receivable = "receivable",
}

export interface DisposalProceedsAccount {
  readonly account: Account;
  readonly kind: DisposalProceedsAccountKind;
}

export interface DisposalProceedsSources {
  readonly cashAccountIds: readonly string[];
  readonly receivableControlAccountId: string | null;
  readonly partyControlAccountIds: readonly string[];
}

/**
 * LEDGER INVARIANT: where an asset's sale proceeds may land is derived from the
 * chart's structure — the one cash-and-bank set, or a receivable beside the
 * customers' control account — never from an account-code prefix. A party
 * control account is left out: a line on it must name a customer, and a
 * disposal names none.
 */
export function disposalProceedsAccounts(accounts: readonly Account[], sources: DisposalProceedsSources): DisposalProceedsAccount[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const cash = new Set(sources.cashAccountIds);
  const partyControls = new Set(sources.partyControlAccountIds);
  const receivablesHeaderId = sources.receivableControlAccountId === null ? null : (byId.get(sources.receivableControlAccountId)?.parentId ?? null);
  const kindOf = (account: Account): DisposalProceedsAccountKind | null => {
    if (account.isHeader || account.type !== "asset" || account.status !== "active") return null;
    if (cash.has(account.id)) return DisposalProceedsAccountKind.Cash;
    if (receivablesHeaderId !== null && !partyControls.has(account.id) && sitsUnderAccount(account, receivablesHeaderId, byId)) return DisposalProceedsAccountKind.Receivable;
    return null;
  };
  return accounts.flatMap((account) => {
    const kind = kindOf(account);
    return kind === null ? [] : [{ account, kind }];
  });
}
