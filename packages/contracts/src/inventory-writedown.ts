import { z } from "zod";

/**
 * Wire contracts for the Inventory aging-based write-down batch (docs/tasks.md
 * Phase 4 "Aging-based inventory write-down batch"). Money/Qty fields cross
 * the wire as exact decimal strings, never a float — the domain re-parses
 * them via `Money.fromMajor`/`Qty.fromMajor`.
 */

export const writedownRunStatusSchema = z.enum(["draft", "posted", "cancelled"]);

export const writedownRunLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  onHandQty: z.string(),
  unitCost: z.string(),
  agingDays: z.number().int().nonnegative(),
  writedownRateBps: z.number().int().nonnegative(),
  amount: z.string(),
});

export const writedownRunSchema = z.object({
  id: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  warehouseId: z.string().nullable(),
  status: writedownRunStatusSchema,
  lines: z.array(writedownRunLineSchema),
  totalAmount: z.string(),
  journalEntryId: z.string().nullable(),
  createdAt: z.string(),
  postedAt: z.string().nullable(),
});

export const createWritedownRunSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  warehouseId: z.string().nullable().optional(),
});

export type WritedownRunStatusDTO = z.infer<typeof writedownRunStatusSchema>;
export type WritedownRunLineDTO = z.infer<typeof writedownRunLineSchema>;
export type WritedownRunDTO = z.infer<typeof writedownRunSchema>;
export type CreateWritedownRunDTO = z.infer<typeof createWritedownRunSchema>;
