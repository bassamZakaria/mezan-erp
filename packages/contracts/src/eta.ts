import { z } from "zod";

/** Wire contracts for ETA e-invoicing (docs/archive/catalog/04 "الفاتورة الإلكترونية"). */
export const etaEnvironmentSchema = z.enum(["preproduction", "production"]);
export const etaDocumentVersionSchema = z.enum(["0.9", "1.0"]);
export const etaSigningMethodSchema = z.enum(["none", "eseal"]);
export const etaDocumentTypeSchema = z.enum(["invoice", "credit_note", "debit_note"]);
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
});

export const etaReadinessSchema = z.object({
  percent: z.number(),
  items: z.array(
    z.object({ key: z.string(), labelAr: z.string(), complete: z.boolean(), missing: z.number() }),
  ),
});

export const etaSubmissionSchema = z.object({
  id: z.string(),
  internalId: z.string(),
  documentType: etaDocumentTypeSchema,
  status: etaSubmissionStatusSchema,
  etaUuid: z.string().nullable(),
  errors: z.array(z.string()),
  exclusionReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable(),
  gatewaySubmissionId: z.string().nullable(),
  signed: z.boolean(),
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
});

export const updateEtaBranchCodeSchema = z.object({ etaBranchCode: z.string().min(1) });

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
