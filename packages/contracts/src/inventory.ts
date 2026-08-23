import { z } from "zod";

/**
 * Wire contracts for the costing + stock-ledger engine (docs/catalog/03).
 * Money and Qty cross the wire as EXACT decimal strings (same convention as
 * journal.ts) — never floats — so JSON is byte-identical on every edition.
 */

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be an exact decimal string");
const positiveDecimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

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
]);

export const stockMovementSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  direction: stockMovementDirectionSchema,
  qty: decimalString,
  unitCost: decimalString,
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
  averageCost: decimalString,
  totalValue: decimalString,
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

// --- Write requests ---

export const adjustmentLineSchema = z.object({
  itemId: z.string().min(1),
  direction: stockMovementDirectionSchema,
  qty: positiveDecimalString,
  unitCost: positiveDecimalString.optional(),
});

export const postAdjustmentSchema = z.object({
  adjustmentId: z.string().min(1),
  adjustmentNumber: z.string().nullable().optional(),
  warehouseId: z.string().min(1),
  reason: adjustmentReasonSchema,
  lines: z.array(adjustmentLineSchema).min(1),
  occurredAt: z.string().min(1).optional(),
  gl: z
    .object({
      inventoryAccountId: z.string().min(1),
      counterpartAccountId: z.string().min(1),
    })
    .optional(),
});

export const transferLineSchema = z.object({
  itemId: z.string().min(1),
  qty: positiveDecimalString,
});

export const postTransferSchema = z.object({
  transferId: z.string().min(1),
  transferNumber: z.string().nullable().optional(),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  lines: z.array(transferLineSchema).min(1),
  occurredAt: z.string().min(1).optional(),
});

export type StockMovementDirectionDTO = z.infer<typeof stockMovementDirectionSchema>;
export type AdjustmentReasonDTO = z.infer<typeof adjustmentReasonSchema>;
export type StockSourceDocTypeDTO = z.infer<typeof stockSourceDocTypeSchema>;
export type StockMovementDTO = z.infer<typeof stockMovementSchema>;
export type StockBalanceDTO = z.infer<typeof stockBalanceSchema>;
export type ValuationRowDTO = z.infer<typeof valuationRowSchema>;
export type ValuationReportDTO = z.infer<typeof valuationReportSchema>;
export type DriftReportDTO = z.infer<typeof driftReportSchema>;
export type AdjustmentLineDTO = z.infer<typeof adjustmentLineSchema>;
export type PostAdjustmentDTO = z.infer<typeof postAdjustmentSchema>;
export type TransferLineDTO = z.infer<typeof transferLineSchema>;
export type PostTransferDTO = z.infer<typeof postTransferSchema>;
