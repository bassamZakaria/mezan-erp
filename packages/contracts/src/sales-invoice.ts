import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./paging.js";
import { decimalRateString, moneyString, quantityString } from "./money-string.js";
import { isoDateOrInstant } from "./iso-date.js";
import { clientSuppliedId } from "./client-supplied-id.js";
import { InvoiceDocumentKind } from "./invoice-document-kind.js";

/**
 * Wire contracts for Sales Invoices (docs/archive/catalog/01-sales.md §"فواتير المبيعات").
 *
 * Money and quantities cross the wire as exact decimal strings, never floats —
 * the boundary that keeps the "no floats, ever" ledger invariant true end to end
 * (docs/archive/plan.md §2.3). The API re-parses these strings into `Money` / `Qty`.
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

export const salesInvoiceLineDiscountTypeSchema = z.enum(["percent", "amount"]);

export const salesInvoiceDiscountSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent"), percent: z.number().min(0).max(100) }),
  z.object({ type: z.literal("amount"), amount: moneyString }),
]);

export const createSalesInvoiceLineSchema = z.object({
  lineId: z.string().min(1),
  itemId: z.string().min(1),
  itemNameAr: z.string().min(1),
  isStock: z.boolean(),
  /** The quantity as entered, in `unitCode` — NOT the base quantity. */
  qty: quantityString,
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
  unitPrice: moneyString,
  /** Whether `discountPercent` or `discountAmount` is the live field. */
  discountType: salesInvoiceLineDiscountTypeSchema.optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  /** Fixed line discount as an exact decimal string; capped at the line's gross. */
  discountAmount: moneyString.optional(),
  taxRatePercent: z.number().min(0).optional(),
  /**
   * EXTERNAL CONTRACT: three answers, not two. A string names the tax rate:
   * the server checks it exists and is active, reads the percent off it, and
   * refuses a `taxRatePercent` that disagrees. `null` says the line names no
   * rate, and none is stored. Omitted, the server infers the one active rate
   * at the line's percent — but never at 0%, where exempt and zero-rated
   * export cannot be told apart (D79). Two cases are not the caller's to
   * answer. A line policy zero-rates keeps a 0% rate it named itself;
   * otherwise it names the system «غير خاضع» rate when the tenant's VAT is
   * off, and — for a tax-exempt customer — the 0% rate on that customer's
   * card, or none when the card holds none. A line converted from a quote
   * carries the quote line's stored rate exactly: a quote line that stored
   * none converts to none unless the convert request names a rate for it, at
   * that line's own percent. A posted line left with none is named afterwards
   * through `POST /sales-invoices/:id/lines/:lineId/classify-tax`.
   */
  taxRateId: z.string().min(1).nullish(),
  revenueAccountId: z.string().min(1),
  cogsAccountId: z.string().min(1).nullish(),
  inventoryAccountId: z.string().min(1).nullish(),
  /**
   * Cost centre ("مركز التكلفة") this line's revenue and COGS belong to.
   *
   * The line had no such field, so a revenue line could not be attributed at
   * creation and the Cost Centre P&L saw sales as unattributed no matter how
   * the cost centres were set up (D97). The GL posting groups by it, so two
   * lines on one invoice can be booked to two different centres.
   */
  costCenterId: z.string().min(1).nullish(),
});

/** Create a draft sales invoice. */
export const createSalesInvoiceSchema = z.object({
  id: clientSuppliedId.optional(),
  date: isoDateOrInstant,
  dueDate: z.string().min(1),
  customerId: z.string().min(1),
  customerNameAr: z.string().min(1),
  /** EXTERNAL CONTRACT: ignored — exemption is read off the customer record server-side. Kept so older clients still parse. */
  customerTaxExempt: z.boolean().optional(),
  warehouseId: z.string().min(1),
  branchId: z.string().min(1),
  /** HR employee id (`/hr/employees`) credited with the sale. */
  salespersonId: z.string().min(1).nullish(),
  salespersonNameAr: z.string().min(1).nullish(),
  salesManagerId: z.string().min(1).nullish(),
  promotionRepId: z.string().min(1).nullish(),
  promotionManagerId: z.string().min(1).nullish(),
  /** بُعد المشروع — the contracting project this invoice's revenue and COGS belong to. */
  projectId: z.string().min(1).nullish(),
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
  acknowledgeTaxRecalculation: z.boolean().optional(),
  /**
   * N-9 — the `version` the screen was served. Sent back on the act so a second
   * till acting on a document that has already moved is refused with 409 rather
   * than silently winning. Optional on the wire so an older client keeps
   * working; enforced whenever it is present.
   */
  expectedVersion: z.number().int().positive().optional(),
  /**
   * The tender taken at the counter, for a consumer sale's e-receipt — its
   * paymentMethod is hashed into the receipt at confirm, before any collection
   * is recorded. Omitted, the receipt states «أخرى» (O).
   */
  receiptPaymentMethod: z
    .enum(["cash", "card", "wallet", "transfer", "voucher", "gift_card", "points", "other"])
    .optional(),
});

