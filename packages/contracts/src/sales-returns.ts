import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { documentStatusSchema } from "./documents.js";
import { isoDateOrInstant } from "./iso-date.js";
import { documentApprovalSchema } from "./workflow.js";

/**
 * Wire contracts for Sales Returns (مرتجعات المبيعات، docs/archive/catalog/01), a
 * document-framework consumer. Money/Qty cross the wire as exact decimal
 * strings (same convention as journal.ts/inventory.ts) — never floats.
 */

/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

export const salesReturnReasonSchema = z.enum([
  "DEFECTIVE",
  "WRONG_ITEM",
  "EXCESS_QTY",
  "CHANGED_MIND",
  "OTHER",
]);

export const salesReturnLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  customerId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  sourceLineId: z.string().min(1).nullish(),
  reason: salesReturnReasonSchema,
  availableQty: positiveDecimalString,
  qty: positiveDecimalString,
  unitPrice: positiveDecimalString,
  unitCost: positiveDecimalString,
  taxAmount: positiveDecimalString,
  /** The VAT rate the source invoice line charged, so a mixed-rate return posts one tagged VAT line per rate (D76). */
  taxRatePercent: z.number().nullable().optional(),
  /** بُعد المشروع, inherited from the source invoice — see `/from-invoice`. */
  projectId: z.string().min(1).nullable().optional(),
});

export const createSalesReturnSchema = z.object({
  id: z.string().min(1),
  date: isoDateOrInstant,
  memo: z.string().default(""),
  lines: z.array(salesReturnLineSchema).min(1),
});

/** Convenience request: derive return lines from a resolved source-invoice snapshot + requested qty per item. */
export const salesReturnRequestedQtySchema = z.object({
  itemId: z.string().min(1),
  sourceLineId: z.string().min(1).nullish(),
  qty: positiveDecimalString,
  /** Per-line سبب الإرجاع (R3.9); omitted lines fall back to the document's reason. */
  reason: salesReturnReasonSchema.optional(),
});

export const buildSalesReturnFromInvoiceSchema = z.object({
  id: z.string().min(1),
  date: isoDateOrInstant,
  memo: z.string().default(""),
  sourceInvoiceId: z.string().min(1),
  warehouseId: z.string().min(1),
  reason: salesReturnReasonSchema,
  requested: z.array(salesReturnRequestedQtySchema).min(1),
});


export const salesReturnDocumentSchema = z.object({
  id: z.string(),
  docType: z.literal("SALES_RETURN"),
  docNo: z.string().nullable(),
  date: z.string(),
  memo: z.string(),
  status: documentStatusSchema,
  lines: z.array(
    salesReturnLineSchema.extend({
      taxRateId: z.string().nullable().optional(),
      /** The source invoice's currency and confirm rate, stamped by the server (D203). */
      currency: z.string().nullable().optional(),
      fxRate: z.string().nullable().optional(),
      /** What this line credits, in base currency at `fxRate`. */
      baseCredit: z.string().optional(),
    }),
  ),
  /** What the return credits AR with, in base currency at the source invoice's rate (D203). */
  grandTotal: z.string().optional(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  reversesDocId: z.string().nullable(),
  reversedByDocId: z.string().nullable(),
  voidReason: z.string().nullable().optional(),
  workflowRequestId: z.string().nullable(),
  approval: documentApprovalSchema.nullable().optional(),
  journalEntryId: z.string().nullable(),
  /** بانتظار دفع المبلغ — derived from the refund vouchers posted, never a stored flag. */
  awaitingRefund: z.boolean(),
  refundDue: z.string(),
  refundedTotal: z.string(),
  refunds: z.array(
    z.object({
      voucherId: z.string(),
      voucherNo: z.string().nullable(),
      date: z.string(),
      amount: moneyString,
    }),
  ),
});

/** POST /sales-returns/:id/refund — استرداد للعميل, a real treasury disbursement. */
export const refundSalesReturnSchema = z.object({
  amount: positiveDecimalString,
  treasuryAccountId: z.string().min(1),
  paymentMethod: z.enum(["cash", "bank", "cheque", "card", "wallet"]).optional(),
  date: isoDateOrInstant.optional(),
  referenceNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const voidReturnSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  date: isoDateOrInstant.optional(),
});
export type VoidReturnDTO = z.infer<typeof voidReturnSchema>;

export type SalesReturnReasonDTO = z.infer<typeof salesReturnReasonSchema>;
export type SalesReturnLineDTO = z.infer<typeof salesReturnLineSchema>;
export type CreateSalesReturnDTO = z.infer<typeof createSalesReturnSchema>;
export type BuildSalesReturnFromInvoiceDTO = z.infer<typeof buildSalesReturnFromInvoiceSchema>;
export type SalesReturnDocumentDTO = z.infer<typeof salesReturnDocumentSchema>;
export type RefundSalesReturnDTO = z.infer<typeof refundSalesReturnSchema>;

export const returnSourceLineSchema = z.object({
  sourceLineId: z.string().min(1),
  itemId: z.string().min(1),
  soldQty: z.string(),
  returnedQty: z.string(),
});

export const returnSourceLinesSchema = z.object({
  sourceInvoiceId: z.string().min(1),
  lines: z.array(returnSourceLineSchema),
});

export type ReturnSourceLineDTO = z.infer<typeof returnSourceLineSchema>;
export type ReturnSourceLinesDTO = z.infer<typeof returnSourceLinesSchema>;
