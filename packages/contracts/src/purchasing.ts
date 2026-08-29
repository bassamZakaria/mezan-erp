import { z } from "zod";

/**
 * Wire contracts for the purchase chain (docs/archive/catalog/02): أوامر الشراء →
 * استلام البضائع → فواتير المشتريات. Money and Qty cross the wire as EXACT
 * decimal strings (same convention as journal.ts / inventory.ts) — never floats.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be an exact decimal string");
const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");
const isoDate = z.string().min(1);

export const purchaseOrderStatusSchema = z.enum([
  "draft",
  "sent",
  "partially_received",
  "fully_received",
  "cancelled",
]);
export const goodsReceiptStatusSchema = z.enum(["draft", "confirmed", "cancelled"]);
export const purchaseInvoiceStatusSchema = z.enum(["draft", "confirmed", "cancelled"]);
export const purchaseInvoiceLineKindSchema = z.enum(["inventory", "expense", "freight"]);

// --- Purchase Order --------------------------------------------------------

export const purchaseOrderLineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().nullable(),
  qty: decimalString,
  unitPrice: decimalString,
  receivedQty: decimalString,
});

export const purchaseOrderSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  supplierId: z.string().min(1),
  date: isoDate,
  expectedDeliveryDate: z.string().nullable(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  currency: z.string().min(1),
  notes: z.string().nullable(),
  lines: z.array(purchaseOrderLineSchema),
  status: purchaseOrderStatusSchema,
  subtotal: decimalString,
  total: decimalString,
  createdBy: z.string(),
  createdAt: z.string(),
});

export const createPurchaseOrderLineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().nullable().optional(),
  qty: positiveDecimalString,
  unitPrice: positiveDecimalString,
});

export const createPurchaseOrderSchema = z.object({
  id: z.string().min(1),
  supplierId: z.string().min(1),
  date: isoDate,
  expectedDeliveryDate: z.string().nullable().optional(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  currency: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(createPurchaseOrderLineSchema).min(1),
});

// --- Goods Receipt ---------------------------------------------------------

export const goodsReceiptLineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().nullable(),
  qty: decimalString,
  unitCost: decimalString,
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
});

export const goodsReceiptSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  /** Null for an ad-hoc (PO-less) receipt — only possible when `requirePoForGrn` is off. */
  purchaseOrderId: z.string().min(1).nullable(),
  supplierId: z.string().min(1),
  warehouseId: z.string().min(1),
  date: isoDate,
  notes: z.string().nullable(),
  lines: z.array(goodsReceiptLineSchema),
  status: goodsReceiptStatusSchema,
  invoiced: z.boolean(),
  totalCost: decimalString,
  createdBy: z.string(),
  createdAt: z.string(),
});

export const createGoodsReceiptLineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().nullable().optional(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  batchNo: z.string().min(1).nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
});

export const createGoodsReceiptSchema = z.object({
  id: z.string().min(1),
  /** Omit for an ad-hoc (PO-less) receipt — only allowed when `requirePoForGrn` is off. */
  purchaseOrderId: z.string().min(1).nullable().optional(),
  date: isoDate,
  notes: z.string().nullable().optional(),
  /** Required for an ad-hoc receipt (no PO to source from); omit to auto-fill from the PO. */
  lines: z.array(createGoodsReceiptLineSchema).min(1).optional(),
  /** Required for an ad-hoc receipt; ignored (derived from the PO) otherwise. */
  supplierId: z.string().min(1).optional(),
  warehouseId: z.string().min(1).optional(),
});

// --- Purchase Invoice ------------------------------------------------------

export const purchaseInvoiceLineSchema = z.object({
  itemId: z.string().nullable(),
  description: z.string().nullable(),
  kind: purchaseInvoiceLineKindSchema,
  qty: decimalString,
  unitCost: decimalString,
  taxRatePercent: z.number(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
});

export const purchaseInvoiceSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  supplierId: z.string().min(1),
  date: isoDate,
  dueDate: z.string().nullable(),
  supplierInvoiceNumber: z.string().nullable(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  currency: z.string().min(1),
  /** The rate the invoice CONFIRMED at; null for a base-currency invoice (D24). */
  fxRate: z.string().nullable().optional(),
  notes: z.string().nullable(),
  receiptId: z.string().nullable(),
  lines: z.array(purchaseInvoiceLineSchema),
  status: purchaseInvoiceStatusSchema,
  subtotal: decimalString,
  tax: decimalString,
  total: decimalString,
  /** Settled from the treasury allocation sub-ledger; the invoice itself holds no payment counter. */
  amountPaid: decimalString,
  remainingBalance: decimalString,
  createdBy: z.string(),
  createdAt: z.string(),
});

