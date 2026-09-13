import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { documentStatusSchema } from "./documents.js";

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
  date: z.string().min(1),
  memo: z.string().default(""),
  lines: z.array(salesReturnLineSchema).min(1),
});

/** Convenience request: derive return lines from a resolved source-invoice snapshot + requested qty per item. */
export const salesReturnRequestedQtySchema = z.object({
  itemId: z.string().min(1),
  qty: positiveDecimalString,
  /** Per-line سبب الإرجاع (R3.9); omitted lines fall back to the document's reason. */
  reason: salesReturnReasonSchema.optional(),
});

export const buildSalesReturnFromInvoiceSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
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
  lines: z.array(salesReturnLineSchema),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  reversesDocId: z.string().nullable(),
  reversedByDocId: z.string().nullable(),
  workflowRequestId: z.string().nullable(),
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
  date: z.string().min(1).optional(),
  referenceNo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type SalesReturnReasonDTO = z.infer<typeof salesReturnReasonSchema>;
export type SalesReturnLineDTO = z.infer<typeof salesReturnLineSchema>;
export type CreateSalesReturnDTO = z.infer<typeof createSalesReturnSchema>;
export type BuildSalesReturnFromInvoiceDTO = z.infer<typeof buildSalesReturnFromInvoiceSchema>;
export type SalesReturnDocumentDTO = z.infer<typeof salesReturnDocumentSchema>;
export type RefundSalesReturnDTO = z.infer<typeof refundSalesReturnSchema>;
