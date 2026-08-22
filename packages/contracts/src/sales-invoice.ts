import { z } from "zod";

/**
 * Wire contracts for Sales Invoices (docs/catalog/01-sales.md §"فواتير المبيعات").
 *
 * Money and quantities cross the wire as exact decimal strings, never floats —
 * the boundary that keeps the "no floats, ever" ledger invariant true end to end
 * (docs/plan.md §2.3). The API re-parses these strings into `Money` / `Qty`.
 */

export const salesInvoiceStatusSchema = z.enum([
  "draft",
  "pending",
  "confirmed",
  "partially_paid",
  "paid",
  "cancelled",
  "reversed",
]);

export const salesInvoiceDiscountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent"), percent: z.number().min(0).max(100) }),
  z.object({ type: z.literal("amount"), amount: z.string() }),
]);

export const createSalesInvoiceLineSchema = z.object({
  lineId: z.string().min(1),
  itemId: z.string().min(1),
  itemNameAr: z.string().min(1),
  isStock: z.boolean(),
  qty: z.string(),
  unitPrice: z.string(),
  discountPercent: z.number().min(0).max(100).optional(),
  taxRatePercent: z.number().min(0).optional(),
  revenueAccountId: z.string().min(1),
  cogsAccountId: z.string().min(1).nullish(),
  inventoryAccountId: z.string().min(1).nullish(),
});

/** Create a draft sales invoice. */
export const createSalesInvoiceSchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().min(1),
  dueDate: z.string().min(1),
  customerId: z.string().min(1),
  customerNameAr: z.string().min(1),
  customerTaxExempt: z.boolean().optional(),
  warehouseId: z.string().min(1),
  branchId: z.string().min(1),
  currency: z.string().optional(),
  notes: z.string().nullish(),
  internalNotes: z.string().nullish(),
  discount: salesInvoiceDiscountSchema.optional(),
  arAccountId: z.string().min(1),
  taxAccountId: z.string().min(1),
  lines: z.array(createSalesInvoiceLineSchema).min(1),
});

/** Confirm a draft invoice (posts stock + the AR/revenue/COGS journal entry). */
export const confirmSalesInvoiceSchema = z.object({
  requestId: z.string().min(1).optional(),
});

/** Record a collection against a live invoice. */
export const salesInvoicePaymentSchema = z.object({
  amount: z.string(),
});

/** Query filter for the invoice list. */
export const salesInvoiceListQuerySchema = z.object({
  status: salesInvoiceStatusSchema.optional(),
  customerId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export type SalesInvoiceStatusDTO = z.infer<typeof salesInvoiceStatusSchema>;
export type SalesInvoiceDiscountDTO = z.infer<typeof salesInvoiceDiscountSchema>;
export type CreateSalesInvoiceLineDTO = z.infer<typeof createSalesInvoiceLineSchema>;
export type CreateSalesInvoiceDTO = z.infer<typeof createSalesInvoiceSchema>;
export type ConfirmSalesInvoiceDTO = z.infer<typeof confirmSalesInvoiceSchema>;
export type SalesInvoicePaymentDTO = z.infer<typeof salesInvoicePaymentSchema>;
export type SalesInvoiceListQueryDTO = z.infer<typeof salesInvoiceListQuerySchema>;
