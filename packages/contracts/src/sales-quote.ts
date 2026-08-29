import { z } from "zod";

/**
 * Wire contracts for Sales Quotations (docs/archive/catalog/01-sales.md §"عروض الأسعار").
 *
 * Money and quantities cross the wire as exact decimal strings, never floats —
 * the boundary that keeps the "no floats, ever" ledger invariant true end to end
 * (docs/archive/plan.md §2.3). The API re-parses these strings into `Money` / `Qty`.
 */

export const salesQuoteStatusSchema = z.enum([
  "draft",
  "sent",
  "accepted",
  "rejected",
  "converted",
  "cancelled",
]);

export const salesQuoteDiscountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent"), percent: z.number().min(0).max(100) }),
  z.object({ type: z.literal("amount"), amount: z.string() }),
]);

export const createSalesQuoteLineSchema = z.object({
  lineId: z.string().min(1),
  itemId: z.string().min(1),
  itemNameAr: z.string().min(1),
  qty: z.string(),
  unitPrice: z.string(),
  discountPercent: z.number().min(0).max(100).optional(),
  taxRatePercent: z.number().min(0).optional(),
});

/** Create a draft sales quote. */
export const createSalesQuoteSchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().min(1),
  expiryDate: z.string().min(1),
  customerId: z.string().min(1),
  customerNameAr: z.string().min(1),
  customerTaxExempt: z.boolean().optional(),
  branchId: z.string().min(1),
  currency: z.string().optional(),
  notes: z.string().nullish(),
  internalNotes: z.string().nullish(),
  discount: salesQuoteDiscountSchema.optional(),
  priceListId: z.string().nullish(),
  couponCode: z.string().nullish(),
  lines: z.array(createSalesQuoteLineSchema).min(1),
});

/** Query filter for the quote list. */
export const salesQuoteListQuerySchema = z.object({
  status: salesQuoteStatusSchema.optional(),
  customerId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

/**
 * "إنشاء من عرض سعر" — convert an accepted quote into a draft sales invoice
 * (docs/archive/catalog/01 §"فواتير المبيعات"). A quote line carries no GL-account/
 * stock info, so the caller supplies it per line here, matched back to the
 * quote's own lines by `lineId`.
 */
export const convertSalesQuoteLineSchema = z.object({
  lineId: z.string().min(1),
  isStock: z.boolean(),
  revenueAccountId: z.string().min(1),
  cogsAccountId: z.string().min(1).nullish(),
  inventoryAccountId: z.string().min(1).nullish(),
});

export const convertSalesQuoteToInvoiceSchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  dueDate: z.string().min(1),
  warehouseId: z.string().min(1),
  arAccountId: z.string().min(1),
  taxAccountId: z.string().min(1),
  lines: z.array(convertSalesQuoteLineSchema).min(1),
});

export type SalesQuoteStatusDTO = z.infer<typeof salesQuoteStatusSchema>;
export type SalesQuoteDiscountDTO = z.infer<typeof salesQuoteDiscountSchema>;
export type CreateSalesQuoteLineDTO = z.infer<typeof createSalesQuoteLineSchema>;
export type CreateSalesQuoteDTO = z.infer<typeof createSalesQuoteSchema>;
export type SalesQuoteListQueryDTO = z.infer<typeof salesQuoteListQuerySchema>;
export type ConvertSalesQuoteLineDTO = z.infer<typeof convertSalesQuoteLineSchema>;
export type ConvertSalesQuoteToInvoiceDTO = z.infer<typeof convertSalesQuoteToInvoiceSchema>;
