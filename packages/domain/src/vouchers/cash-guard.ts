/**
 * Cash-negative guard (docs/archive/catalog/04 + docs/archive/catalog/09 §"سياسة الخزينة").
 *
 * Two independent tenant switches, one per account type — the pair the settings
 * screen presents under سياسة الخزينة:
 *
 * - `preventNegativeCashBalance` (منع الرصيد السالب للحسابات النقدية) blocks a
 *   CASH treasury account (صندوق نقدي) from going negative — you cannot pay out
 *   physical cash you do not hold.
 * - `allowNegativeTreasury` (السماح بالرصيد السالب للحسابات البنكية) permits a
 *   BANK account to overdraft; switch it off and bank accounts are guarded too.
 *
 * The guard only bites on the treasury account whose balance DECREASES: the
 * paying account for a payment, and the SOURCE account for a transfer (the
 * destination only grows). Receipts always pass.
 *
 * Balance is read from the live GL ledger (a cash/asset account's on-hand cash
 * is debit − credit), so the guard reflects every previously posted voucher.
 */

import { Money } from "../money/index.js";
import type { LedgerRepository } from "../gl/ledger.js";
import type { TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import { CashBalanceWouldGoNegativeError } from "./errors.js";
import { voucherNetPaid, type VoucherLine } from "./voucher-document.js";

export interface CashGuardDeps {
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById">;
  readonly ledger: Pick<LedgerRepository, "accountBalance">;
  /** The tenant's "منع الرصيد السالب للحسابات النقدية" policy (settings.preventNegativeCashBalance). */
  readonly preventNegativeCashBalance: boolean;
  /** The tenant's "السماح بالرصيد السالب للحسابات البنكية" policy (settings.allowNegativeTreasury). */
  readonly allowNegativeTreasury: boolean;
}

/**
 * Throws {@link CashBalanceWouldGoNegativeError} when confirming this voucher
 * line would take its source treasury account below zero, for whichever account
 * types the tenant guards. No-op for receipts and for an unguarded type.
 */
export async function assertCashBalanceAllows(
  line: VoucherLine,
  deps: CashGuardDeps,
  asOfDate?: string,
): Promise<void> {
  if (line.direction === "receipt") return; // money in never reduces a balance

  // The account whose balance decreases: the paying/source treasury account.
  const treasuryAccountId = line.treasuryAccountId;
  const glAccountId = line.treasuryGlAccountId;

  const account = await deps.treasuryAccounts.findById(treasuryAccountId);
  // An unknown account is left to the GL layer to reject — the guard stays
  // conservative and only speaks for the two types it has a policy for.
  if (!account) return;
  const guarded = account.type === "cash" ? deps.preventNegativeCashBalance : !deps.allowNegativeTreasury;
  if (!guarded) return;

  // What LEAVES the treasury, which is the settling amount less any tax
  // withheld — the withheld slice never becomes cash. In BASE currency: the
  // ledger balance it is compared against is base, and comparing a foreign
  // figure to it let a USD payment pass a guard it should have failed (B-4).
  const leaving = voucherNetPaid(line);
  const balance = await deps.ledger.accountBalance(glAccountId, asOfDate);
  const projected = Money.fromScaled(balance.balance.scaled - leaving.scaled);
  if (projected.scaled < 0n) {
    throw new CashBalanceWouldGoNegativeError(
      treasuryAccountId,
      balance.balance.toString(),
      leaving.toString(),
      account.type,
    );
  }
}
