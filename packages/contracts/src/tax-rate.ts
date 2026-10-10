import { z } from "zod";

/** Wire contract for tax rates (docs/archive/catalog/04 "الضرائب"). */
export const taxCalculationTypeSchema = z.enum(["exclusive", "inclusive"]);
export const taxRateStatusSchema = z.enum(["active", "inactive"]);
export const etaVatSubTypeSchema = z.enum([
  "auto",
  "V001",
  "V002",
  "V003",
  "V004",
  "V005",
  "V006",
  "V007",
  "V008",
  "V009",
]);

export const taxRateSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  // Range (0-100) is enforced by the domain (InvalidTaxRateError -> 422), not
  // here, so an out-of-range rate reaches the API as a domain error rather
  // than a generic 400 zod-shape error.
  rate: z.number(),
  calculationType: taxCalculationTypeSchema,
  isDefault: z.boolean(),
  outputTaxAccountId: z.string().nullable(),
  inputTaxAccountId: z.string().nullable(),
  etaSubType: etaVatSubTypeSchema,
  status: taxRateStatusSchema,
  /** A rate the system owns and names on the 0% lines it raises; PATCH answers 409 `TAX_RATE_SYSTEM_LOCKED`. */
  isSystem: z.boolean().optional(),
});

export const createTaxRateSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  rate: z.number(),
  calculationType: taxCalculationTypeSchema.optional(),
  isDefault: z.boolean().optional(),
  outputTaxAccountId: z.string().nullable().optional(),
  inputTaxAccountId: z.string().nullable().optional(),
  etaSubType: etaVatSubTypeSchema.optional(),
});

/** All fields optional — a PATCH applies only what's supplied. */
export const updateTaxRateSchema = z.object({
  name: z.string().min(1).optional(),
  rate: z.number().optional(),
  calculationType: taxCalculationTypeSchema.optional(),
  isDefault: z.boolean().optional(),
  outputTaxAccountId: z.string().nullable().optional(),
  inputTaxAccountId: z.string().nullable().optional(),
  etaSubType: etaVatSubTypeSchema.optional(),
  status: taxRateStatusSchema.optional(),
});

export type TaxCalculationTypeDTO = z.infer<typeof taxCalculationTypeSchema>;
export type TaxRateStatusDTO = z.infer<typeof taxRateStatusSchema>;
export type EtaVatSubTypeDTO = z.infer<typeof etaVatSubTypeSchema>;
export type TaxRateDTO = z.infer<typeof taxRateSchema>;
export type CreateTaxRateDTO = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateDTO = z.infer<typeof updateTaxRateSchema>;

// --- مجموعات الضرائب (R6.4) ----------------------------------------------

export const taxGroupMemberSchema = z.object({
  taxRateId: z.string().min(1),
  /** Charge on the base plus everything before it, not on the base alone. */
  compounding: z.boolean().default(false),
});

export const upsertTaxGroupSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  members: z.array(taxGroupMemberSchema).min(1),
  status: z.enum(["active", "inactive"]).optional(),
});

export const taxGroupComponentSchema = z.object({
  taxRateId: z.string(),
  ratePercent: z.number(),
  compounding: z.boolean(),
  effectivePercent: z.number(),
});

export const taxGroupSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  members: z.array(taxGroupMemberSchema),
  status: z.enum(["active", "inactive"]),
  /** What the group actually charges, member by member — never one melted total. */
  components: z.array(taxGroupComponentSchema),
  effectivePercent: z.number(),
});

export type TaxGroupMemberDTO = z.infer<typeof taxGroupMemberSchema>;
export type UpsertTaxGroupDTO = z.infer<typeof upsertTaxGroupSchema>;
export type TaxGroupComponentDTO = z.infer<typeof taxGroupComponentSchema>;
export type TaxGroupDTO = z.infer<typeof taxGroupSchema>;
