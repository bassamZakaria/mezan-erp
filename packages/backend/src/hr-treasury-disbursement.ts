import { randomUUID } from "node:crypto";
import {
  VoucherService,
  type TreasuryAccountRepository,
  type TreasuryDisbursementPort,
  type VoucherServiceDeps,
} from "@mezan/domain";

/**
 * Binds HR's `TreasuryDisbursementPort` to the REAL treasury voucher engine:
 * an employee advance being paid out and an approved payroll run being settled
 * both create + confirm a "مصروف آخر" (other_expense) PAYMENT voucher whose
 * counterparty GL account is supplied by the caller — 1160 سلف الموظفين for an
 * advance, 2170 رواتب مستحقة for payroll.
 *
 * Going through the voucher engine (rather than posting a bespoke cash entry)
 * is what gives HR disbursements the cash-negative guard, CV- numbering, the
 * TREASURY_VOUCHER_CONFIRM workflow gate, the audit trail and the same GL
 * posting path every other treasury movement uses.
 */
export function createHrTreasuryDisbursementPort(
  deps: VoucherServiceDeps & { readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById"> },
): TreasuryDisbursementPort {
  const vouchers = new VoucherService(deps);
  return {
    async disburse(request) {
      const treasury = await deps.treasuryAccounts.findById(request.treasuryAccountId);
      if (!treasury?.glAccountId) {
        throw new Error(`Treasury account "${request.treasuryAccountId}" has no GL account.`);
      }
      const voucherId = request.id || randomUUID();
      await vouchers.createVoucher({
        id: voucherId,
        date: request.date,
        memo: request.memo,
        voucherType: "other_expense",
        amount: request.amount,
        branchId: request.branchId,
        paymentMethod: request.paymentMethod ?? "cash",
        treasuryAccountId: request.treasuryAccountId,
        treasuryGlAccountId: treasury.glAccountId,
        counterpartyGlAccountId: request.counterpartyGlAccountId,
        referenceNo: request.referenceNo ?? null,
      });
      const { document } = await vouchers.confirmVoucher(voucherId);
      return {
        voucherId,
        voucherNo: document.docNo,
        journalEntryId: document.journalEntryId,
      };
    },
  };
}
