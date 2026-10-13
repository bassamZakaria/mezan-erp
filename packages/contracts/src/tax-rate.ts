import { z } from "zod";

// INVARIANT: the ONE listing of these closed sets. `@mezan/domain` imports
// the enums from here — this package is the leaf every client depends on, so
// the wire schema and the domain cannot drift apart.
export enum TaxCalculationTypeCode {
  Exclusive = "exclusive",
  Inclusive = "inclusive",
}

export enum TaxRateStatusCode {
  Active = "active",
  Inactive = "inactive",
}

/**
 * Egyptian ETA e-invoice VAT sub-type codes (docs/archive/catalog/04's "الضرائب"
 * section transcribes V001–V009 from the tax dialog's helper text). "auto"
 * mirrors the mockup's default option — "تلقائي (أساسي عند وجود ضريبة، غير
 * خاضع عند 0%)" — which lets the invoicing engine pick V009 (basic sales) or
 * V004 (not subject) itself based on the line's rate at submission time.
 */
export enum EtaVatSubTypeCode {
  Auto = "auto",
  ExportGoods = "V001",
  ExportServices = "V002",
  Exempt = "V003",
  NotSubject = "V004",
  V005 = "V005",
  V006 = "V006",
  V007 = "V007",
  V008 = "V008",
  BasicSales = "V009",
}

// EXTERNAL CONTRACT: the wire carries these as plain strings, so each schema
// infers the enum's own VALUES — derived from it, never listed a second time.
function valuesOf<Value extends string>(members: Readonly<Record<string, Value>>): [`${Value}`, ...`${Value}`[]] {
  const [first, ...rest] = Object.values(members) as `${Value}`[];
  if (first === undefined) throw new RangeError("an enum with no members has no wire values");
  return [first, ...rest];
}

/** Wire contract for tax rates (docs/archive/catalog/04 "الضرائب"). */
export const taxCalculationTypeSchema = z.enum(valuesOf(TaxCalculationTypeCode));
export const taxRateStatusSchema = z.enum(valuesOf(TaxRateStatusCode));
export const etaVatSubTypeSchema = z.enum(valuesOf(EtaVatSubTypeCode));

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

/**
 * POST /sales-invoices/:id/lines/:lineId/classify-tax and its purchase twin —
 * names the tax rate of a POSTED line that stored none. `withLineIds` names
 * the document's other unnamed lines at the same percent: they share a journal
 * line with it and are classified together, never implicitly.
 */
export const classifyLineTaxSchema = z.object({
  taxRateId: z.string().min(1),
  withLineIds: z.array(z.string().min(1)).max(500).optional(),
});

/**
 * تسمية ضريبة سطر القيد — the entry's lines, by their position in the entry,
 * that carry the tax of one document line. `taxRateId` is required only when
 * the document line names no rate yet.
 */
export const nameJournalLineTaxSchema = z.object({
  journalLineIndexes: z.array(z.number().int().nonnegative()).min(1).max(500),
  taxRateId: z.string().min(1).optional(),
  withLineIds: z.array(z.string().min(1)).max(500).optional(),
});
export type NameJournalLineTaxDTO = z.infer<typeof nameJournalLineTaxSchema>;

export enum TaxClassificationFilingOutcomeCode {
  NotQueued = "not_queued",
  Requeued = "requeued",
  FiledConsistent = "filed_consistent",
  Issued = "issued",
  Reissued = "reissued",
  ReissuePending = "reissue_pending",
  ReissueRefused = "reissue_refused",
  ReissueFailed = "reissue_failed",
}

export const lineTaxClassificationSchema = z.object({
  documentId: z.string().min(1),
  documentNumber: z.string().nullable(),
  lineIds: z.array(z.string()),
  taxRateId: z.string().min(1),
  taxRateName: z.string(),
  taxRatePercent: z.number(),
  journalLinesNamed: z.number().int().nonnegative(),
  filing: z.nativeEnum(TaxClassificationFilingOutcomeCode),
  filingMessage: z.string().optional(),
});

export const etaReceiptRetrySchema = z.object({
  documentId: z.string().min(1),
  filing: z.nativeEnum(TaxClassificationFilingOutcomeCode).nullable(),
  filingMessage: z.string().optional(),
});
export type EtaReceiptRetryDTO = z.infer<typeof etaReceiptRetrySchema>;

export type ClassifyLineTaxDTO = z.infer<typeof classifyLineTaxSchema>;
export type LineTaxClassificationDTO = z.infer<typeof lineTaxClassificationSchema>;
