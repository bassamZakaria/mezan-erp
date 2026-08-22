/**
 * Cash-negative guard (docs/catalog/04 + docs/catalog/09 §"سياسة الخزينة").
 *
 * A CASH treasury account (صندوق نقدي) can never go negative when the tenant's
 * `preventNegativeCashBalance` policy is on — you cannot pay out physical cash
 * you do not hold. A BANK account is explicitly exempt (overdraft allowed). The
 * guard only bites on the treasury account whose balance DECREASES: the paying
 * account for a payment, and the SOURCE account for a transfer (the destination
 * only grows). Receipts always pass.
 *
 * Balance is read from the live GL ledger (a cash/asset account's on-hand cash
 * is debit − credit), so the guard reflects every previously posted voucher.
 */

import { Money } from "../money/index.js";
import type { LedgerRepository } from "../gl/ledger.js";
import type { TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import { CashBalanceWouldGoNegativeError } from "./errors.js";
import type { VoucherLine } from "./voucher-document.js";

export interface CashGuardDeps {
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById">;
  readonly ledger: Pick<LedgerRepository, "accountBalance">;
  /** The tenant's "منع الرصيد السالب للحسابات النقدية" policy (settings.preventNegativeCashBalance). */
  readonly preventNegativeCashBalance: boolean;
}

/**
 * Throws {@link CashBalanceWouldGoNegativeError} when confirming this voucher
 * line would take its cash source treasury account below zero. No-op for
 * receipts, bank accounts, or when the policy is off.
 */
export async function assertCashBalanceAllows(
  line: VoucherLine,
  deps: CashGuardDeps,
  asOfDate?: string,
): Promise<void> {
  if (!deps.preventNegativeCashBalance) return;
  if (line.direction === "receipt") return; // money in never reduces a balance

  // The account whose balance decreases: the paying/source treasury account.
  const treasuryAccountId = line.treasuryAccountId;
  const glAccountId = line.treasuryGlAccountId;

  const account = await deps.treasuryAccounts.findById(treasuryAccountId);
  // Bank accounts may overdraft; only guard cash accounts. Unknown accounts are
  // left to the GL layer to reject — the guard stays conservative (cash only).
  if (!account || account.type !== "cash") return;

  const balance = await deps.ledger.accountBalance(glAccountId, asOfDate);
  const projected = Money.fromScaled(balance.balance.scaled - line.amount.scaled);
  if (projected.scaled < 0n) {
    throw new CashBalanceWouldGoNegativeError(
      treasuryAccountId,
      balance.balance.toString(),
      line.amount.toString(),
    );
  }
}
