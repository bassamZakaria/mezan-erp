import type { TreasuryAccountDTO } from "@mezan/contracts";

/**
 * Live balances for the list screens. What a customer or supplier owes comes
 * from the server's aging ladder (`owed`, D195/D201); only the treasury
 * balance is read here, off the trial balance.
 */

/**
 * Each treasury account's live balance, read from **its own GL account** in the
 * trial balance rather than re-derived from vouchers.
 *
 * Deriving it from vouchers was measurably wrong: vouchers alone put the bank
 * account at −107,504.00 while GL 1310 stood at +141,396.00, because cheques,
 * van settlements and the opening import also post to treasury accounts. A cash
 * box's balance IS its ledger account; anything else is a second opinion that
 * will drift.
 */
export function treasuryBalanceById(
  accounts: readonly TreasuryAccountDTO[],
  trialBalance: readonly { accountId: string; debit: number; credit: number }[],
): Map<string, number> {
  const byAccount = new Map<string, number>();
  for (const row of trialBalance) byAccount.set(row.accountId, row.debit - row.credit);

  const balance = new Map<string, number>();
  for (const a of accounts) balance.set(a.id, a.glAccountId ? (byAccount.get(a.glAccountId) ?? 0) : 0);
  return balance;
}
