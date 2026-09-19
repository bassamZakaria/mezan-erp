import { z } from "zod";

/** Wire contracts for ETA e-invoicing (docs/archive/catalog/04 "الفاتورة الإلكترونية"). */
export const etaEnvironmentSchema = z.enum(["preproduction", "production"]);
export const etaDocumentVersionSchema = z.enum(["0.9", "1.0"]);
export const etaSigningMethodSchema = z.enum(["none", "eseal"]);
export const etaDocumentTypeSchema = z.enum(["invoice", "credit_note", "debit_note", "receipt"]);
export const etaSubmissionStatusSchema = z.enum([
  "ready",
  "pending_signature",
  "submitted",
  "accepted",
  "error",
  "excluded",
]);

export const etaCompanyAddressSchema = z.object({
  governorate: z.string(),
  city: z.string(),
  street: z.string(),
  buildingNumber: z.string(),
  postalCode: z.string().nullable(),
});

/** Config as returned (the client secret is never included — only `hasClientSecret`). */
export const etaConfigSchema = z.object({
  environment: etaEnvironmentSchema,
  taxRegistrationNumber: z.string().nullable(),
  activityCode: z.string().nullable(),
  address: etaCompanyAddressSchema.nullable(),
  buyerDataThreshold: z.number(),
  documentVersion: etaDocumentVersionSchema,
  autoSubmitOnConfirm: z.boolean(),
  signingMethod: etaSigningMethodSchema,
  clientId: z.string().nullable(),
  hasClientSecret: z.boolean(),
  preproductionIdentityUrl: z.string(),
  preproductionApiUrl: z.string(),
  productionIdentityUrl: z.string(),
  productionApiUrl: z.string(),
  signingCommand: z.string().nullable(),
  signingCommandArgs: z.array(z.string()),
  receiptReportingWindowHours: z.number().int().positive(),
});

/** Config update — `clientSecret` (plain) is accepted here but never returned. */
export const updateEtaConfigSchema = z.object({
  environment: etaEnvironmentSchema.optional(),
  taxRegistrationNumber: z.string().nullable().optional(),
  activityCode: z.string().nullable().optional(),
  address: etaCompanyAddressSchema.nullable().optional(),
  buyerDataThreshold: z.number().optional(),
  documentVersion: etaDocumentVersionSchema.optional(),
  autoSubmitOnConfirm: z.boolean().optional(),
  signingMethod: etaSigningMethodSchema.optional(),
  clientId: z.string().nullable().optional(),
  clientSecret: z.string().optional(),
  preproductionIdentityUrl: z.string().url().optional(),
  preproductionApiUrl: z.string().url().optional(),
  productionIdentityUrl: z.string().url().optional(),
  productionApiUrl: z.string().url().optional(),
  signingCommand: z.string().nullable().optional(),
  signingCommandArgs: z.array(z.string()).optional(),
  receiptReportingWindowHours: z.number().int().positive().optional(),
});

export const etaReadinessSchema = z.object({
  percent: z.number(),
  items: z.array(
    z.object({ key: z.string(), labelAr: z.string(), complete: z.boolean(), missing: z.number() }),
  ),
});

/** ENH-011b — the closed value sets `packages/domain/src/eta/prevalidate.ts` defines as TS enums. */
export const etaPrevalidationSeveritySchema = z.enum(["warning", "blocking"]);
export const etaPrevalidationRuleCodeSchema = z.enum([
  "ISSUER_TAX_REGISTRATION_INVALID",
  "ISSUER_ACTIVITY_CODE_MISSING",
  "ISSUER_ADDRESS_MISSING",
  "BRANCH_CODE_MISSING",
  "ITEM_CODE_MISSING",
  "UNIT_NOT_MAPPED",
  "TAX_SUBTYPE_NOT_MAPPED",
  "BUYER_TIN_MISSING",
  "BUYER_NATIONAL_ID_REQUIRED",
  "TOTALS_MISMATCH",
]);
export const etaPrevalidationFixScreenSchema = z.enum([
  "issuer_config",
  "branch_codes",
  "item_mapping",
  "unit_mapping",
  "tax_rates",
  "customer",
  "source_document",
]);