export const createPurchaseInvoiceLineSchema = z.object({
  itemId: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  kind: purchaseInvoiceLineKindSchema.optional(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  taxRatePercent: z.number().min(0).optional(),
  batchNo: z.string().min(1).nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
});

/**
 * `GET /purchases/invoices/:id/fulfilment` — what each inventory line of this
 * invoice actually delivered and what is left of it. Read from the cost layers
 * the funding document created (the goods receipt, or the invoice itself when
 * it is a manual one), never stored on the invoice, so it cannot drift from
 * the stock ledger.
 */
export const purchaseInvoiceLineFulfilmentSchema = z.object({
  lineIndex: z.number().int().nonnegative(),
  itemId: z.string().nullable(),
  invoicedQty: decimalString,
  receivedQty: decimalString,
  consumedQty: decimalString,
  remainingQty: decimalString,
});

export const purchaseInvoiceFulfilmentSchema = z.object({
  invoiceId: z.string().min(1),
  /** The document whose confirmation created the cost layers these figures are read from. */
  sourceDocId: z.string().nullable(),
  sourceDocType: z.enum(["GOODS_RECEIPT", "PURCHASE_INVOICE"]).nullable(),
  lines: z.array(purchaseInvoiceLineFulfilmentSchema),
});

/** `POST /purchases/invoices/:id/payments` — pay a supplier straight off the invoice. */
export const purchaseInvoicePaymentSchema = z.object({
  amount: z.string(),
  treasuryAccountId: z.string().min(1),
  paymentMethod: z.enum(["cash", "bank", "cheque", "card", "wallet"]).optional(),
  date: z.string().min(1).optional(),
  referenceNo: z.string().nullish(),
  notes: z.string().nullish(),
});

export const createPurchaseInvoiceSchema = z.object({
  id: z.string().min(1),
  supplierId: z.string().min(1),
  date: isoDate,
  dueDate: z.string().nullable().optional(),
  supplierInvoiceNumber: z.string().nullable().optional(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  currency: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  /** Create-from-receipt: auto-fills lines from this confirmed goods receipt when lines omitted. */
  receiptId: z.string().min(1).nullable().optional(),
  lines: z.array(createPurchaseInvoiceLineSchema).min(1).optional(),
});

export type PurchaseOrderStatusDTO = z.infer<typeof purchaseOrderStatusSchema>;
export type GoodsReceiptStatusDTO = z.infer<typeof goodsReceiptStatusSchema>;
export type PurchaseInvoiceStatusDTO = z.infer<typeof purchaseInvoiceStatusSchema>;
export type PurchaseInvoiceLineKindDTO = z.infer<typeof purchaseInvoiceLineKindSchema>;
export type PurchaseOrderLineDTO = z.infer<typeof purchaseOrderLineSchema>;
export type PurchaseOrderDTO = z.infer<typeof purchaseOrderSchema>;
export type CreatePurchaseOrderDTO = z.infer<typeof createPurchaseOrderSchema>;
export type GoodsReceiptLineDTO = z.infer<typeof goodsReceiptLineSchema>;
export type GoodsReceiptDTO = z.infer<typeof goodsReceiptSchema>;
export type CreateGoodsReceiptDTO = z.infer<typeof createGoodsReceiptSchema>;
export type PurchaseInvoiceLineDTO = z.infer<typeof purchaseInvoiceLineSchema>;
export type PurchaseInvoiceDTO = z.infer<typeof purchaseInvoiceSchema>;
export type CreatePurchaseInvoiceDTO = z.infer<typeof createPurchaseInvoiceSchema>;
export type PurchaseInvoiceLineFulfilmentDTO = z.infer<typeof purchaseInvoiceLineFulfilmentSchema>;
export type PurchaseInvoiceFulfilmentDTO = z.infer<typeof purchaseInvoiceFulfilmentSchema>;
export type PurchaseInvoicePaymentDTO = z.infer<typeof purchaseInvoicePaymentSchema>;

// --- RFQ (طلبات عروض الأسعار) ------------------------------------------------

export const purchaseRfqStatusSchema = z.enum(["draft", "sent", "closed", "cancelled"]);

export const purchaseRfqLineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().nullable(),
  qty: decimalString,
  notes: z.string().nullable(),
});

