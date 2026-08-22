import { z } from "zod";

/** Wire contracts for ETA e-invoicing (docs/catalog/04 "الفاتورة الإلكترونية"). */
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
});

export const etaReadinessSchema = z.object({
  percent: z.number(),
  items: z.array(z.object({ key: z.string(), labelAr: z.string(), complete: z.boolean() })),
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
});

export const excludeEtaSubmissionSchema = z.object({ reason: z.string().min(1) });

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