export const etaPrevalidationFindingSchema = z.object({
  code: etaPrevalidationRuleCodeSchema,
  severity: etaPrevalidationSeveritySchema,
  messageAr: z.string(),
  messageEn: z.string(),
  fixHintAr: z.string(),
  fixHintEn: z.string(),
  fixScreen: etaPrevalidationFixScreenSchema,
  fixRefId: z.string().nullable().optional(),
});

export const etaSubmissionSchema = z.object({
  id: z.string(),
  internalId: z.string(),
  documentType: etaDocumentTypeSchema,
  status: etaSubmissionStatusSchema,
  etaUuid: z.string().nullable(),
  errors: z.array(z.string()),
  rejectionCodes: z.array(z.string().nullable()).optional(),
  exclusionReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable(),
  gatewaySubmissionId: z.string().nullable(),
  signed: z.boolean(),
  prevalidation: z.array(etaPrevalidationFindingSchema).optional(),
  hasBlockingFindings: z.boolean().optional(),
});

export const bulkRequeueSubmitSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

export const bulkRequeueSubmitResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      outcome: z.enum(["submitted", "queued", "blocked", "not_available", "error"]),
      submission: etaSubmissionSchema.optional(),
      message: z.string().optional(),
    }),
  ),
});

export const etaRejectionReasonGroupSchema = z.object({
  code: z.string(),
  count: z.number(),
  sampleMessage: z.string(),
  exampleInternalIds: z.array(z.string()),
});

export const etaRejectionsReportSchema = z.object({
  totalRejected: z.number(),
  groups: z.array(etaRejectionReasonGroupSchema),
});

/** One request/response of one transmit attempt. Secrets are redacted upstream. */
export const etaTransmitLogEntrySchema = z.object({
  at: z.string(),
  attempt: z.number(),
  method: z.string(),
  url: z.string(),
  requestBody: z.string().nullable(),
  status: z.number().nullable(),
  responseBody: z.string(),
  error: z.string().nullable(),
});

export const etaConnectionCheckSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(["connected", "missing_credentials", "rejected", "unreachable"]),
  detail: z.string().nullable(),
  identityUrl: z.string(),
  checkedAt: z.string(),
});

export const excludeEtaSubmissionSchema = z.object({ reason: z.string().min(1) });

export const etaActivityCodeSchema = z.object({
  code: z.string(),
  labelAr: z.string(),
  labelEn: z.string(),
});

export const etaTestConnectionResultSchema = etaConnectionCheckSchema;

export const etaBranchCodeRowSchema = z.object({
  branchId: z.string(),
  branchCode: z.string(),
  branchName: z.string(),
  etaBranchCode: z.string().nullable(),
  /** الرقم التسلسلي لجهاز نقطة البيع المسجَّل لهذا الفرع. */
  deviceSerialNumber: z.string().nullable(),
  posClientId: z.string().nullable(),
  /** The per-device secret is never returned — only whether one is on file. */
  hasPosClientSecret: z.boolean(),
  /** `pososversion` — the device's OS version as registered with the authority. */
  posOsVersion: z.string().nullable().optional(),
  /** `posmodelframework` — the device's model framework number as registered. */
  posModelFramework: z.string().nullable().optional(),
  /** The pre-shared key is never returned — only whether one is on file. */
  hasPosPresharedKey: z.boolean().optional(),
});

export const updateEtaBranchCodeSchema = z.object({
  etaBranchCode: z.string().min(1),
  deviceSerialNumber: z.string().nullable().optional(),
  posClientId: z.string().nullable().optional(),
  posClientSecret: z.string().optional(),
  posOsVersion: z.string().max(50).nullable().optional(),
  posModelFramework: z.string().max(10).nullable().optional(),
  posPresharedKey: z.string().max(200).optional(),
});

export const etaItemMappingRowSchema = z.object({
  itemId: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  etaCodeType: z.enum(["EGS", "GPC"]).nullable(),
  etaItemCode: z.string().nullable(),
  gpcCode: z.string().nullable(),
});

export const updateEtaItemMappingSchema = z.object({
  etaCodeType: z.enum(["EGS", "GPC"]).nullable().optional(),
  etaItemCode: z.string().nullable().optional(),
  gpcCode: z.string().nullable().optional(),
});

