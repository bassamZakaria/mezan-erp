import { z } from "zod";

/**
 * Wire contracts for the historical purchase-document import (docs/catalog/02
 * §"استيراد فواتير سابقة" / §"استيراد مرتجعات سابقة"). Money/Qty cross the
 * wire as EXACT decimal strings, same convention as purchasing.ts.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be an exact decimal string");
const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

export const historicalPurchaseDocTypeSchema = z.enum(["PURCHASE_INVOICE", "PURCHASE_RETURN"]);

/** One row of the uploaded Excel/CSV — one item line; header fields repeat per row. */
export const historicalImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  docType: historicalPurchaseDocTypeSchema,
  documentNumber: z.string().min(1),
  supplierId: z.string().min(1),
  date: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  amountPaid: positiveDecimalString,
});

/** POST /purchases/historical-import/preview and .../commit body. */
export const historicalImportBatchSchema = z.object({
  rows: z.array(historicalImportRowSchema).min(1),
});

export const historicalImportRowErrorSchema = z.object({
  rowNumber: z.number().int().positive(),
  reasons: z.array(z.string()),
});

export const historicalImportGroupPreviewSchema = z.object({
  documentNumber: z.string(),
  docType: historicalPurchaseDocTypeSchema,
  supplierId: z.string(),
  date: z.string(),
  dueDate: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  total: decimalString,
  amountPaid: decimalString,
  remainingBalance: decimalString,
  settled: z.boolean(),
});

/** Response shape for both the dry-run preview and the commit (commit also returns `archivedIds`). */
export const historicalImportResultSchema = z.object({
  groups: z.array(historicalImportGroupPreviewSchema),
  errors: z.array(historicalImportRowErrorSchema),
  archivedIds: z.array(z.string()).optional(),
});

export const historicalPurchaseArchiveLineSchema = z.object({
  itemId: z.string().nullable(),
  description: z.string().nullable(),
  qty: decimalString,
  unitCost: decimalString,
});

export const historicalPurchaseArchiveSchema = z.object({
  id: z.string().min(1),
  docType: historicalPurchaseDocTypeSchema,
  originalNumber: z.string(),
  supplierId: z.string(),
  date: z.string(),
  dueDate: z.string().nullable(),
  lines: z.array(historicalPurchaseArchiveLineSchema),
  total: decimalString,
  amountPaid: decimalString,
  remainingBalance: decimalString,
  settled: z.boolean(),
  importBatchId: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export type HistoricalPurchaseDocTypeDTO = z.infer<typeof historicalPurchaseDocTypeSchema>;
export type HistoricalImportRowDTO = z.infer<typeof historicalImportRowSchema>;
export type HistoricalImportBatchDTO = z.infer<typeof historicalImportBatchSchema>;
export type HistoricalImportRowErrorDTO = z.infer<typeof historicalImportRowErrorSchema>;
export type HistoricalImportGroupPreviewDTO = z.infer<typeof historicalImportGroupPreviewSchema>;
export type HistoricalImportResultDTO = z.infer<typeof historicalImportResultSchema>;
export type HistoricalPurchaseArchiveLineDTO = z.infer<typeof historicalPurchaseArchiveLineSchema>;
export type HistoricalPurchaseArchiveDTO = z.infer<typeof historicalPurchaseArchiveSchema>;
