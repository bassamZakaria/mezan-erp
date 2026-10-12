import { z } from "zod";
import { entitlementsSchema } from "./entitlements.js";
import { nonNegativeMoneyString } from "./money-string.js";
import { companyNameSchema } from "./company-name.js";

/**
 * Wire contracts for the platform console
 * (docs/superpowers/specs/2026-09-14-saas-completion-design.md §2). Money
 * crosses the wire as an exact decimal string, never a float — the domain
 * re-parses via `Money.fromMajor`/`Money.toString()`. `@mezan/contracts` has
 * no dependency on `@mezan/domain`, so a module id is validated here as a
 * non-empty string rather than against `MODULE_CATALOG`.
 */

const positiveDecimalString = nonNegativeMoneyString;
/**
 * Rejects "0" and "0.00" via exact bigint digits, never a float — a float
 * equality check would mis-round on the scale-1e-6 boundary. The digit guard
 * runs before `BigInt()` because zod still evaluates `refine` on a value that
 * already failed the regex check above (e.g. "1e3"), and `BigInt` throws on
 * anything that isn't plain digits.
 */
const strictlyPositiveDecimalString = positiveDecimalString.refine((value) => {
  const digits = value.replace(".", "");
  return /^\d+$/.test(digits) && BigInt(digits) > 0n;
}, "must be greater than zero");
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

// Mirrors `TenantStatusCode` in @mezan/domain by hand, because this package cannot import it;
// `apps/server/src/company-name-parity.test.ts` fails when the two disagree.
export enum TenantWireStatus {
  Provisioning = "provisioning",
  Active = "active",
  Suspended = "suspended",
  Archived = "archived",
  /** Never stored: see `SubscriptionStatusCode.Unknown`. */
  Unknown = "unknown",
}

export const tenantStatusSchema = z.nativeEnum(TenantWireStatus);

export function tenantStatusOf(stored: string): TenantWireStatus {
  const parsed = tenantStatusSchema.safeParse(stored);
  return parsed.success ? parsed.data : TenantWireStatus.Unknown;
}

export const pendingOwnerSchema = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
  requestedAt: isoLikeSchema,
  expiresAt: isoLikeSchema,
  linkMailed: z.boolean(),
});

export const ownerCandidateSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string(),
  email: z.string().min(1),
});

export const assignOwnerRequestSchema = z.object({
  userId: z.string().trim().min(1),
});

export const tenantSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  ownerEmail: z.string().min(1),
  ownerContactVerified: z.boolean(),
  ownerNeeded: z.boolean(),
  pendingOwner: pendingOwnerSchema.nullable(),
  status: tenantStatusSchema,
  dbFile: z.string().min(1),
  createdAt: isoLikeSchema,
  updatedAt: isoLikeSchema,
});

/** The one place a stored tenant becomes its wire shape: every route that answers a tenant goes through it. */
export function tenantDTOOf(
  stored: Omit<z.infer<typeof tenantSchema>, "status" | "ownerNeeded" | "pendingOwner"> & {
    readonly status: string;
    readonly ownerNeeded?: boolean;
    readonly pendingOwner?: { readonly userId: string; readonly email: string; readonly requestedAt: string; readonly expiresAt: string; readonly tokenHash: string | null } | null;
  },
): z.infer<typeof tenantSchema> {
  const pending = stored.pendingOwner ?? null;
  return {
    id: stored.id, code: stored.code, nameAr: stored.nameAr, nameEn: stored.nameEn, ownerEmail: stored.ownerEmail,
    ownerContactVerified: stored.ownerContactVerified, ownerNeeded: stored.ownerNeeded === true,
    // SECURITY: the confirmation token's hash never leaves the server.
    pendingOwner: pending
      ? { userId: pending.userId, email: pending.email, requestedAt: pending.requestedAt, expiresAt: pending.expiresAt, linkMailed: pending.tokenHash !== null }
      : null,
    status: tenantStatusOf(stored.status), dbFile: stored.dbFile, createdAt: stored.createdAt, updatedAt: stored.updatedAt,
  };
}

export enum TenantResolveMode {
  Subdomain = "subdomain",
  Code = "code",
}

