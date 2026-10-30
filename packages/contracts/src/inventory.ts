import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contracts for the costing + stock-ledger engine (docs/archive/catalog/03).
 * Money and Qty cross the wire as EXACT decimal strings (same convention as
 * journal.ts) — never floats — so JSON is byte-identical on every edition.
 */

/** @see moneyString — one guard for every exact-decimal field on the wire (D126). */
const decimalString = moneyString;
/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

export const stockMovementDirectionSchema = z.enum(["IN", "OUT"]);

export const adjustmentReasonSchema = z.enum([
  "INITIAL_STOCK",
  "PHYSICAL_COUNT",
  "DAMAGE",
  "THEFT",
  "EXPIRY",
  "SHORTAGE",
  "SUPPLIER_RETURN",
  "OTHER",
]);

export const stockSourceDocTypeSchema = z.enum([
  "ADJUSTMENT",
  "TRANSFER",
  "PURCHASE_INVOICE",
  "PURCHASE_RECEIPT",
  "SALES_INVOICE",
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "POS_SALE",
  "WORK_ORDER",
  "SITE_ISSUE",
  "SITE_RECEIPT",
  "MATERIAL_CONSUMPTION",
]);

export const stockMovementSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  direction: stockMovementDirectionSchema,
  qty: decimalString,
  unitCost: decimalString.optional(),
  sourceDocType: stockSourceDocTypeSchema,
  sourceDocId: z.string().min(1),
  sourceDocNumber: z.string().nullable(),
  reason: adjustmentReasonSchema.nullable(),
  occurredAt: z.string().min(1),
});

export const stockBalanceSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  onHand: decimalString,
  averageCost: decimalString.optional(),
  totalValue: decimalString.optional(),
});

export const valuationRowSchema = stockBalanceSchema;

export const valuationReportSchema = z.object({
  rows: z.array(valuationRowSchema),
  totalValue: decimalString,
});

export const driftReportSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  onHand: decimalString,
  cachedAverageCost: decimalString,
  recomputedAverageCost: decimalString,
  layersAverageCost: decimalString,
  cachedValue: decimalString,
  recomputedValue: decimalString,
  layersValue: decimalString,
  layersQty: decimalString,
  cacheDrift: decimalString,
  layerDrift: decimalString,
  withinTolerance: z.boolean(),
});

// --- Posted-document reads (folded out of the movement ledger) ---

export const postedAdjustmentLineSchema = z.object({
  itemId: z.string().min(1),
  direction: stockMovementDirectionSchema,
  qty: decimalString,
  unitCost: decimalString.optional(),
  value: decimalString.optional(),
});

export const postedAdjustmentSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  warehouseId: z.string().min(1),
  reason: adjustmentReasonSchema.nullable(),
  occurredAt: z.string().min(1),
  lines: z.array(postedAdjustmentLineSchema),
  valueDelta: decimalString.optional(),
});

export const postedTransferLineSchema = z.object({
  itemId: z.string().min(1),
  qty: decimalString,
  unitCost: decimalString.optional(),
  value: decimalString.optional(),
});

export const postedTransferSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  occurredAt: z.string().min(1),
  lines: z.array(postedTransferLineSchema),
  totalValue: decimalString.optional(),
});

export const postedAdjustmentListQuerySchema = z.object({
  fromDate: z.string().min(1).optional(),
  toDate: z.string().min(1).optional(),
  warehouseId: z.string().min(1).optional(),
  reason: adjustmentReasonSchema.optional(),
  search: z.string().optional(),
});

export const postedTransferListQuerySchema = z.object({
  fromDate: z.string().min(1).optional(),
  toDate: z.string().min(1).optional(),
  warehouseId: z.string().min(1).optional(),
  fromWarehouseId: z.string().min(1).optional(),
  toWarehouseId: z.string().min(1).optional(),
  search: z.string().optional(),
});

// --- Write requests ---

