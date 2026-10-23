import { z } from "zod";
import { billingCycleSchema, planSchema, provisionResultSchema } from "./platform.js";
import { companyNameSchema } from "./company-name.js";

/**
 * Wire contracts for the public self-serve signup flow
 * (`apps/server/src/signup-routes.ts`, `web/src/signup/*`). Unlike the rest of
 * `platform.ts` these routes carry NO session — anyone on the internet can
 * call them — so every response here is deliberately thin: a public plan
 * never carries `features`/`status`, and the plan itself is filtered to
 * `isPublic && status === "active"` before it ever reaches this shape.
 */

const slugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, "must be a lower-case slug");
const emailRequestSchema = z.string().trim().toLowerCase().email();

/** What a visitor is allowed to know about a plan before signing up — no `features`, no `sortOrder`/`createdAt` internals. */
export const publicPlanSchema = planSchema.pick({
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  kind: true,
  modules: true,
  seatsIncluded: true,
  branchesIncluded: true,
  warehousesIncluded: true,
  quotas: true,
  priceMonthly: true,
  priceYearly: true,
  trialDays: true,
  soldOut: true,
});

export const signupCheckCodeResponseSchema = z.object({
  available: z.boolean(),
});

/**
 * `website` is a honeypot: a hidden field real browsers never fill in. A
 * request that arrives with it non-empty is silently accepted and dropped —
 * see `signup-routes.ts` — never rejected, so a bot never learns it tripped
 * anything.
 */
export const startSignupRequestSchema = z.object({
  code: slugSchema,
  nameAr: companyNameSchema,
  nameEn: z.string().trim().min(1).nullable().optional(),
  ownerEmail: emailRequestSchema,
  ownerNameAr: z.string().trim().min(1),
  planId: z.string().min(1),
  billingCycle: billingCycleSchema,
  website: z.string().optional(),
});

export const startSignupResultSchema = z.object({
  /** Set only when no platform SMTP is configured — dev mode, shown on screen and clearly labelled. */
  devVerifyUrl: z.string().nullable(),
});

export const verifySignupRequestSchema = z.object({
  token: z.string().min(20),
});

export const verifySignupResultSchema = provisionResultSchema.extend({
  /** True when this token had already been consumed (e.g. a mail scanner's prefetch beat the real click) — the tenant still exists, just with no fresh PIN to show. */
  alreadyVerified: z.boolean(),
});

export type PublicPlanDTO = z.infer<typeof publicPlanSchema>;
export type SignupCheckCodeResponseDTO = z.infer<typeof signupCheckCodeResponseSchema>;
export type StartSignupRequestDTO = z.infer<typeof startSignupRequestSchema>;
export type StartSignupResultDTO = z.infer<typeof startSignupResultSchema>;
export type VerifySignupRequestDTO = z.infer<typeof verifySignupRequestSchema>;
export type VerifySignupResultDTO = z.infer<typeof verifySignupResultSchema>;

// CONTRACT: the cloud server stamps this meta tag into index.html and the web app reads it to open the public landing page at `/`.
export const CLOUD_SITE_META = { name: "mezan-site", content: "cloud" } as const;

/** Mirrors `SignupMode` in `packages/domain/src/platform/signup.ts`; `@mezan/contracts` may not import `@mezan/domain`. */
export enum SignupModeCode {
  Open = "open",
  Approval = "approval",
  Closed = "closed",
}

export const signupModeSchema = z.nativeEnum(SignupModeCode);

export const signupStatusSchema = z.object({
  mode: signupModeSchema,
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable(), whatsapp: z.string().nullable() }),
});

export const setSignupModeRequestSchema = z.object({ mode: signupModeSchema });

export const signupModeResponseSchema = z.object({ mode: signupModeSchema });

export enum SignupRefusalCode {
  Closed = "SIGNUP_CLOSED",
  AwaitingApproval = "SIGNUP_AWAITING_APPROVAL",
}

/** A verified sign-up waiting for the platform owner, as the console lists it. */
export const signupRequestSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  ownerEmail: z.string().min(1),
  ownerNameAr: z.string().min(1),
  intendedPlanId: z.string().nullable(),
  billingCycle: billingCycleSchema,
  createdAt: z.string().min(1),
  verifiedAt: z.string().nullable(),
});

export const approveSignupRequestSchema = z.object({
  planId: z.string().min(1),
  billingCycle: billingCycleSchema,
  trial: z.boolean(),
});

export type SignupStatusDTO = z.infer<typeof signupStatusSchema>;
export type SetSignupModeRequestDTO = z.infer<typeof setSignupModeRequestSchema>;
export type SignupModeResponseDTO = z.infer<typeof signupModeResponseSchema>;
export type SignupRequestDTO = z.infer<typeof signupRequestSchema>;
export type ApproveSignupRequestDTO = z.infer<typeof approveSignupRequestSchema>;