/** Name-free on purpose: anyone who guesses a tenant code can ask, so it answers only whether that tenant is usable. */
export interface PlatformResolveDTO {
  readonly mode: TenantResolveMode;
  readonly exists: boolean;
}

export const billingCycleSchema = z.enum(["monthly", "yearly"]);

export const createTenantRequestSchema = z.object({
  code: slugSchema,
  nameAr: companyNameSchema,
  nameEn: z.string().min(1).nullable().optional(),
  ownerEmail: emailRequestSchema,
  ownerNameAr: z.string().min(1),
  planId: z.string().min(1),
  billingCycle: billingCycleSchema,
  trial: z.boolean(),
});

export const provisionRetryRequestSchema = z.object({
  planId: z.string().min(1).optional(),
  billingCycle: billingCycleSchema.optional(),
  trial: z.boolean().optional(),
  ownerNameAr: z.string().min(1).optional(),
});

export const provisionResultSchema = z.object({
  tenant: tenantSchema,
  adminEmail: z.string().min(1),
  /** Null on a resumed provision — the admin already exists from an earlier call, and its PIN is not re-issued. */
  adminPin: z.string().regex(/^\d{6}$/, "must be exactly 6 digits").nullable(),
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

/** A subscription-level suspend/resume is a deliberate, audited act — the console requires a reason, not a bare confirm click. */
export const subscriptionSuspendRequestSchema = z.object({
  reason: z.string().trim().min(1),
});

export const subscriptionResumeRequestSchema = z.object({
  reason: z.string().trim().min(1),
});

export const recordPaymentRequestSchema = z.object({
  amount: strictlyPositiveDecimalString,
  reference: z.string().min(1),
  paidAt: z.string().datetime(),
  note: z.string().min(1).nullable().optional(),
});

export const ownerPinResetResultSchema = z.object({
  adminEmail: z.string().min(1),
  signInEmail: z.string().min(1),
  adminPin: z.string().regex(/^\d{6}$/, "must be exactly 6 digits"),
});

export enum SubscriptionStatusCode {
  Trialing = "trialing",
  Active = "active",
  PastDue = "past_due",
  Suspended = "suspended",
  Cancelled = "cancelled",
  /** Never stored: what a read answers for a stored value this build does not recognise, so one odd row cannot fail a whole list. */
  Unknown = "unknown",
}

export const subscriptionStatusSchema = z.nativeEnum(SubscriptionStatusCode);

export function subscriptionStatusOf(stored: string): SubscriptionStatusCode {
  const parsed = subscriptionStatusSchema.safeParse(stored);
  return parsed.success ? parsed.data : SubscriptionStatusCode.Unknown;
}

export const billingAnchorDaySchema = z.number().int().min(1).max(31);

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
  billingAnchorDay: billingAnchorDaySchema,
  billingAnchorNeedsReview: z.boolean(),
  trialEndsAt: isoLikeSchema.nullable(),
  graceDays: z.number().int().nonnegative(),
  cancelledAt: isoLikeSchema.nullable(),
  createdAt: isoLikeSchema,
  updatedAt: isoLikeSchema,
});

export const setBillingAnchorDayRequestSchema = z.object({ day: billingAnchorDaySchema });

/** Mirrors the domain's `PlanKind`; `@mezan/contracts` may not import `@mezan/domain`. */
export const planKindSchema = z.enum(["paid", "free"]);
/** Mirrors the domain's `QuotaKind`. An absent key is unlimited. */
export const quotaKindSchema = z.enum(["sales_invoices_per_month"]);
export const planQuotasSchema = z.record(quotaKindSchema, z.number().int().nonnegative());

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
  kind: planKindSchema,
  quotas: planQuotasSchema,
  priceMonthly: positiveDecimalString,
  priceYearly: positiveDecimalString,
  trialDays: z.number().int().nonnegative(),
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
  status: planStatusSchema,
  createdAt: isoLikeSchema,
});

