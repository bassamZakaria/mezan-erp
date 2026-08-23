import { z } from "zod";
import { documentStatusSchema } from "./documents.js";
import { adjustmentReasonSchema } from "./inventory.js";

/**
 * Wire contracts for the phase4/inventory-ops document layer built on the
 * generic document framework (documents.ts) + the stock-ledger engine
 * (inventory.ts): Stock Adjustments, Stock Transfers, Physical Counts, and the
 * read-only Stock Balance rollup (docs/catalog/03).
 *
 * Money/Qty cross the wire as exact decimal strings (same convention as
 * inventory.ts / journal.ts) — never floats.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be an exact decimal string");
const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

// --- Stock Adjustment document ---------------------------------------------

export const stockAdjustmentDocLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  reason: adjustmentReasonSchema,
  direction: z.enum(["IN", "OUT"]),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString.nullish(),
});

/** Create a stock-adjustment draft. All lines must share one warehouse + one reason. */
export const createStockAdjustmentSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string().optional(),
  lines: z.array(stockAdjustmentDocLineSchema).min(1),
});

export const stockAdjustmentDocumentSchema = z.object({
  id: z.string().min(1),
  docType: z.literal("STOCK_ADJUSTMENT"),
  docNo: z.string().nullable(),
  date: z.string(),
  memo: z.string(),
  status: documentStatusSchema,
  lines: z.array(stockAdjustmentDocLineSchema),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  journalEntryId: z.string().nullable(),
});

// --- Stock Transfer document ------------------------------------------------

export const stockTransferDocLineSchema = z.object({
  itemId: z.string().min(1),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  qty: positiveDecimalString,
});

/** Create a stock-transfer draft. All lines must share one source + one destination warehouse. */
export const createStockTransferSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string().optional(),
  lines: z.array(stockTransferDocLineSchema).min(1),
});

export const stockTransferDocumentSchema = z.object({
  id: z.string().min(1),
  docType: z.literal("STOCK_TRANSFER"),
  docNo: z.string().nullable(),
  date: z.string(),
  memo: z.string(),
  status: documentStatusSchema,
  lines: z.array(stockTransferDocLineSchema),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});

// --- Physical Count ----------------------------------------------------------

export const physicalCountStatusSchema = z.enum([
  "IN_PROGRESS",
  "COMPLETED",
  "ADJUSTMENT_GENERATED",
  "CANCELLED",
]);

export const physicalCountLineSchema = z.object({
  itemId: z.string().min(1),
  systemQty: decimalString,
  countedQty: decimalString.nullable(),
});

export const startPhysicalCountSchema = z.object({
  id: z.string().min(1),
  warehouseId: z.string().min(1),
  date: z.string().min(1),
  memo: z.string().optional(),
  itemIds: z.array(z.string().min(1)).min(1),
});

export const recordPhysicalCountEntrySchema = z.object({
  itemId: z.string().min(1),
  countedQty: positiveDecimalString,
});

export const recordPhysicalCountEntriesSchema = z.object({
  entries: z.array(recordPhysicalCountEntrySchema).min(1),
});

export const generateAdjustmentFromCountSchema = z.object({
  adjustmentId: z.string().min(1),
});

export const physicalCountSchema = z.object({
  id: z.string().min(1),
  countNo: z.string().nullable(),
  warehouseId: z.string().min(1),
  date: z.string(),
  memo: z.string(),
  status: physicalCountStatusSchema,
  lines: z.array(physicalCountLineSchema),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  generatedAdjustmentId: z.string().nullable(),
});

// --- Stock Balance rollup ----------------------------------------------------

export const stockBalanceRowSchema = z.object({
  itemId: z.string().min(1),
  onHand: decimalString,
  totalValue: decimalString,
  averageCost: decimalString,
  warehouseCount: z.number().int().nonnegative(),
});

export const stockBalanceListQuerySchema = z.object({
  warehouseId: z.string().optional(),
});

export type StockAdjustmentDocLineDTO = z.infer<typeof stockAdjustmentDocLineSchema>;
export type CreateStockAdjustmentDTO = z.infer<typeof createStockAdjustmentSchema>;
export type StockAdjustmentDocumentDTO = z.infer<typeof stockAdjustmentDocumentSchema>;
export type StockTransferDocLineDTO = z.infer<typeof stockTransferDocLineSchema>;
export type CreateStockTransferDTO = z.infer<typeof createStockTransferSchema>;
export type StockTransferDocumentDTO = z.infer<typeof stockTransferDocumentSchema>;
export type PhysicalCountStatusDTO = z.infer<typeof physicalCountStatusSchema>;
export type PhysicalCountLineDTO = z.infer<typeof physicalCountLineSchema>;
export type StartPhysicalCountDTO = z.infer<typeof startPhysicalCountSchema>;
export type RecordPhysicalCountEntryDTO = z.infer<typeof recordPhysicalCountEntrySchema>;
export type RecordPhysicalCountEntriesDTO = z.infer<typeof recordPhysicalCountEntriesSchema>;
export type GenerateAdjustmentFromCountDTO = z.infer<typeof generateAdjustmentFromCountSchema>;
export type PhysicalCountDTO = z.infer<typeof physicalCountSchema>;
export type StockBalanceRowDTO = z.infer<typeof stockBalanceRowSchema>;
export type StockBalanceListQueryDTO = z.infer<typeof stockBalanceListQuerySchema>;
