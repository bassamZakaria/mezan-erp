import { z } from "zod";
import { moneyString } from "./money-string.js";
import { recognitionPolicySchema } from "./contracting-contracts.js";

/**
 * Wire contract for تشغيل الاعتراف بالإيراد — the monthly EAS 48 cost-to-cost
 * run (docs/artifacts/mezan-contracting-designs.html D-03, D-12). Money crosses
 * the wire as an exact decimal string, never a float.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ يجب أن يكون بصيغة YYYY-MM-DD");

export const recognitionRunStatusSchema = z.enum(["posted", "reversed"]);
export const recognitionCostCategorySchema = z.enum([
  "materials",
  "labour",
  "equipment",
  "subcontract",
  "indirect",
]);

export const wipCategoryAmountSchema = z.object({
  costCategory: recognitionCostCategorySchema.nullable(),
  amount: moneyString,
});

export const recognitionFiguresSchema = z.object({
  recognitionPolicy: recognitionPolicySchema,
  estimatedTotalCost: moneyString,
  costToDate: moneyString,
  costToComplete: moneyString,
  /** Exact decimal string with four places, capped at "100.0000". */
  percentComplete: z.string(),
  contractValue: moneyString,
  revenueToDate: moneyString,
  revenueRecognisedPreviously: moneyString,
  periodRevenue: moneyString,
  billedInPeriod: moneyString,
  billedToDate: moneyString,
  contractAsset: moneyString,
  contractLiability: moneyString,
  contractPositionMovement: moneyString,
  foreseeableLoss: moneyString,
  provisionRequired: moneyString,
  provisionBalance: moneyString,
  provisionMovement: moneyString,
  wipOpening: moneyString,
  wipIncurred: moneyString,
  wipRelieved: moneyString,
  wipClosing: moneyString,
  wipByCategory: z.array(wipCategoryAmountSchema),
  /** دفعات مقدمة من العملاء still outstanding — the 2160 credit balance at `periodEnd`. */
  advanceOutstanding: moneyString,
  /** محتجزات لدى العميل — the 1150 debit balance at `periodEnd`. */
  retentionHeld: moneyString,
});

export const recognitionRunSchema = recognitionFiguresSchema.extend({
  id: z.string().min(1),
  docNo: z.string().min(1),
  contractId: z.string().min(1),
  contractDocNo: z.string(),
  projectId: z.string().min(1),
  periodEnd: isoDate,
  status: recognitionRunStatusSchema,
  journalEntryId: z.string().nullable(),
  reversalJournalEntryId: z.string().nullable(),
  postedAt: z.string(),
  postedBy: z.string().nullable(),
  reversedAt: z.string().nullable(),
  reversedBy: z.string().nullable(),
});

export const recognitionPreviewSchema = recognitionFiguresSchema.extend({
  contractId: z.string().min(1),
  contractDocNo: z.string(),
  contractTitleAr: z.string(),
  contractStatus: z.enum(["draft", "active", "completed", "terminated"]),
  projectId: z.string().min(1),
  periodEnd: isoDate,
  lastRunPeriodEnd: isoDate.nullable(),
  existingRunId: z.string().nullable(),
  existingRunDocNo: z.string().nullable(),
  due: z.boolean(),
  /** Why «تشغيل» is refused, in Arabic. Null when the run would go through. */
  blockedReasonAr: z.string().nullable(),
  /** The same arithmetic re-run against today's ledger for a CLOSED period. Null otherwise. */
  recomputed: recognitionFiguresSchema.nullable(),
  /** True when `recomputed` disagrees with what the run posted. */
  divergent: z.boolean(),
});

export const postRecognitionRunSchema = z.object({
  id: z.string().min(1).optional(),
  contractId: z.string().min(1),
  periodEnd: isoDate,
});

export type RecognitionRunStatusDTO = z.infer<typeof recognitionRunStatusSchema>;
export type WipCategoryAmountDTO = z.infer<typeof wipCategoryAmountSchema>;
export type RecognitionFiguresDTO = z.infer<typeof recognitionFiguresSchema>;
export type RecognitionRunDTO = z.infer<typeof recognitionRunSchema>;
export type RecognitionPreviewDTO = z.infer<typeof recognitionPreviewSchema>;
export type PostRecognitionRunDTO = z.infer<typeof postRecognitionRunSchema>;
