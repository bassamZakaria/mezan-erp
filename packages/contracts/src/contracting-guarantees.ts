import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contract for خطابات الضمان — the letters-of-guarantee register
 * (docs/artifacts/mezan-contracting-designs.html §05). Money crosses the wire
 * as an exact decimal string, never a float; the domain re-parses it through
 * `Money.fromMajor`.
 */

export const guaranteeKindSchema = z.enum(["bid", "performance", "advance", "maintenance"]);

/**
 * `expired` is a READ-time derivation (expiry passed while still outstanding),
 * never a stored status — the ledger still carries the letter until it is
 * released, so the server reports it separately as `derivedStatus`.
 */
export const guaranteeStatusSchema = z.enum(["draft", "active", "reduced", "released", "called", "expired"]);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ يجب أن يكون بصيغة YYYY-MM-DD");
const percentString = z.string().regex(/^\d+(\.\d+)?$/, "النسبة يجب أن تكون رقماً موجباً");

export const guaranteeReductionSchema = z.object({
  date: isoDate,
  amount: moneyString,
  reason: z.string().min(1),
  sourceRef: z.string().nullable(),
});

export const guaranteeSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  kind: guaranteeKindSchema,
  projectId: z.string().nullable(),
  contractId: z.string().nullable(),
  tenderRef: z.string().nullable(),
  beneficiaryNameAr: z.string().min(1),
  bankTreasuryAccountId: z.string().min(1),
  bankNameAr: z.string(),
  faceValue: moneyString,
  percentOfContract: z.string().nullable(),
  cashMarginPercent: z.string(),
  cashMarginAmount: moneyString,
  issueDate: isoDate,
  expiryDate: isoDate,
  status: guaranteeStatusSchema,
  /** What the list shows: `status`, or `expired` when the expiry date has passed and it is still outstanding. */
  derivedStatus: guaranteeStatusSchema,
  /** Days until `expiryDate`. Negative once it has passed. */
  daysToExpiry: z.number(),
  currentValue: moneyString,
  reductions: z.array(guaranteeReductionSchema),
  closedDate: z.string().nullable(),
  closedAmount: moneyString,
  notes: z.string().nullable(),
});

export const createGuaranteeSchema = z.object({
  id: z.string().min(1),
  kind: guaranteeKindSchema,
  projectId: z.string().nullable().optional(),
  contractId: z.string().nullable().optional(),
  tenderRef: z.string().nullable().optional(),
  beneficiaryNameAr: z.string().min(1),
  bankTreasuryAccountId: z.string().min(1),
  faceValue: moneyString,
  percentOfContract: percentString.nullable().optional(),
  cashMarginPercent: percentString.optional(),
  /** Overrides face × margin%. The server computes it when omitted. */
  cashMarginAmount: moneyString.optional(),
  issueDate: isoDate,
  expiryDate: isoDate,
  notes: z.string().nullable().optional(),
});

/** All fields optional — a PATCH applies only what it carries, and only to a draft. */
export const updateGuaranteeSchema = z.object({
  kind: guaranteeKindSchema.optional(),
  projectId: z.string().nullable().optional(),
  contractId: z.string().nullable().optional(),
  tenderRef: z.string().nullable().optional(),
  beneficiaryNameAr: z.string().min(1).optional(),
  bankTreasuryAccountId: z.string().min(1).optional(),
  faceValue: moneyString.optional(),
  percentOfContract: percentString.nullable().optional(),
  cashMarginPercent: percentString.optional(),
  cashMarginAmount: moneyString.optional(),
  issueDate: isoDate.optional(),
  expiryDate: isoDate.optional(),
  notes: z.string().nullable().optional(),
});

export const reduceGuaranteeSchema = z.object({
  date: isoDate,
  amount: moneyString,
  reason: z.string().min(1),
  sourceRef: z.string().nullable().optional(),
});

export const releaseGuaranteeSchema = z.object({
  date: isoDate,
});

export const callGuaranteeSchema = z.object({
  date: isoDate,
  /** Omitted, the beneficiary draws the whole outstanding value. */
  amount: moneyString.optional(),
  /** Where the loss lands. Omitted, the `contracting.onerous_loss` routing slot decides (5930 by default). */
  chargeAccountId: z.string().min(1).nullable().optional(),
});

export const guaranteeBankRowSchema = z.object({
  bankTreasuryAccountId: z.string(),
  bankNameAr: z.string(),
  outstanding: moneyString,
  restrictedCash: moneyString,
  facilityLimit: moneyString.nullable(),
  available: moneyString.nullable(),
  count: z.number(),
});

export const guaranteeProjectRowSchema = z.object({
  projectId: z.string().nullable(),
  projectNameAr: z.string(),
  outstanding: moneyString,
  restrictedCash: moneyString,
  count: z.number(),
});

export const guaranteeSummarySchema = z.object({
  asOfDate: isoDate,
  totalOutstanding: moneyString,
  restrictedCash: moneyString,
  totalFacilityLimit: moneyString,
  totalAvailable: moneyString,
  expiringWithin30Days: z.number(),
  byBank: z.array(guaranteeBankRowSchema),
  byProject: z.array(guaranteeProjectRowSchema),
});

export type GuaranteeKindDTO = z.infer<typeof guaranteeKindSchema>;
export type GuaranteeStatusDTO = z.infer<typeof guaranteeStatusSchema>;
export type GuaranteeReductionDTO = z.infer<typeof guaranteeReductionSchema>;
export type GuaranteeDTO = z.infer<typeof guaranteeSchema>;
export type CreateGuaranteeDTO = z.infer<typeof createGuaranteeSchema>;
export type UpdateGuaranteeDTO = z.infer<typeof updateGuaranteeSchema>;
export type ReduceGuaranteeDTO = z.infer<typeof reduceGuaranteeSchema>;
export type ReleaseGuaranteeDTO = z.infer<typeof releaseGuaranteeSchema>;
export type CallGuaranteeDTO = z.infer<typeof callGuaranteeSchema>;
export type GuaranteeBankRowDTO = z.infer<typeof guaranteeBankRowSchema>;
export type GuaranteeProjectRowDTO = z.infer<typeof guaranteeProjectRowSchema>;
export type GuaranteeSummaryDTO = z.infer<typeof guaranteeSummarySchema>;
