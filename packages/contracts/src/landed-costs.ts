import { z } from "zod";
import { documentStatusSchema } from "./documents.js";

/** Wire contracts for Landed Costs (التكاليف الإضافية، docs/catalog/02). */

const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

export const landedCostTypeSchema = z.enum(["SHIPPING", "CUSTOMS", "INSURANCE", "CLEARANCE", "OTHER"]);
export const landedCostDistributionMethodSchema = z.enum(["BY_VALUE", "BY_QUANTITY"]);

export const landedCostItemEntrySchema = z.object({
  costType: landedCostTypeSchema,
  description: z.string(),
  amount: positiveDecimalString,
});

export const landedCostTargetSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
});

/**
 * The create request carries the RAW inputs (cost items + targets); the API
 * route runs `distributeLandedCost` server-side and persists the allocated
 * result as the document's lines — the client never computes/round-trips the
 * allocation math itself.
 */
export const createLandedCostSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string().default(""),
  distributionMethod: landedCostDistributionMethodSchema,
  costItems: z.array(landedCostItemEntrySchema).min(1),
  targets: z.array(landedCostTargetSchema).min(1),
});

export const landedCostLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  allocatedAmount: positiveDecimalString,
  newUnitCost: positiveDecimalString,
  distributionMethod: landedCostDistributionMethodSchema,
  costItems: z.array(landedCostItemEntrySchema),
});

export const landedCostDocumentSchema = z.object({
  id: z.string(),
  docType: z.literal("LANDED_COST"),
  docNo: z.string().nullable(),
  date: z.string(),
  memo: z.string(),
  status: documentStatusSchema,
  lines: z.array(landedCostLineSchema),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  reversesDocId: z.string().nullable(),
  reversedByDocId: z.string().nullable(),
  workflowRequestId: z.string().nullable(),
  journalEntryId: z.string().nullable(),
});

export type LandedCostTypeDTO = z.infer<typeof landedCostTypeSchema>;
export type LandedCostDistributionMethodDTO = z.infer<typeof landedCostDistributionMethodSchema>;
export type LandedCostItemEntryDTO = z.infer<typeof landedCostItemEntrySchema>;
export type LandedCostTargetDTO = z.infer<typeof landedCostTargetSchema>;
export type CreateLandedCostDTO = z.infer<typeof createLandedCostSchema>;
export type LandedCostLineDTO = z.infer<typeof landedCostLineSchema>;
export type LandedCostDocumentDTO = z.infer<typeof landedCostDocumentSchema>;
