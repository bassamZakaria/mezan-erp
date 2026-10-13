import { Money, type AccountBalance, type LedgerRepository, type PostedLine } from "@mezan/domain";
import { isWholeLedgerView, lineInView, type BranchLineView } from "./branch-view.js";

export type AccountStandingLedger = Pick<LedgerRepository, "accountBalance" | "listLines">;

export interface AccountStanding {
  readonly balance: AccountBalance;
  // INVARIANT: null means the caller reads the whole ledger and the balance is the ledger's own; otherwise these are the only lines the caller may see and the balance is their sum.
  readonly visibleLines: readonly PostedLine[] | null;
}

export async function accountStandingInView(
  ledger: AccountStandingLedger,
  accountId: string,
  view: BranchLineView,
  asOf?: string,
): Promise<AccountStanding> {
  if (isWholeLedgerView(view)) return { balance: await ledger.accountBalance(accountId, asOf), visibleLines: null };
  const visibleLines = ((await ledger.listLines?.({ accountIds: [accountId], toDate: asOf })) ?? []).filter((line) => lineInView(view, line.branchId));
  const debit = Money.sum(visibleLines.map((line) => line.debit));
  const credit = Money.sum(visibleLines.map((line) => line.credit));
  return { balance: { accountId, debit, credit, balance: debit.add(credit.negate()) }, visibleLines };
}

export function serializeAccountBalance(balance: AccountBalance) {
  return {
    accountId: balance.accountId,
    debit: balance.debit.toString(),
    credit: balance.credit.toString(),
    balance: balance.balance.toString(),
  };
}
