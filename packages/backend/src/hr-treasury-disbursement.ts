import { randomUUID } from "node:crypto";
import {
  DisbursementTreasuryAccountNotFoundError,
  TreasuryDisbursementHeldError,
  VoucherService,
  type TreasuryAccountRepository,
  type TreasuryDisbursementPort,
  type TreasuryDisbursementRequest,
  type VoucherServiceDeps,
} from "@mezan/domain";

/**
 * Binds HR's `TreasuryDisbursementPort` to the REAL treasury voucher engine:
 * an employee advance being paid out and an approved payroll run being settled
 * both create + confirm a "مصروف آخر" (other_expense) PAYMENT voucher whose
 * counterparty GL account is supplied by the caller — 1160 سلف الموظفين for an
 * advance, 2170 رواتب مستحقة for payroll. An advance repaid in cash outside
 * payroll comes back through an "إيراد آخر" (other_income) RECEIPT voucher
 * against 1160, so it credits the asset rather than booking income.
 *
 * Going through the voucher engine (rather than posting a bespoke cash entry)
 * is what gives HR disbursements the cash-negative guard, CV- numbering, the
 * TREASURY_VOUCHER_CONFIRM workflow gate, the audit trail and the same GL
 * posting path every other treasury movement uses.
 */
export function createHrTreasuryDisbursementPort(
  deps: VoucherServiceDeps & { readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById"> },
): TreasuryDisbursementPort {
  const vouchers = new VoucherService({ ...deps, documentIdsMintedBySystem: true });
  async function post(request: TreasuryDisbursementRequest, voucherType: "other_expense" | "other_income") {
    const treasury = await deps.treasuryAccounts.findById(request.treasuryAccountId);
    if (!treasury || treasury.status !== "active" || !treasury.glAccountId) {
      throw new DisbursementTreasuryAccountNotFoundError(request.treasuryAccountId);
    }
    const voucherId = request.id || randomUUID();
    // A gated voucher is a TWO-step flow: the first call leaves it
    // بانتظار الموافقة and refuses, and the call after the approval finds that
    // same voucher already posted. Re-creating it would collide on its
    // deterministic id.
    const existing = await vouchers.findById(voucherId);
    if (existing?.status === "confirmed") {
      return { voucherId, voucherNo: existing.docNo, journalEntryId: existing.journalEntryId };
    }
    if (!existing) {
      await vouchers.createVoucher({
        id: voucherId,
        date: request.date,
        memo: request.memo,
        voucherType,
        amount: request.amount,
        branchId: request.branchId,
        paymentMethod: request.paymentMethod ?? "cash",
        treasuryAccountId: request.treasuryAccountId,
        treasuryGlAccountId: treasury.glAccountId,
        counterpartyGlAccountId: request.counterpartyGlAccountId,
        referenceNo: request.referenceNo ?? null,
      });
    }
    const { document, held } = await vouchers.confirmVoucher(voucherId);
    if (held) throw new TreasuryDisbursementHeldError(voucherId);
    return {
      voucherId,
      voucherNo: document.docNo,
      journalEntryId: document.journalEntryId,
    };
  }
  return {
    disburse: (request) => post(request, "other_expense"),
    receive: (request) => post(request, "other_income"),
    reverse: async (voucherId, opts) => {
      await vouchers.reverseVoucher(voucherId, opts);
    },
  };
}
