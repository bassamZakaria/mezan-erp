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
 * LEDGER INVARIANT: the balance is the treasury account's OWN — the posted
 * lines stamped with it on its ledger account. Several drawers may share one
 * ledger account, and reading that account's whole balance let an empty drawer
 * pay out of cash another drawer holds. Lines on a shared ledger account that
 * name no treasury account are held by one of the sharers only: the first by
 * code.
 */

import { Money } from "../money/index.js";
import type { LedgerRepository } from "../gl/ledger.js";
import type { TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import { CashBalanceWouldGoNegativeError } from "./errors.js";
import { voucherNetPaid, type VoucherLine } from "./voucher-document.js";

export interface CashGuardDeps {
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById"> & Partial<Pick<TreasuryAccountRepository, "list">>;
  readonly ledger: Pick<LedgerRepository, "accountBalance" | "treasuryAccountBalance">;
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
  const balance = await treasuryAccountOwnBalance({ id: treasuryAccountId, glAccountId }, deps, asOfDate);
  const projected = Money.fromScaled(balance.scaled - leaving.scaled);
  if (projected.scaled < 0n) {
    throw new CashBalanceWouldGoNegativeError(
      treasuryAccountId,
      balance.toString(),
      leaving.toString(),
      account.type,
    );
  }
}

export async function treasuryAccountOwnBalance(
  account: { readonly id: string; readonly glAccountId: string },
  deps: Pick<CashGuardDeps, "treasuryAccounts" | "ledger">,
  asOfDate?: string,
): Promise<Money> {
  if (!deps.ledger.treasuryAccountBalance) return (await deps.ledger.accountBalance(account.glAccountId, asOfDate)).balance;
  const sharers = ((await deps.treasuryAccounts.list?.()) ?? []).filter((other) => other.glAccountId === account.glAccountId);
  const holderOfUnattributed = [...sharers].sort((a, b) => a.code.localeCompare(b.code))[0]?.id ?? account.id;
  return deps.ledger.treasuryAccountBalance({
    accountId: account.glAccountId,
    treasuryAccountId: account.id,
    withUnattributed: holderOfUnattributed === account.id,
    asOfDate,
  });
}