export const adjustmentLineSchema = z.object({
  itemId: z.string().min(1),
  direction: stockMovementDirectionSchema,
  qty: positiveDecimalString,
  unitCost: positiveDecimalString.optional(),
  batchNo: z.string().trim().min(1).nullish(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export const postAdjustmentSchema = z.object({
  adjustmentId: clientSuppliedId,
  adjustmentNumber: z.string().nullable().optional(),
  warehouseId: z.string().min(1),
  reason: adjustmentReasonSchema,
  lines: z.array(adjustmentLineSchema).min(1),
  occurredAt: z.string().min(1).optional(),
  /**
   * Accepted but no longer authoritative for `counterpartAccountId`: which
   * account absorbs a theft loss is the reason's business rule, not the
   * caller's choice, so the server derives it from `reason` (R5.9). Only
   * `inventoryAccountId` is still honoured as an override.
   */
  gl: z
    .object({
      inventoryAccountId: z.string().min(1),
      counterpartAccountId: z.string().min(1).optional(),
    })
    .optional(),
});

export const transferLineSchema = z.object({
  itemId: z.string().min(1),
  qty: positiveDecimalString,
});

export const postTransferSchema = z.object({
  transferId: clientSuppliedId,
  transferNumber: z.string().nullable().optional(),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  lines: z.array(transferLineSchema).min(1),
  occurredAt: z.string().min(1).optional(),
});

/** One warehouse's holding of a single item — `GET /inventory/items/:itemId/stock`. */
export const itemStockPositionSchema = z.object({
  warehouseId: z.string().min(1),
  onHand: decimalString,
  reserved: decimalString,
  available: decimalString,
  totalValue: decimalString.optional(),
  averageCost: decimalString.optional(),
});

/** One immutable WAC cost layer behind that holding. */
export const itemStockLayerSchema = z.object({
  id: z.string().min(1),
  warehouseId: z.string().min(1),
  unitCost: decimalString.optional(),
  originalQty: decimalString,
  remainingQty: decimalString,
  sourceDocType: stockSourceDocTypeSchema,
  sourceDocNumber: z.string().nullable(),
  createdAt: z.string().min(1),
});

/** `GET /inventory/items/:itemId/stock` — where one item's stock sits and what it cost. */
export const itemStockSchema = z.object({
  positions: z.array(itemStockPositionSchema),
  layers: z.array(itemStockLayerSchema),
});

export type StockMovementDirectionDTO = z.infer<typeof stockMovementDirectionSchema>;
export type AdjustmentReasonDTO = z.infer<typeof adjustmentReasonSchema>;
export type StockSourceDocTypeDTO = z.infer<typeof stockSourceDocTypeSchema>;
export type StockMovementDTO = z.infer<typeof stockMovementSchema>;
export type StockBalanceDTO = z.infer<typeof stockBalanceSchema>;
export type ValuationRowDTO = z.infer<typeof valuationRowSchema>;
export type ValuationReportDTO = z.infer<typeof valuationReportSchema>;
export type DriftReportDTO = z.infer<typeof driftReportSchema>;
export type PostedAdjustmentLineDTO = z.infer<typeof postedAdjustmentLineSchema>;
export type PostedAdjustmentDTO = z.infer<typeof postedAdjustmentSchema>;
export type PostedTransferLineDTO = z.infer<typeof postedTransferLineSchema>;
export type PostedTransferDTO = z.infer<typeof postedTransferSchema>;
export type PostedAdjustmentListQueryDTO = z.infer<typeof postedAdjustmentListQuerySchema>;
export type PostedTransferListQueryDTO = z.infer<typeof postedTransferListQuerySchema>;
export type AdjustmentLineDTO = z.infer<typeof adjustmentLineSchema>;
export type PostAdjustmentDTO = z.infer<typeof postAdjustmentSchema>;
export type TransferLineDTO = z.infer<typeof transferLineSchema>;
export type PostTransferDTO = z.infer<typeof postTransferSchema>;
export type ItemStockPositionDTO = z.infer<typeof itemStockPositionSchema>;
export type ItemStockLayerDTO = z.infer<typeof itemStockLayerSchema>;
export type ItemStockDTO = z.infer<typeof itemStockSchema>;
