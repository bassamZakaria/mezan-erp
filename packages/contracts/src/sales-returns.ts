import { z } from "zod";
import { documentStatusSchema } from "./documents.js";

/**
 * Wire contracts for Sales Returns (مرتجعات المبيعات، docs/catalog/01), a
 * document-framework consumer. Money/Qty cross the wire as exact decimal
 * strings (same convention as journal.ts/inventory.ts) — never floats.
 */

const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

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
  awaitingRefund: z.boolean(),
});

export type SalesReturnReasonDTO = z.infer<typeof salesReturnReasonSchema>;
export type SalesReturnLineDTO = z.infer<typeof salesReturnLineSchema>;
export type CreateSalesReturnDTO = z.infer<typeof createSalesReturnSchema>;
export type BuildSalesReturnFromInvoiceDTO = z.infer<typeof buildSalesReturnFromInvoiceSchema>;
export type SalesReturnDocumentDTO = z.infer<typeof salesReturnDocumentSchema>;
