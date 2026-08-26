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
  /** The quantity as entered, in `unitCode` — NOT the base quantity. */
  qty: z.string(),
  /**
   * The unit the quantity is stated in (the item's base unit code or one of its
   * alternate-unit codes). Omit for the base unit.
   */
  unitCode: z.string().min(1).nullish(),
  /**
   * Base units per one `unitCode`, taken from the item's unit setup. It rides
   * on the line rather than being re-resolved server-side so that editing an
   * item's unit setup later cannot restate a document already in the books.
   */
  unitFactor: z.number().positive().nullish(),
  unitPrice: z.string(),
  /** Whether `discountPercent` or `discountAmount` is the live field. */
  discountType: z.enum(["percent", "amount"]).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  /** Fixed line discount as an exact decimal string; capped at the line's gross. */
  discountAmount: z.string().optional(),
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
  /** HR employee id (`/hr/employees`) credited with the sale. */
  salespersonId: z.string().min(1).nullish(),
  salespersonNameAr: z.string().min(1).nullish(),
  /** Coupon presented by the customer; the server evaluates promotions with it at confirm. */
  couponCode: z.string().min(1).nullish(),
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
/**
 * تحصيل من عميل — collecting against an invoice. The treasury account is
 * REQUIRED: money that lands nowhere is not a collection, and recording one
 * without it was how the invoice's `amountPaid` drifted from the ledger (D1).
 * The route creates and confirms a real collection voucher and allocates it.
 */
export const salesInvoicePaymentSchema = z.object({
  amount: z.string(),
  treasuryAccountId: z.string().min(1),
  paymentMethod: z.enum(["cash", "bank", "cheque", "card", "wallet"]).optional(),
  date: z.string().min(1).optional(),
  referenceNo: z.string().nullish(),
  notes: z.string().nullish(),
});

/**
 * The two lifecycle chips that are not a stored status: an invoice is `open`
 * when it is confirmed or part-paid and still owes something, and `overdue`
 * when it is open past its due date. They live here because the rows, the
 * chip counts and the KPI strip must all read them the same way.
 */
export const salesInvoiceFilterKeySchema = z.union([
  salesInvoiceStatusSchema,
  z.enum(["all", "open", "overdue"]),
]);

/** Query filter for the invoice list. */
export const salesInvoiceListQuerySchema = z.object({
  /**
   * Accepts the derived chips (`open`, `overdue`) as well as the stored
   * statuses. They are resolved server-side so the rows, the chip counts and
   * the KPI strip cannot each decide what "overdue" means.
   */
  status: salesInvoiceFilterKeySchema.optional(),
  customerId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  branchId: z.string().optional(),
  warehouseId: z.string().optional(),
  /** Free-text over document number and customer name. */
  search: z.string().optional(),
});


/**
 * What the promotion engine granted, as the confirming invoice recorded it —
 * a value snapshot, so these figures never change when the promotion does.
 */
export const appliedSalesInvoicePromotionSchema = z.object({
  promotionId: z.string(),
  code: z.string(),
  nameAr: z.string(),
  couponCode: z.string().nullable(),
  discountTotal: z.string(),
  lineDiscounts: z.array(z.object({ lineId: z.string(), itemId: z.string(), amount: z.string() })),
  appliedAt: z.string(),
});

/** One row of تقرير استخدام العروض — `GET /promotions/report`. */
export const promotionUsageRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameAr: z.string(),
  usageCount: z.number(),
  discountGranted: z.string(),
  reversedDiscount: z.string(),
  netDiscount: z.string(),
});

export type SalesInvoiceStatusDTO = z.infer<typeof salesInvoiceStatusSchema>;
export type SalesInvoiceDiscountDTO = z.infer<typeof salesInvoiceDiscountSchema>;
export type CreateSalesInvoiceLineDTO = z.infer<typeof createSalesInvoiceLineSchema>;
export type CreateSalesInvoiceDTO = z.infer<typeof createSalesInvoiceSchema>;
export type ConfirmSalesInvoiceDTO = z.infer<typeof confirmSalesInvoiceSchema>;
export type SalesInvoicePaymentDTO = z.infer<typeof salesInvoicePaymentSchema>;
export type SalesInvoiceListQueryDTO = z.infer<typeof salesInvoiceListQuerySchema>;
export type AppliedSalesInvoicePromotionDTO = z.infer<typeof appliedSalesInvoicePromotionSchema>;
/** `GET /sales-invoices/stats` — the KPI strip, summed in `Money` server-side. */
export const salesInvoiceStatsSchema = z.object({
  count: z.number(),
  sales: z.string(),
  collected: z.string(),
  returned: z.string(),
  remaining: z.string(),
});

export type PromotionUsageRowDTO = z.infer<typeof promotionUsageRowSchema>;
export type SalesInvoiceStatsDTO = z.infer<typeof salesInvoiceStatsSchema>;
export type SalesInvoiceFilterKeyDTO = z.infer<typeof salesInvoiceFilterKeySchema>;
