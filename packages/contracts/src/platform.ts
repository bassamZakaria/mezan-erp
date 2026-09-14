import { z } from "zod";
import { entitlementsSchema } from "./entitlements.js";

/**
 * Wire contracts for the platform console
 * (docs/superpowers/specs/2026-09-14-saas-completion-design.md §2). Money
 * crosses the wire as an exact decimal string, never a float — the domain
 * re-parses via `Money.fromMajor`/`Money.toString()`. `@mezan/contracts` has
 * no dependency on `@mezan/domain`, so a module id is validated here as a
 * non-empty string rather than against `MODULE_CATALOG`.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be an exact decimal string");
const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");
const slugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, "must be a lower-case slug");
const moduleIdSchema = z.string().min(1);
const isoLikeSchema = z.string().min(1);
const emailRequestSchema = z.string().trim().toLowerCase().email();

export const platformRoleSchema = z.enum(["owner", "support"]);
export const platformUserStatusSchema = z.enum(["active", "inactive"]);

export const platformLoginRequestSchema = z.object({
  email: emailRequestSchema,
  password: z.string().min(1),
});

export const platformSessionSchema = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    role: platformRoleSchema,
  }),
});

export const platformUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: platformRoleSchema,
  status: platformUserStatusSchema,
  createdAt: isoLikeSchema,
});

export const createPlatformUserRequestSchema = z.object({
  email: emailRequestSchema,
  password: z.string().min(12),
  role: platformRoleSchema,
});

export const tenantStatusSchema = z.enum(["provisioning", "active", "suspended", "archived"]);

export const tenantSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  ownerEmail: z.string().min(1),
  status: tenantStatusSchema,
  dbFile: z.string().min(1),
  createdAt: isoLikeSchema,
  updatedAt: isoLikeSchema,
});

export const billingCycleSchema = z.enum(["monthly", "yearly"]);

export const createTenantRequestSchema = z.object({
  code: slugSchema,
  nameAr: z.string().min(1),
  nameEn: z.string().min(1).nullable().optional(),
  ownerEmail: emailRequestSchema,
  ownerNameAr: z.string().min(1),
  planId: z.string().min(1),
  billingCycle: billingCycleSchema,
  trial: z.boolean(),
});

export const provisionResultSchema = z.object({
  tenant: tenantSchema,
  adminEmail: z.string().min(1),
  adminPin: z.string().regex(/^\d{6}$/, "must be exactly 6 digits"),
});

export const startSubscriptionRequestSchema = z.object({
  planId: z.string().min(1),
  billingCycle: billingCycleSchema,
  trial: z.boolean().optional(),
  addOnModules: z.array(moduleIdSchema).optional(),
  extraSeats: z.number().int().nonnegative().optional(),
  extraBranches: z.number().int().nonnegative().optional(),
  extraWarehouses: z.number().int().nonnegative().optional(),
  graceDays: z.number().int().nonnegative().optional(),
});

export const changePlanRequestSchema = z.object({
  planId: z.string().min(1),
});

export const recordPaymentRequestSchema = z.object({
  amount: positiveDecimalString,
  reference: z.string().min(1),
  paidAt: isoLikeSchema,
  note: z.string().min(1).nullable().optional(),
});

export const subscriptionStatusSchema = z.enum(["trialing", "active", "past_due", "suspended", "cancelled"]);

export const subscriptionSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  planId: z.string().min(1),
  status: subscriptionStatusSchema,
  billingCycle: billingCycleSchema,
  addOnModules: z.array(moduleIdSchema),
  extraSeats: z.number().int().nonnegative(),
  extraBranches: z.number().int().nonnegative(),
  extraWarehouses: z.number().int().nonnegative(),
  currentPeriodStart: isoLikeSchema,
  currentPeriodEnd: isoLikeSchema,
  trialEndsAt: isoLikeSchema.nullable(),
  graceDays: z.number().int().nonnegative(),
  cancelledAt: isoLikeSchema.nullable(),
  createdAt: isoLikeSchema,
  updatedAt: isoLikeSchema,
});

export const planStatusSchema = z.enum(["active", "retired"]);

export const planSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  modules: z.array(moduleIdSchema),
  features: z.record(z.string(), z.boolean()),
  seatsIncluded: z.number().int().min(1),
  branchesIncluded: z.number().int().min(1),
  warehousesIncluded: z.number().int().min(1),
  priceMonthly: positiveDecimalString,
  priceYearly: positiveDecimalString,
  trialDays: z.number().int().nonnegative(),
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
  status: planStatusSchema,
  createdAt: isoLikeSchema,
});

export const planUpsertRequestSchema = z.object({
  code: slugSchema,
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  modules: z.array(moduleIdSchema).min(1),
  features: z.record(z.string(), z.boolean()).optional(),
  seatsIncluded: z.number().int().min(1),
  branchesIncluded: z.number().int().min(1),
  warehousesIncluded: z.number().int().min(1),
  priceMonthly: positiveDecimalString,
  priceYearly: positiveDecimalString,
  trialDays: z.number().int().nonnegative(),
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
});

export const paymentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  subscriptionId: z.string().min(1),
  amount: decimalString,
  currency: z.literal("EGP"),
  reference: z.string().min(1),
  paidAt: isoLikeSchema,
  recordedBy: z.string().min(1),
  note: z.string().nullable(),
  createdAt: isoLikeSchema,
});

export const licenseStateNameSchema = z.enum(["ACTIVE", "GRACE", "READ_ONLY", "INVALID", "UNLICENSED"]);

export const licenseStateReasonSchema = z.enum([
  "TENANT_ARCHIVED",
  "NO_SUBSCRIPTION",
  "TENANT_SUSPENDED",
  "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_SUSPENDED",
  "TRIAL_ENDED",
  "GRACE_ENDED",
  "INVALID_CLOCK",
]);

export const licenseStateViewSchema = z.object({
  state: licenseStateNameSchema,
  canWrite: z.boolean(),
  usable: z.boolean(),
  licensee: z.string().optional(),
  expiresAt: z.string().optional(),
  graceEndsAt: z.string().optional(),
  reason: licenseStateReasonSchema.optional(),
});

export const tenantSummarySchema = z.object({
  tenant: tenantSchema,
  subscription: subscriptionSchema.nullable(),
  plan: planSchema.nullable(),
  licenseState: licenseStateViewSchema,
  entitlements: entitlementsSchema.nullable(),
});

export type PlatformRoleDTO = z.infer<typeof platformRoleSchema>;
export type PlatformUserStatusDTO = z.infer<typeof platformUserStatusSchema>;
export type PlatformLoginRequestDTO = z.infer<typeof platformLoginRequestSchema>;
export type PlatformSessionDTO = z.infer<typeof platformSessionSchema>;
export type PlatformUserDTO = z.infer<typeof platformUserSchema>;
export type CreatePlatformUserRequestDTO = z.infer<typeof createPlatformUserRequestSchema>;
export type TenantStatusDTO = z.infer<typeof tenantStatusSchema>;
export type TenantDTO = z.infer<typeof tenantSchema>;
export type BillingCycleDTO = z.infer<typeof billingCycleSchema>;
export type CreateTenantRequestDTO = z.infer<typeof createTenantRequestSchema>;
export type ProvisionResultDTO = z.infer<typeof provisionResultSchema>;
export type StartSubscriptionRequestDTO = z.infer<typeof startSubscriptionRequestSchema>;
export type ChangePlanRequestDTO = z.infer<typeof changePlanRequestSchema>;
export type RecordPaymentRequestDTO = z.infer<typeof recordPaymentRequestSchema>;
export type SubscriptionStatusDTO = z.infer<typeof subscriptionStatusSchema>;
export type SubscriptionDTO = z.infer<typeof subscriptionSchema>;
export type PlanStatusDTO = z.infer<typeof planStatusSchema>;
export type PlanDTO = z.infer<typeof planSchema>;
export type PlanUpsertRequestDTO = z.infer<typeof planUpsertRequestSchema>;
export type PaymentDTO = z.infer<typeof paymentSchema>;
export type LicenseStateNameDTO = z.infer<typeof licenseStateNameSchema>;
export type LicenseStateReasonDTO = z.infer<typeof licenseStateReasonSchema>;
export type LicenseStateViewDTO = z.infer<typeof licenseStateViewSchema>;
export type TenantSummaryDTO = z.infer<typeof tenantSummarySchema>;