/** Record a collection against a live invoice. */
/**
 * تحصيل من عميل — collecting against an invoice. The treasury account is
 * REQUIRED: money that lands nowhere is not a collection, and recording one
 * without it was how the invoice's `amountPaid` drifted from the ledger (D1).
 * The route creates and confirms a real collection voucher and allocates it.
 */
export const editSalesInvoiceDraftLineSchema = z
  .object({
    qty: moneyString.optional(),
    unitPrice: moneyString.optional(),
    taxRateId: z.string().min(1).optional(),
  })
  .refine((change) => change.qty !== undefined || change.unitPrice !== undefined || change.taxRateId !== undefined, {
    message: "حدّد الكمية أو السعر أو الضريبة المراد تعديلها.",
  });
export type EditSalesInvoiceDraftLineDTO = z.infer<typeof editSalesInvoiceDraftLineSchema>;

export const voidSalesInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive().optional(),
});
export type VoidSalesInvoiceDTO = z.infer<typeof voidSalesInvoiceSchema>;

export const salesInvoicePaymentSchema = z.object({
  amount: moneyString.describe("What reached the treasury. A commissionAmount is added on top, and the invoice is relieved of amount + commissionAmount."),
  treasuryAccountId: z.string().min(1),
  paymentMethod: z.enum(["cash", "bank", "cheque", "card", "wallet"]).optional(),
  date: isoDateOrInstant.optional(),
  referenceNo: z.string().nullish(),
  notes: z.string().nullish(),
  commissionAmount: moneyString.nullish().describe("Transfer commission the bank or wallet kept, on top of amount."),
  commissionGlAccountId: z.string().nullish(),
});

/**
 * The two lifecycle chips that are not a stored status: an invoice is `open`
 * when it is confirmed or part-paid and still owes something, and `overdue`
 * when it is open past its due date. They live here because the rows, the
 * chip counts and the KPI strip must all read them the same way.
 */
export enum SalesInvoiceDerivedFilter {
  All = "all",
  Open = "open",
  Overdue = "overdue",
  /** Confirmed, partially paid or paid: live in the ledger, so returnable and counted as sales. */
  Active = "active",
}

const SALES_INVOICE_DERIVED_FILTERS = Object.values(SalesInvoiceDerivedFilter) as [`${SalesInvoiceDerivedFilter}`, ...`${SalesInvoiceDerivedFilter}`[]];