export const etaUnitCodeSchema = z.object({
  code: z.string(),
  labelAr: z.string(),
  labelEn: z.string(),
});

export const etaUnitMappingRowSchema = z.object({
  unitCode: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  etaUnitCode: z.string().nullable(),
  suggestion: z.string().nullable(),
});

export const updateEtaUnitMappingSchema = z.object({ etaUnitCode: z.string().min(1) });

export const applyEtaUnitSuggestionsResultSchema = z.object({
  applied: z.array(etaUnitMappingRowSchema),
  unresolved: z.array(z.string()),
});

export const etaTaxSubTypeRowSchema = z.object({
  taxRateId: z.string(),
  code: z.string(),
  name: z.string(),
  rate: z.number(),
  etaSubType: z.string(),
  resolved: z.boolean(),
});

export type EtaEnvironmentDTO = z.infer<typeof etaEnvironmentSchema>;
export type EtaDocumentVersionDTO = z.infer<typeof etaDocumentVersionSchema>;
export type EtaSigningMethodDTO = z.infer<typeof etaSigningMethodSchema>;
export type EtaDocumentTypeDTO = z.infer<typeof etaDocumentTypeSchema>;
export type EtaSubmissionStatusDTO = z.infer<typeof etaSubmissionStatusSchema>;
export type EtaCompanyAddressDTO = z.infer<typeof etaCompanyAddressSchema>;
export type EtaConfigDTO = z.infer<typeof etaConfigSchema>;
export type UpdateEtaConfigDTO = z.infer<typeof updateEtaConfigSchema>;
export type EtaReadinessDTO = z.infer<typeof etaReadinessSchema>;
export type EtaSubmissionDTO = z.infer<typeof etaSubmissionSchema>;
export type ExcludeEtaSubmissionDTO = z.infer<typeof excludeEtaSubmissionSchema>;
export type EtaActivityCodeDTO = z.infer<typeof etaActivityCodeSchema>;
export type EtaTestConnectionResultDTO = z.infer<typeof etaTestConnectionResultSchema>;
export type EtaTransmitLogEntryDTO = z.infer<typeof etaTransmitLogEntrySchema>;
export type EtaConnectionCheckDTO = z.infer<typeof etaConnectionCheckSchema>;
export type EtaBranchCodeRowDTO = z.infer<typeof etaBranchCodeRowSchema>;
export type UpdateEtaBranchCodeDTO = z.infer<typeof updateEtaBranchCodeSchema>;
export type EtaItemMappingRowDTO = z.infer<typeof etaItemMappingRowSchema>;
export type UpdateEtaItemMappingDTO = z.infer<typeof updateEtaItemMappingSchema>;
export type EtaUnitCodeDTO = z.infer<typeof etaUnitCodeSchema>;
export type EtaUnitMappingRowDTO = z.infer<typeof etaUnitMappingRowSchema>;
export type UpdateEtaUnitMappingDTO = z.infer<typeof updateEtaUnitMappingSchema>;
export type ApplyEtaUnitSuggestionsResultDTO = z.infer<typeof applyEtaUnitSuggestionsResultSchema>;
export type EtaTaxSubTypeRowDTO = z.infer<typeof etaTaxSubTypeRowSchema>;
export type EtaPrevalidationSeverityDTO = z.infer<typeof etaPrevalidationSeveritySchema>;
export type EtaPrevalidationRuleCodeDTO = z.infer<typeof etaPrevalidationRuleCodeSchema>;
export type EtaPrevalidationFixScreenDTO = z.infer<typeof etaPrevalidationFixScreenSchema>;
export type EtaPrevalidationFindingDTO = z.infer<typeof etaPrevalidationFindingSchema>;
export type BulkRequeueSubmitDTO = z.infer<typeof bulkRequeueSubmitSchema>;
export type BulkRequeueSubmitResultDTO = z.infer<typeof bulkRequeueSubmitResultSchema>;
export type EtaRejectionReasonGroupDTO = z.infer<typeof etaRejectionReasonGroupSchema>;
export type EtaRejectionsReportDTO = z.infer<typeof etaRejectionsReportSchema>;
