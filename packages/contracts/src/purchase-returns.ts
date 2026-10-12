import { z } from "zod";
import { nonNegativeMoneyString } from "./money-string.js";
import { documentStatusSchema } from "./documents.js";
import { costCategorySchema } from "./contracting.js";
import { isoDateOrInstant } from "./iso-date.js";

/** Wire contracts for Purchase Returns (مرتجعات المشتريات، docs/archive/catalog/02). Mirrors sales-returns.ts. */

/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

export const purchaseReturnReasonSchema = z.enum([
  "DEFECTIVE",
  "WRONG_ITEM",
  "EXCESS_QTY",
  "QUALITY_ISSUE",
  "OTHER",
]);

export const purchaseReturnLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  supplierId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  /** The source invoice line this reverses. Omitted, the first line of the item is taken. */
  sourceLineId: z.string().min(1).nullish(),
  reason: purchaseReturnReasonSchema,
  availableQty: positiveDecimalString,
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  taxAmount: positiveDecimalString,
  /** The VAT rate the source invoice line charged, so a mixed-rate return posts one tagged VAT line per rate (D76). */
  taxRatePercent: z.number().nullable().optional(),
  /** بُعد المشروع — every line of a confirmed return carries the same document-wide value (D-01). */
  projectId: z.string().min(1).nullable().optional(),
  /** فئة التكلفة — only meaningful with the document's `projectId` (D-01). */
  costCategory: costCategorySchema.nullish(),
});

/**
 * EXTERNAL CONTRACT: cost, tax and the returnable quantity are read off the
 * source invoice by the server and a caller's figures are ignored. They are
 * required only where no invoices module is mounted to read them from, and
 * the route answers 422 `RETURN_FIGURES_REQUIRED` when they are missing there.
 */
export const createPurchaseReturnLineSchema = purchaseReturnLineSchema.partial({
  availableQty: true,
  unitCost: true,
  taxAmount: true,
});

export const createPurchaseReturnSchema = z.object({
  id: z.string().min(1),
  date: isoDateOrInstant,
  memo: z.string().default(""),
  /** بُعد المشروع — the contracting project this return's cost belongs to (D-01). */
  projectId: z.string().min(1).nullable().optional(),
  lines: z.array(createPurchaseReturnLineSchema).min(1),
});

export const purchaseReturnRequestedQtySchema = z.object({
  itemId: z.string().min(1),
  qty: positiveDecimalString,
});

export const buildPurchaseReturnFromInvoiceSchema = z.object({
  id: z.string().min(1),
  date: isoDateOrInstant,
  memo: z.string().default(""),
  sourceInvoiceId: z.string().min(1),
  warehouseId: z.string().min(1),
  reason: purchaseReturnReasonSchema,
  requested: z.array(purchaseReturnRequestedQtySchema).min(1),
});


export const purchaseReturnDocumentSchema = z.object({
  id: z.string(),
  docType: z.literal("PURCHASE_RETURN"),
  docNo: z.string().nullable(),
  date: z.string(),
  memo: z.string(),
  status: documentStatusSchema,
  lines: z.array(
    purchaseReturnLineSchema.extend({
      /** Read off the source invoice line, never off the request. */
      taxRateId: z.string().nullable().optional(),
      /** The source invoice's currency and confirm rate, stamped by the server (D203). */
      currency: z.string().nullable().optional(),
      fxRate: z.string().nullable().optional(),
      /** What this line credits, in base currency at `fxRate`. */
      baseCredit: z.string().optional(),
    }),
  ),
  /** What the return debits AP with, in base currency at the source invoice's rate (D203). */
  grandTotal: z.string().optional(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  reversesDocId: z.string().nullable(),
  reversedByDocId: z.string().nullable(),
  voidReason: z.string().nullable().optional(),
  workflowRequestId: z.string().nullable(),
  journalEntryId: z.string().nullable(),
});

export type PurchaseReturnReasonDTO = z.infer<typeof purchaseReturnReasonSchema>;
export type PurchaseReturnLineDTO = z.infer<typeof purchaseReturnLineSchema>;
export type CreatePurchaseReturnDTO = z.infer<typeof createPurchaseReturnSchema>;
export type BuildPurchaseReturnFromInvoiceDTO = z.infer<typeof buildPurchaseReturnFromInvoiceSchema>;
export type PurchaseReturnDocumentDTO = z.infer<typeof purchaseReturnDocumentSchema>;
