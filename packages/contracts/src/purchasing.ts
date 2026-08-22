import { z } from "zod";

/**
 * Wire contracts for the purchase chain (docs/catalog/02): أوامر الشراء →
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
export const purchaseInvoiceLineKindSchema = z.enum(["inventory", "expense"]);

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
});

export const goodsReceiptSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  purchaseOrderId: z.string().min(1),
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
});

export const createGoodsReceiptSchema = z.object({
  id: z.string().min(1),
  purchaseOrderId: z.string().min(1),
  date: isoDate,
  notes: z.string().nullable().optional(),
  /** Omit to auto-fill from the PO's outstanding quantities (create-from-PO). */
  lines: z.array(createGoodsReceiptLineSchema).min(1).optional(),
});

// --- Purchase Invoice ------------------------------------------------------

export const purchaseInvoiceLineSchema = z.object({
  itemId: z.string().nullable(),
  description: z.string().nullable(),
  kind: purchaseInvoiceLineKindSchema,
  qty: decimalString,
  unitCost: decimalString,
  taxRatePercent: z.number(),
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
  notes: z.string().nullable(),
  receiptId: z.string().nullable(),
  lines: z.array(purchaseInvoiceLineSchema),
  status: purchaseInvoiceStatusSchema,
  subtotal: decimalString,
  tax: decimalString,
  total: decimalString,
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