export const purchaseRfqSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  date: isoDate,
  requiredByDate: z.string().nullable(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  notes: z.string().nullable(),
  lines: z.array(purchaseRfqLineSchema),
  status: purchaseRfqStatusSchema,
  purchaseOrderId: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export const createPurchaseRfqLineSchema = z.object({
  itemId: z.string().min(1),
  description: z.string().nullable().optional(),
  qty: positiveDecimalString,
  notes: z.string().nullable().optional(),
});

export const createPurchaseRfqSchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  requiredByDate: z.string().nullable().optional(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  notes: z.string().nullable().optional(),
  lines: z.array(createPurchaseRfqLineSchema).min(1),
});

export const rfqQuoteLineSchema = z.object({
  itemId: z.string().min(1),
  unitPrice: decimalString,
  notes: z.string().nullable(),
});

export const rfqQuoteSchema = z.object({
  id: z.string().min(1),
  rfqId: z.string().min(1),
  supplierId: z.string().min(1),
  lines: z.array(rfqQuoteLineSchema),
  notes: z.string().nullable(),
  submittedAt: z.string(),
});

export const createRfqQuoteLineSchema = z.object({
  itemId: z.string().min(1),
  unitPrice: positiveDecimalString,
  notes: z.string().nullable().optional(),
});

export const createRfqQuoteSchema = z.object({
  id: z.string().min(1),
  supplierId: z.string().min(1),
  lines: z.array(createRfqQuoteLineSchema).min(1),
  notes: z.string().nullable().optional(),
});

export const convertRfqSchema = z.object({
  purchaseOrderId: z.string().min(1),
  supplierId: z.string().min(1),
  expectedDeliveryDate: z.string().nullable().optional(),
});

export type PurchaseRfqStatusDTO = z.infer<typeof purchaseRfqStatusSchema>;
export type PurchaseRfqLineDTO = z.infer<typeof purchaseRfqLineSchema>;
export type PurchaseRfqDTO = z.infer<typeof purchaseRfqSchema>;
export type CreatePurchaseRfqDTO = z.infer<typeof createPurchaseRfqSchema>;
export type RfqQuoteLineDTO = z.infer<typeof rfqQuoteLineSchema>;
export type RfqQuoteDTO = z.infer<typeof rfqQuoteSchema>;
export type CreateRfqQuoteDTO = z.infer<typeof createRfqQuoteSchema>;
export type ConvertRfqDTO = z.infer<typeof convertRfqSchema>;

/**
 * The purchase-invoice list's filter set. `overdue`, `due_soon` and
 * `partially_paid` are payment states derived from the allocation sub-ledger,
 * not stored statuses — they are resolved server-side so the rows, the chip
 * counts and the KPI strip cannot each define them differently (R1.1, R4.1).
 */
export const purchaseInvoiceFilterKeySchema = z.union([
  purchaseInvoiceStatusSchema,
  z.enum(["all", "overdue", "due_soon", "partially_paid", "paid"]),
]);

export const purchaseInvoiceListQuerySchema = z.object({
  status: purchaseInvoiceFilterKeySchema.optional(),
  supplierId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  branchId: z.string().optional(),
  warehouseId: z.string().optional(),
  /** Free-text over the document number and the supplier's own invoice number. */
  search: z.string().optional(),
});

/** `GET /purchases/invoices/stats` — the KPI strip, summed in `Money`. */
export const purchaseInvoiceStatsSchema = z.object({
  count: z.number(),
  purchases: z.string(),
  paid: z.string(),
  unpaid: z.string(),
});

export type PurchaseInvoiceFilterKeyDTO = z.infer<typeof purchaseInvoiceFilterKeySchema>;
export type PurchaseInvoiceListQueryDTO = z.infer<typeof purchaseInvoiceListQuerySchema>;
export type PurchaseInvoiceStatsDTO = z.infer<typeof purchaseInvoiceStatsSchema>;
