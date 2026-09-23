import { z } from "zod";

/**
 * Wire/serialization contracts for entitlements and the offline license payload
 * (docs/archive/plan.md §2.5). The entitlements object has the same shape in both
 * editions: the cloud stamps it into the JWT, the desktop reads it from the
 * signed license file. These schemas validate either source before the domain
 * trusts it.
 */

export const featureFlagsSchema = z.record(z.string(), z.boolean());

export const entitlementLimitsSchema = z.object({
  branches: z.number().int().nonnegative(),
  warehouses: z.number().int().nonnegative(),
});

export const entitlementModuleTrialSchema = z.object({
  module: z.string().min(1),
  startedAt: z.string().min(1),
  endsAt: z.string().min(1),
});

export const entitlementsSchema = z.object({
  plan: z.string().min(1),
  activeModules: z.array(z.string().min(1)),
  features: featureFlagsSchema,
  seats: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().nullable(),
  limits: entitlementLimitsSchema.optional(),
  /** DEC-31 — modules the tenant once held: read and export, never write. */
  readOnlyModules: z.array(z.string().min(1)).optional(),
  /** Usage quotas keyed by `QuotaKind`; an absent key is unlimited. */
  quotas: z.record(z.string(), z.number().int().nonnegative()).optional(),
  moduleTrials: z.array(entitlementModuleTrialSchema).optional(),
  planNameAr: z.string().optional(),
  planNameEn: z.string().optional(),
  planKind: z.string().optional(),
  /** When the reverse trial ends; null or absent when the tenant is not on one. */
  trialEndsAt: z.string().nullable().optional(),
});

/** The signed inner payload of a `license.mezan` file. */
export const licensePayloadSchema = z.object({
  v: z.number().int().positive(),
  licenseId: z.string().min(1),
  licensee: z.string().min(1),
  edition: z.string().min(1),
  plan: z.string().min(1),
  activeModules: z.array(z.string().min(1)),
  features: featureFlagsSchema,
  seats: z.number().int().nonnegative(),
  issuedAt: z.string().datetime(),
  notBefore: z.string().datetime(),
  expiresAt: z.string().datetime(),
  graceDays: z.number().int().nonnegative(),
  machineBinding: z.array(z.string()),
  supportUntil: z.string().datetime().optional(),
  updateChannelUntil: z.string().datetime().optional(),
});

export type EntitlementsDTO = z.infer<typeof entitlementsSchema>;
export type EntitlementModuleTrialDTO = z.infer<typeof entitlementModuleTrialSchema>;
export type LicensePayloadDTO = z.infer<typeof licensePayloadSchema>;
