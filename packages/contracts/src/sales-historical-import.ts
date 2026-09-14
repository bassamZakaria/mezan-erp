import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { isoDateOrInstant } from "./iso-date.js";

/**
 * Wire contracts for the historical sales-document import (docs/archive/catalog/01
 * §"استيراد فواتير سابقة" / §"استيراد مرتجعات سابقة"). Money/Qty cross the
 * wire as EXACT decimal strings, same convention as sales.ts.
 */

/** @see moneyString — one guard for every exact-decimal field on the wire (D126). */
const decimalString = moneyString;
/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

export const historicalSalesDocTypeSchema = z.enum(["SALES_INVOICE", "SALES_RETURN"]);

/** One row of the uploaded Excel/CSV — one item line; header fields repeat per row. */
export const historicalSalesImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  docType: historicalSalesDocTypeSchema,
  documentNumber: z.string().min(1),
  customerId: z.string().min(1),
  date: isoDateOrInstant,
  dueDate: z.string().nullable().optional(),
  itemId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  amountPaid: positiveDecimalString,
});

/** POST /sales/historical-import/preview and .../commit body. */
export const historicalSalesImportBatchSchema = z.object({
  rows: z.array(historicalSalesImportRowSchema).min(1),
});

export const historicalSalesImportRowErrorSchema = z.object({
  rowNumber: z.number().int().positive(),
  reasons: z.array(z.string()),
});

export const historicalSalesImportGroupPreviewSchema = z.object({
  documentNumber: z.string(),
  docType: historicalSalesDocTypeSchema,
  customerId: z.string(),
  date: z.string(),
  dueDate: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  total: decimalString,
  amountPaid: decimalString,
  remainingBalance: decimalString,
  settled: z.boolean(),
});

/** Response shape for both the dry-run preview and the commit (commit also returns `archivedIds`). */
export const historicalSalesImportResultSchema = z.object({
  groups: z.array(historicalSalesImportGroupPreviewSchema),
  errors: z.array(historicalSalesImportRowErrorSchema),
  archivedIds: z.array(z.string()).optional(),
});

export const historicalSalesArchiveLineSchema = z.object({
  itemId: z.string().nullable(),
  description: z.string().nullable(),
  qty: decimalString,
  unitCost: decimalString,
});

export const historicalSalesArchiveSchema = z.object({
  id: z.string().min(1),
  docType: historicalSalesDocTypeSchema,
  originalNumber: z.string(),
  customerId: z.string(),
  date: z.string(),
  dueDate: z.string().nullable(),
  lines: z.array(historicalSalesArchiveLineSchema),
  total: decimalString,
  amountPaid: decimalString,
  remainingBalance: decimalString,
  settled: z.boolean(),
  importBatchId: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export type HistoricalSalesDocTypeDTO = z.infer<typeof historicalSalesDocTypeSchema>;
export type HistoricalSalesImportRowDTO = z.infer<typeof historicalSalesImportRowSchema>;
export type HistoricalSalesImportBatchDTO = z.infer<typeof historicalSalesImportBatchSchema>;
export type HistoricalSalesImportRowErrorDTO = z.infer<typeof historicalSalesImportRowErrorSchema>;
export type HistoricalSalesImportGroupPreviewDTO = z.infer<typeof historicalSalesImportGroupPreviewSchema>;
export type HistoricalSalesImportResultDTO = z.infer<typeof historicalSalesImportResultSchema>;
export type HistoricalSalesArchiveLineDTO = z.infer<typeof historicalSalesArchiveLineSchema>;
export type HistoricalSalesArchiveDTO = z.infer<typeof historicalSalesArchiveSchema>;
