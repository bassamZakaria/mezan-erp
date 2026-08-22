import { z } from "zod";

/** Wire contract for tax rates (docs/catalog/04 "الضرائب"). */
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
