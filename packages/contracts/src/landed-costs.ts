import { z } from "zod";
import { nonNegativeMoneyString } from "./money-string.js";
import { documentStatusSchema } from "./documents.js";
import { costCategorySchema } from "./contracting.js";
import { isoDateOrInstant } from "./iso-date.js";

/** Wire contracts for Landed Costs (التكاليف الإضافية، docs/archive/catalog/02). */

/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

export const landedCostTypeSchema = z.enum(["SHIPPING", "CUSTOMS", "INSURANCE", "CLEARANCE", "OTHER"]);
export const landedCostDistributionMethodSchema = z.enum(["BY_VALUE", "BY_QUANTITY", "BY_WEIGHT"]);

export const landedCostItemEntrySchema = z.object({
  costType: landedCostTypeSchema,
  description: z.string(),
  amount: positiveDecimalString,
  /** The freight/customs vendor this charge is owed to, so the accrual has a name on it (D75). */
  supplierId: z.string().min(1).nullish(),
});

export const landedCostTargetSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  /** Shipped weight of the line — the basis BY_WEIGHT allocates on (R4.7). */
  weight: positiveDecimalString.default("0"),
  /** فئة التكلفة — only meaningful with the document's `projectId`; defaults to "materials" on the inventory debit (D-01). */
  costCategory: costCategorySchema.nullish(),
});

/**
 * The create request carries the RAW inputs (cost items + targets); the API
 * route runs `distributeLandedCost` server-side and persists the allocated
 * result as the document's lines — the client never computes/round-trips the
 * allocation math itself.
 */
export const createLandedCostSchema = z.object({
  id: z.string().min(1),
  date: isoDateOrInstant,
  memo: z.string().default(""),
  distributionMethod: landedCostDistributionMethodSchema,
  costItems: z.array(landedCostItemEntrySchema).min(1),
  targets: z.array(landedCostTargetSchema).min(1),
  /** بُعد المشروع — the contracting project this landed cost's absorption belongs to (D-01). */
  projectId: z.string().min(1).nullable().optional(),
});

export const landedCostLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
  weight: positiveDecimalString,
  allocatedAmount: positiveDecimalString,
  newUnitCost: positiveDecimalString,
  distributionMethod: landedCostDistributionMethodSchema,
  costItems: z.array(landedCostItemEntrySchema),
  /** بُعد المشروع — every line of a confirmed landed-cost document carries the same document-wide value (D-01). */
  projectId: z.string().min(1).nullable().optional(),
  costCategory: costCategorySchema.nullish(),
});

export const landedCostDocumentSchema = z.object({
  id: z.string(),
  docType: z.literal("LANDED_COST"),
  docNo: z.string().nullable(),
  date: z.string(),
  /** The day the stock took the cost; null on a draft. Later than `date` when the invoice arrived after the goods. */
  absorptionDate: z.string().nullable().optional(),
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
