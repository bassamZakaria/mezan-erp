import { z } from "zod";

/**
 * Wire/serialization contracts for entitlements and the offline license payload
 * (docs/plan.md §2.5). The entitlements object has the same shape in both
 * editions: the cloud stamps it into the JWT, the desktop reads it from the
 * signed license file. These schemas validate either source before the domain
 * trusts it.
 */

export const featureFlagsSchema = z.record(z.string(), z.boolean());

export const entitlementsSchema = z.object({
  plan: z.string().min(1),
  activeModules: z.array(z.string().min(1)),
  features: featureFlagsSchema,
  seats: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().nullable(),
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
export type LicensePayloadDTO = z.infer<typeof licensePayloadSchema>;
