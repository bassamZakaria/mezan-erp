import type { Context } from "hono";
import type { TreasuryAccount, TreasuryAccountRepository } from "@mezan/domain";

export enum TreasuryLedgerRefusalCode {
  AccountNotFound = "TREASURY_ACCOUNT_NOT_FOUND",
  LedgerAccountMismatch = "TREASURY_GL_ACCOUNT_MISMATCH",
}

export type TreasuryWithLedgerAccount = TreasuryAccount & { readonly glAccountId: string };

/**
 * SECURITY: the ledger account money moves through is read from the stored
 * treasury account. A request may repeat it, never choose it — a caller who
 * named another account's ledger account posted its own drawer's voucher
 * against the head-office bank.
 */
export async function treasuryLedgerAccount(
  c: Context,
  treasuryAccounts: Pick<TreasuryAccountRepository, "findById">,
  treasuryAccountId: string,
  statedGlAccountId: string | null | undefined,
): Promise<TreasuryWithLedgerAccount | Response> {
  const treasury = await treasuryAccounts.findById(treasuryAccountId);
  if (!treasury || treasury.status !== "active" || !treasury.glAccountId) {
    return c.json(
      {
        error: TreasuryLedgerRefusalCode.AccountNotFound,
        message: "حساب الخزينة غير موجود أو غير نشط أو بلا حساب دفتري.",
        messageEn: "The treasury account does not exist, is inactive, or has no ledger account.",
      },
      422,
    );
  }
  if (statedGlAccountId !== null && statedGlAccountId !== undefined && statedGlAccountId !== treasury.glAccountId) {
    return c.json(
      {
        error: TreasuryLedgerRefusalCode.LedgerAccountMismatch,
        message: "الحساب الدفتري المذكور لا يطابق الحساب المربوط بحساب الخزينة؛ النظام يحدده من حساب الخزينة نفسه.",
        messageEn: "The stated ledger account is not the one this treasury account is linked to; it is taken from the treasury account itself.",
      },
      422,
    );
  }
  return treasury as TreasuryWithLedgerAccount;
}