export const planCreateRequestSchema = z.object({
  code: slugSchema,
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  modules: z.array(moduleIdSchema).min(1),
  features: z.record(z.string(), z.boolean()).optional(),
  seatsIncluded: z.number().int().min(1),
  branchesIncluded: z.number().int().min(1),
  warehousesIncluded: z.number().int().min(1),
  kind: planKindSchema.optional(),
  quotas: planQuotasSchema.optional(),
  priceMonthly: positiveDecimalString,
  priceYearly: positiveDecimalString,
  trialDays: z.number().int().nonnegative(),
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
});

export const planUpdateRequestSchema = planCreateRequestSchema.omit({ code: true });

export const paymentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  subscriptionId: z.string().min(1),
  amount: positiveDecimalString,
  currency: z.literal("EGP"),
  reference: z.string().min(1),
  paidAt: z.string().datetime(),
  recordedBy: z.string().min(1),
  note: z.string().nullable(),
  createdAt: isoLikeSchema,
});

export enum LicenseStateCode {
  Active = "ACTIVE",
  Grace = "GRACE",
  ReadOnly = "READ_ONLY",
  Invalid = "INVALID",
  Unlicensed = "UNLICENSED",
}

export const licenseStateNameSchema = z.nativeEnum(LicenseStateCode);

export const licenseStateReasonSchema = z.enum([
  "TENANT_ARCHIVED",
  "NO_SUBSCRIPTION",
  "TENANT_SUSPENDED",
  "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_SUSPENDED",
  "TRIAL_ENDED",
  "GRACE_ENDED",
  "INVALID_CLOCK",
  "TENANT_NOT_FOUND",
  "STATUS_UNKNOWN",
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
  payments: z.array(paymentSchema),
});

export const cardCheckoutStatusSchema = z.enum(["pending", "paid", "failed", "unapplied"]);

export const cardCheckoutSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  subscriptionId: z.string().min(1),
  provider: z.enum(["paymob", "paymob-test"]),
  testMode: z.boolean(),
  amount: positiveDecimalString,
  currency: z.literal("EGP"),
  status: cardCheckoutStatusSchema,
  checkoutUrl: z.string().nullable(),
  providerRef: z.string().nullable(),
  paymentId: z.string().nullable(),
  failureReason: z.string().nullable(),
  requestedBy: z.string().min(1),
  createdAt: isoLikeSchema,
  updatedAt: isoLikeSchema,
});

/** A same-origin SPA path only — the server prefixes its own trusted origin, so this can never become an open redirect. */
export const createCardCheckoutRequestSchema = z.object({
  returnPath: z.string().regex(/^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/),
});

export const platformCardCheckoutsSchema = z.object({
  cardCheckout: z.boolean(),
  testMode: z.boolean(),
  checkouts: z.array(cardCheckoutSchema),
});

/** How a module stands for this tenant right now (DEC-31 rules 3 and 5). */
export const billingModuleStateSchema = z.enum(["active", "trialing", "read_only", "locked"]);

export const billingModuleSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  state: billingModuleStateSchema,
  /** When a live module trial on this module ends; null when none is running. */
  trialEndsAt: z.string().nullable(),
  /** This tenant has already spent its one trial of this module. */
  trialUsed: z.boolean(),
  canTrial: z.boolean(),
});

export const billingQuotaSchema = z.object({
  kind: quotaKindSchema,
  allowed: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
});

export const billingLimitSchema = z.object({
  limit: z.enum(["seats", "branches", "warehouses"]),
  allowed: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
});

export const billingPlanOfferSchema = planSchema
  .pick({
    id: true, code: true, nameAr: true, nameEn: true, kind: true, modules: true,
    seatsIncluded: true, branchesIncluded: true, warehousesIncluded: true, quotas: true,
    priceMonthly: true, priceYearly: true, trialDays: true,
  })
  .extend({ current: z.boolean() });

