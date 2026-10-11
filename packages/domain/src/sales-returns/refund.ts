/**
 * استرداد للعميل — paying a confirmed sales return back in cash (R3.9).
 *
 * A confirmed return credits the customer's receivable; it does NOT move
 * money. Until someone pays it out the return sits بانتظار دفع المبلغ. The
 * refund is a real treasury disbursement — a `customer_refund` voucher that
 * debits AR and credits the till — so the credit note and the cash leave
 * together. A state flag that moves no money is the defect, not the feature.
 *
 * Nothing here stores a "refunded" flag: what is still owed is DERIVED from
 * the confirmed refund vouchers posted against the return. Reversing the
 * voucher therefore restores both the ledger and the awaiting-refund state,
 * with no second fact to keep in step.
 */

import { Money } from "../money/index.js";
import { salesReturnGrandTotal, type SalesReturnDocument } from "./sales-return-document.js";

export class SalesReturnNotRefundableError extends Error {
  readonly code = "SALES_RETURN_NOT_REFUNDABLE";
  constructor(message: string) {
    super(message);
    this.name = "SalesReturnNotRefundableError";
  }
}

/**
 * LEDGER INVARIANT: a refund settles a return, so it is paid from a drawer of
 * the return's own branch or from an account the company holds. Paying it from
 * another branch's drawer would book one branch's refund against another's cash.
 */
export class SalesReturnRefundTreasuryBranchError extends Error {
  readonly code = "SALES_RETURN_REFUND_TREASURY_BRANCH";
  readonly messageEn =
    "This return belongs to another branch than the cash or bank account chosen. Pay the refund from a drawer of the return's branch or from a company-level account, or move the cash with an inter-branch transfer first.";
  constructor() {
    super("المرتجع يتبع فرعًا غير فرع الخزينة المختارة. اصرف الاسترداد من خزينة فرع المرتجع أو من حساب على مستوى الشركة، أو حوّل النقدية بين الفرعين أولًا.");
    this.name = "SalesReturnRefundTreasuryBranchError";
  }
}

/** One confirmed refund already posted against a return. */
export interface SalesReturnRefund {
  readonly voucherId: string;
  readonly voucherNo: string | null;
  readonly date: string;
  readonly amount: Money;
}

export interface SalesReturnRefundCommand {
  readonly returnId: string;
  readonly customerId: string;
  readonly amount: Money;
  readonly treasuryAccountId: string;
  readonly paymentMethod: "cash" | "bank" | "cheque" | "card" | "wallet";
  readonly date: string;
  readonly memo: string | null;
  readonly referenceNo: string | null;
  readonly actor?: string;
}

/**
 * The seam a real treasury module plugs into. `list` is how the refundable
 * amount is recomputed from posted vouchers rather than read off a stored
 * flag; `post` creates and CONFIRMS the disbursement.
 */
export interface SalesReturnRefundPort {
  list(returnId: string): Promise<readonly SalesReturnRefund[]>;
  post(command: SalesReturnRefundCommand): Promise<{ voucherId: string; voucherNo: string | null }>;
}

export function sumRefunds(refunds: readonly SalesReturnRefund[]): Money {
  return Money.sum(refunds.map((r) => r.amount));
}

/** What the return still owes the customer: its grand total minus what confirmed vouchers already paid out. */
export function refundDue(doc: SalesReturnDocument, refunds: readonly SalesReturnRefund[]): Money {
  if (doc.status !== "confirmed") return Money.zero();
  const remaining = salesReturnGrandTotal(doc).scaled - sumRefunds(refunds).scaled;
  return Money.fromScaled(remaining > 0n ? remaining : 0n);
}

/**
 * بانتظار دفع المبلغ. A confirmed return with nothing left to pay out is
 * settled, not awaiting — which is exactly what reversing the refund voucher
 * undoes.
 */
export function isAwaitingRefund(doc: SalesReturnDocument, refunds: readonly SalesReturnRefund[] = []): boolean {
  return refundDue(doc, refunds).scaled > 0n;
}

/**
 * Guards the refund. The cap is recomputed HERE from the posted return and
 * the posted vouchers — never from an amount the caller also supplied, which
 * is how the same goods once became returnable forever.
 */
export function assertRefundable(
  doc: SalesReturnDocument,
  refunds: readonly SalesReturnRefund[],
  amount: Money,
): void {
  if (doc.status !== "confirmed") {
    throw new SalesReturnNotRefundableError("لا يمكن رد مبلغ إلا على مرتجع مؤكد.");
  }
  if (amount.scaled <= 0n) {
    throw new SalesReturnNotRefundableError("قيمة الرد يجب أن تكون أكبر من صفر.");
  }
  const due = refundDue(doc, refunds);
  if (due.scaled === 0n) {
    throw new SalesReturnNotRefundableError("تم رد كامل قيمة هذا المرتجع بالفعل.");
  }
  if (amount.scaled > due.scaled) {
    throw new SalesReturnNotRefundableError(
      `قيمة الرد (${amount.toString()}) تتجاوز المتبقي على المرتجع (${due.toString()}).`,
    );
  }
}