export const salesInvoiceFilterKeySchema = z.union([salesInvoiceStatusSchema, z.enum(SALES_INVOICE_DERIVED_FILTERS)]);

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
  /** Row order for the list route; the counts and the KPI strip ignore it. */
  sort: z.enum(["docNo"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  /**
   * One page of rows, 1-based. The list route answers with that page only —
   * the totals every screen needs already come from `/counts` and `/stats`,
   * which are computed over the WHOLE filtered set and are unaffected by it.
   *
   * BOTH CARRY A DEFAULT (Q-8). Omitting `pageSize` used to mean "every
   * invoice in the table"; a default is what makes the unbounded read
   * unreachable by omission rather than merely discouraged.
   */
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
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
  lineDiscounts: z.array(z.object({ lineId: z.string(), itemId: z.string(), amount: moneyString })),
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
export const SALES_INVOICE_DUE_SOON_DAYS = 30;

/** `GET /sales-invoices/stats` — the KPI strip, summed in `Money` server-side. */
export const salesInvoiceStatsSchema = z.object({
  count: z.number(),
  sales: z.string(),
  collected: z.string(),
  returned: z.string(),
  remaining: z.string(),
  overdueCount: z.number(),
  overdue: z.string(),
  dueSoonCount: z.number(),
  dueSoon: z.string(),
});

export type PromotionUsageRowDTO = z.infer<typeof promotionUsageRowSchema>;
export type SalesInvoiceStatsDTO = z.infer<typeof salesInvoiceStatsSchema>;
export type SalesInvoiceFilterKeyDTO = z.infer<typeof salesInvoiceFilterKeySchema>;

/**
 * The wire shape the API actually serves — `packages/api/src/sales-invoices-routes.ts`
 * `serialize()`. Declared here, not re-declared per client: `apps/web` carried a
 * bare TS interface and `apps/mobile` a second hand-written zod copy, and the
 * two had already drifted from the serializer (D312).
 */
export const salesInvoiceLineRowSchema = z.object({
  lineId: z.string().min(1),
  itemId: z.string().min(1),
  itemNameAr: z.string(),
  isStock: z.boolean(),
  /** As entered, in `unitCode` — the figure `unitPrice` multiplies. */
  qty: moneyString,
  /** "" on a line raised before per-line units, meaning the item's base unit. */
  unitCode: z.string(),
  unitFactor: z.number(),
  /** qty × unitFactor — what the stock ledger actually moved. */
  baseQty: moneyString,
  unitPrice: moneyString,
  discountType: salesInvoiceLineDiscountTypeSchema,
  discountPercent: z.number(),
  discountAmount: moneyString,
  taxRatePercent: z.number(),
  taxRateId: z.string().nullable(),
  revenueAccountId: z.string().min(1),
  cogsAccountId: z.string().nullable(),
  inventoryAccountId: z.string().nullable(),
  costCenterId: z.string().nullable(),
  /**
   * OMITTED, not nulled, for a caller without `sales.invoice.view_cost` — a
   * null would still disclose that the field exists (D31). Optional here for
   * exactly that reason; it is never absent for a caller that may see cost.
   */
  unitCost: moneyString.nullable().optional(),
});

export const salesInvoiceTotalsSchema = z.object({
  taxInclusive: z.boolean(),
  grossTotal: moneyString,
  lineDiscountTotal: moneyString,
  promotionDiscountTotal: moneyString,
  invoiceDiscountTotal: moneyString,
  subtotal: moneyString,
  taxableTotal: moneyString,
  taxTotal: moneyString,
  grandTotal: moneyString,
});

export const salesInvoiceSchema = z.object({
  id: z.string().min(1),
  docType: z.string().min(1),
  docNo: z.string().nullable(),
  status: salesInvoiceStatusSchema,
  date: z.string().min(1),
  dueDate: z.string().min(1),
  customerId: z.string().min(1),
  customerNameAr: z.string(),
  documentKind: z.nativeEnum(InvoiceDocumentKind).optional(),
  voidReason: z.string().nullish(),
  confirmPreview: z
    .object({
      taxRecalculated: z.literal(true),
      message: z.string(),
      messageEn: z.string().optional(),
      lines: z.array(z.object({ lineId: z.string(), taxRatePercent: z.number(), taxRateId: z.string().nullable() })),
      totals: z.object({ taxableTotal: moneyString, taxTotal: moneyString, grandTotal: moneyString }),
    })
    .nullish(),
  customerTaxExempt: z.boolean(),
  taxInclusive: z.boolean(),
  warehouseId: z.string().min(1),
  branchId: z.string().min(1),
  salespersonId: z.string().nullable(),
  salespersonNameAr: z.string().nullable(),
  salesManagerId: z.string().nullable().optional(),
  salesManagerNameAr: z.string().nullable().optional(),
  promotionRepId: z.string().nullable().optional(),
  promotionRepNameAr: z.string().nullable().optional(),
  promotionManagerId: z.string().nullable().optional(),
  promotionManagerNameAr: z.string().nullable().optional(),
  projectId: z.string().nullable(),
  currency: z.string().min(1),
  /** The rate the invoice confirmed at; null for a base-currency or unconfirmed invoice. */
  fxRate: decimalRateString.nullable(),
  couponCode: z.string().nullable(),
  appliedPromotion: appliedSalesInvoicePromotionSchema.nullable(),
  notes: z.string().nullable(),
  internalNotes: z.string().nullable(),
  discount: salesInvoiceDiscountSchema,
  arAccountId: z.string().min(1),
  taxAccountId: z.string().min(1),
  /**
   * `totals.grandTotal` in BASE currency at `fxRate` — what GL 1105 holds.
   * `amountPaid`, `returnedCredit` and `remainingBalance` are base figures
   * measured against this, never against `totals.grandTotal` (D202).
   */
  baseGrandTotal: moneyString,
  amountPaid: moneyString,
  /** Confirmed returns credited against this invoice — already netted out of `remainingBalance`. */
  returnedCredit: moneyString,
  remainingBalance: moneyString,
  journalEntryId: z.string().nullable(),
  workflowRequestId: z.string().nullable(),
  createdAt: z.string().min(1),
  confirmedAt: z.string().nullable(),
  lines: z.array(salesInvoiceLineRowSchema),
  totals: salesInvoiceTotalsSchema,
  /** N-9 — the row version a list/detail read serves; absent on the create response. */
  version: z.number().int().positive().optional(),
});

export type SalesInvoiceLineDiscountTypeDTO = z.infer<typeof salesInvoiceLineDiscountTypeSchema>;
export type SalesInvoiceLineRowDTO = z.infer<typeof salesInvoiceLineRowSchema>;
export type SalesInvoiceTotalsDTO = z.infer<typeof salesInvoiceTotalsSchema>;
export type SalesInvoiceDTO = z.infer<typeof salesInvoiceSchema>;
