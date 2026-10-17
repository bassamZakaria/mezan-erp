import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { documentStatusSchema } from "./documents.js";
import { adjustmentReasonSchema } from "./inventory.js";
import { costCategorySchema } from "./contracting.js";
import { isoDateOrInstant } from "./iso-date.js";
import { clientSuppliedId } from "./client-supplied-id.js";
import { documentApprovalSchema } from "./workflow.js";

/**
 * Wire contracts for the phase4/inventory-ops document layer built on the
 * generic document framework (documents.ts) + the stock-ledger engine
 * (inventory.ts): Stock Adjustments, Stock Transfers, Physical Counts, and the
 * read-only Stock Balance rollup (docs/archive/catalog/03).
 *
 * Money/Qty cross the wire as exact decimal strings (same convention as
 * inventory.ts / journal.ts) — never floats.
 */

/** @see moneyString — one guard for every exact-decimal field on the wire (D126). */
const decimalString = moneyString;
/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

// --- Stock Adjustment document ---------------------------------------------

export const stockAdjustmentDocLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  reason: adjustmentReasonSchema,
  direction: z.enum(["IN", "OUT"]),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString.nullish(),
  batchNo: z.string().trim().min(1).nullish(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/** Create a stock-adjustment draft. All lines must share one warehouse + one reason. */
export const createStockAdjustmentSchema = z.object({
  id: clientSuppliedId,
  date: isoDateOrInstant,
  memo: z.string().optional(),
  lines: z.array(stockAdjustmentDocLineSchema).min(1),
  /**
   * بُعد المشروع — the contracting project this adjustment's stock movement
   * belongs to (D-01). One project, one category per adjustment: a stock-out
   * adjustment issuing material to a site names both here, not per line.
   */
  projectId: z.string().min(1).nullish(),
  /** فئة التكلفة — only meaningful with `projectId`. */
  costCategory: costCategorySchema.nullish(),
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
  workflowRequestId: z.string().nullable().optional(),
  approval: documentApprovalSchema.nullable().optional(),
  journalEntryId: z.string().nullable(),
  reversesDocId: z.string().nullish(),
  reversedByDocId: z.string().nullish(),
  projectId: z.string().nullish(),
  costCategory: costCategorySchema.nullish(),
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
  id: clientSuppliedId,
  date: isoDateOrInstant,
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
  workflowRequestId: z.string().nullable().optional(),
  approval: documentApprovalSchema.nullable().optional(),
});

// --- Physical Count ----------------------------------------------------------

export const physicalCountStatusSchema = z.enum([
  "IN_PROGRESS",
  "COMPLETED",
  "ADJUSTMENT_GENERATED",
  "CANCELLED",
]);

/**
 * `systemQty`, `unitCost` and the two variance fields are NULL on a blind
 * count (جرد أعمى) that is still in progress — the API withholds the snapshot
 * from the counter rather than the client hiding it.
 */
export const physicalCountLineSchema = z.object({
  itemId: z.string().min(1),
  systemQty: decimalString.nullable(),
  unitCost: decimalString.nullable(),
  countedQty: decimalString.nullable(),
  varianceQty: decimalString.nullable(),
  varianceValue: decimalString.nullable(),
  recount: z.boolean().optional(),
});

/** Over/short rollup — `over*`/`short*` are positive magnitudes, `net = over − short`. */
export const physicalCountVarianceSummarySchema = z.object({
  totalLines: z.number().int().nonnegative(),
  countedLines: z.number().int().nonnegative(),
  uncountedLines: z.number().int().nonnegative(),
  matchedLines: z.number().int().nonnegative(),
  overLines: z.number().int().nonnegative(),
  shortLines: z.number().int().nonnegative(),
  overQty: decimalString,
  shortQty: decimalString,
  netQty: decimalString,
  overValue: decimalString,
  shortValue: decimalString,
  netValue: decimalString,
  absValue: decimalString,
});

export const startPhysicalCountSchema = z.object({
  id: clientSuppliedId,
  warehouseId: z.string().min(1),
  date: isoDateOrInstant,
  memo: z.string().optional(),
  itemIds: z.array(z.string().min(1)).min(1),
  blind: z.boolean().optional(),
});

export const recordPhysicalCountEntrySchema = z.object({
  itemId: z.string().min(1),
  countedQty: positiveDecimalString,
});

export const recordPhysicalCountEntriesSchema = z.object({
  entries: z.array(recordPhysicalCountEntrySchema).min(1),
});

export const generateAdjustmentFromCountSchema = z.object({
  adjustmentId: clientSuppliedId,
});

export const physicalCountSchema = z.object({
  id: z.string().min(1),
  countNo: z.string().nullable(),
  warehouseId: z.string().min(1),
  date: z.string(),
  memo: z.string(),
  status: physicalCountStatusSchema,
  blind: z.boolean(),
  zoned: z.boolean().optional(),
  lines: z.array(physicalCountLineSchema),
  /** Null while a blind count is still in progress. */
  variance: physicalCountVarianceSummarySchema.nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  generatedAdjustmentId: z.string().nullable(),
});

// --- Stock Balance rollup ----------------------------------------------------

/** One warehouse's share of a rolled-up balance row (R5.7). */
export const stockBalanceWarehouseRowSchema = z.object({
  warehouseId: z.string().min(1),
  onHand: decimalString,
  totalValue: decimalString,
  averageCost: decimalString,
  reserved: decimalString,
  available: decimalString,
});

export const stockBalanceRowSchema = z.object({
  itemId: z.string().min(1),
  onHand: decimalString,
  totalValue: decimalString,
  averageCost: decimalString,
  warehouseCount: z.number().int().nonnegative(),
  /** Committed by an open document but not yet moved (R5.6). */
  reserved: decimalString,
  available: decimalString,
  /** The positions this row rolled up, so it can expand without a round trip. */
  warehouses: z.array(stockBalanceWarehouseRowSchema),
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
export type PhysicalCountVarianceSummaryDTO = z.infer<typeof physicalCountVarianceSummarySchema>;
export type StartPhysicalCountDTO = z.infer<typeof startPhysicalCountSchema>;
export type RecordPhysicalCountEntryDTO = z.infer<typeof recordPhysicalCountEntrySchema>;
export type RecordPhysicalCountEntriesDTO = z.infer<typeof recordPhysicalCountEntriesSchema>;
export type GenerateAdjustmentFromCountDTO = z.infer<typeof generateAdjustmentFromCountSchema>;
export type PhysicalCountDTO = z.infer<typeof physicalCountSchema>;
export type StockBalanceRowDTO = z.infer<typeof stockBalanceRowSchema>;
export type StockBalanceWarehouseRowDTO = z.infer<typeof stockBalanceWarehouseRowSchema>;
export type StockBalanceListQueryDTO = z.infer<typeof stockBalanceListQuerySchema>;