export const tenantBillingSchema = z.object({
  cardCheckout: z.boolean(),
  testMode: z.boolean(),
  canRenew: z.boolean(),
  subscription: z
    .object({
      status: subscriptionStatusSchema,
      billingCycle: billingCycleSchema,
      currentPeriodEnd: z.string(),
      planNameAr: z.string(),
      planNameEn: z.string(),
      amountDue: z.string(),
      planKind: planKindSchema,
    })
    .nullable(),
  /** The tenant's own calendar day and month — every days-left and quota figure is read on these. */
  today: z.string().nullable(),
  month: z.string().nullable(),
  /** The reverse trial's end, and how many of the tenant's own days are left. */
  trialEndsAt: z.string().nullable(),
  trialDaysLeft: z.number().int().nullable(),
  moduleTrialDays: z.number().int().nonnegative(),
  quotas: z.array(billingQuotaSchema),
  limits: z.array(billingLimitSchema),
  modules: z.array(billingModuleSchema),
  plans: z.array(billingPlanOfferSchema),
  checkouts: z.array(cardCheckoutSchema),
});

export const startModuleTrialRequestSchema = z.object({ module: z.string().min(1) });

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
export type ProvisionRetryRequestDTO = z.infer<typeof provisionRetryRequestSchema>;
export type ProvisionResultDTO = z.infer<typeof provisionResultSchema>;
export type OwnerPinResetResultDTO = z.infer<typeof ownerPinResetResultSchema>;
export type OwnerCandidateDTO = z.infer<typeof ownerCandidateSchema>;
export type AssignOwnerRequestDTO = z.infer<typeof assignOwnerRequestSchema>;
export type PendingOwnerDTO = z.infer<typeof pendingOwnerSchema>;
export type StartSubscriptionRequestDTO = z.infer<typeof startSubscriptionRequestSchema>;
export type ChangePlanRequestDTO = z.infer<typeof changePlanRequestSchema>;
export type SubscriptionSuspendRequestDTO = z.infer<typeof subscriptionSuspendRequestSchema>;
export type SubscriptionResumeRequestDTO = z.infer<typeof subscriptionResumeRequestSchema>;
export type RecordPaymentRequestDTO = z.infer<typeof recordPaymentRequestSchema>;
export type SubscriptionStatusDTO = z.infer<typeof subscriptionStatusSchema>;
export type SetBillingAnchorDayRequestDTO = z.infer<typeof setBillingAnchorDayRequestSchema>;
export type SubscriptionDTO = z.infer<typeof subscriptionSchema>;
export type PlanStatusDTO = z.infer<typeof planStatusSchema>;
export type PlanKindDTO = z.infer<typeof planKindSchema>;
export type QuotaKindDTO = z.infer<typeof quotaKindSchema>;
export type PlanQuotasDTO = z.infer<typeof planQuotasSchema>;
export type PlanDTO = z.infer<typeof planSchema>;
export type PlanCreateRequestDTO = z.infer<typeof planCreateRequestSchema>;
export type PlanUpdateRequestDTO = z.infer<typeof planUpdateRequestSchema>;
export type PaymentDTO = z.infer<typeof paymentSchema>;
export type LicenseStateNameDTO = z.infer<typeof licenseStateNameSchema>;
export type LicenseStateReasonDTO = z.infer<typeof licenseStateReasonSchema>;
export type LicenseStateViewDTO = z.infer<typeof licenseStateViewSchema>;
export type TenantSummaryDTO = z.infer<typeof tenantSummarySchema>;
export type CardCheckoutStatusDTO = z.infer<typeof cardCheckoutStatusSchema>;
export type CardCheckoutDTO = z.infer<typeof cardCheckoutSchema>;
export type CreateCardCheckoutRequestDTO = z.infer<typeof createCardCheckoutRequestSchema>;
export type TenantBillingDTO = z.infer<typeof tenantBillingSchema>;
export type BillingModuleStateDTO = z.infer<typeof billingModuleStateSchema>;
export type BillingModuleDTO = z.infer<typeof billingModuleSchema>;
export type BillingQuotaDTO = z.infer<typeof billingQuotaSchema>;
export type BillingLimitDTO = z.infer<typeof billingLimitSchema>;
export type BillingPlanOfferDTO = z.infer<typeof billingPlanOfferSchema>;
export type StartModuleTrialRequestDTO = z.infer<typeof startModuleTrialRequestSchema>;
export type PlatformCardCheckoutsDTO = z.infer<typeof platformCardCheckoutsSchema>;
