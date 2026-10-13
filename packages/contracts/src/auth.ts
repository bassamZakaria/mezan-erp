import { z } from "zod";
import { scopeSelectionSchema } from "./roles.js";
import { companyNameSchema } from "./company-name.js";

/**
 * Real desktop login (docs/archive/plan.md — username + PIN). `POST /auth/login`
 * verifies the PIN against the persisted user's hash and returns the
 * resolved session the web client turns into the permission-gate headers
 * (`x-user-id`, `x-permissions`, `x-branch-scope`, `x-warehouse-scope`) it
 * sends on every subsequent API call.
 */
export const DEVICE_BINDING_HEADER = "x-mezan-device-binding";
export const DEVICE_SECRET_HEADER = "x-mezan-device";

export const stepUpRequestSchema = z.object({ pin: z.string().regex(/^\d{6}$/) });
export type StepUpRequestDTO = z.infer<typeof stepUpRequestSchema>;

export const unlockAccountRequestSchema = z.object({
  username: z.string().min(1).max(254),
  code: z.string().min(1).max(64),
});
export type UnlockAccountRequestDTO = z.infer<typeof unlockAccountRequestSchema>;

export const unlockAccountByLinkRequestSchema = z.object({ token: z.string().min(20).max(128) });
export type UnlockAccountByLinkRequestDTO = z.infer<typeof unlockAccountByLinkRequestSchema>;

export const loginRequestSchema = z.object({
  /**
   * The user's EMAIL — never their display name. A display name is neither
   * unique nor stable, so matching it made "who can log in" a property of a
   * field anyone may edit. Named `username` because that is what the field on
   * the login form is called; the value is an address.
   */
  username: z.string().min(1),
  pin: z.string().regex(/^\d{6}$/),
});

export const UNDISCLOSED_TENANT_NAME = "Mezan";

/** The authenticated session — identity + effective authority. */
export const sessionSchema = z.object({
  userId: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  email: z.string(),
  isCompanyAdmin: z.boolean(),
  /** Resolved effective permission codes; `["*"]` for a tenant admin. */
  permissions: z.array(z.string()),
  /**
   * The user's own custom-role code (e.g. `"VAN_SALES"`) — `null` for a
   * company admin, or a user with no role assigned. Distinct from
   * `permissions`: the workflow gate's steps assign an approver ROLE, not a
   * permission code, so `/workflow` routes read this off `x-role-code`
   * (see `authHeaders` in apps/web/src/data/session.ts).
   */
  roleCode: z.string().nullable(),
  /** The user's profile photo, so the device's face row can draw it before the next sign-in. */
  photoUrl: z.string().nullable(),
  branchScope: scopeSelectionSchema,
  warehouseScope: scopeSelectionSchema,
  tenantName: z.string(),
  /**
   * The opaque session token. Every subsequent request carries it, and the
   * server resolves the caller's permissions from ITS copy of the grant — the
   * `permissions` above are for hiding UI the user cannot use, never for
   * deciding what a request is allowed to do.
   */
  token: z.string(),
  deviceSecret: z.string().optional(),
});

export const loginResponseSchema = sessionSchema;

/** First-run wizard "create admin" step — persists the very first company admin. */
export const bootstrapAdminRequestSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1).nullable().default(null),
  /** The first admin's email — and, from this moment on, their login. */
  email: z.string().trim().toLowerCase().email(),
  pin: z.string().regex(/^\d{6}$/),
  companyName: companyNameSchema,
});

/** Result of the idempotent `POST /bootstrap/seed` — what the empty-DB seed created (or found). */
export const bootstrapSeedResultSchema = z.object({
  accounts: z.number().int().nonnegative(),
  taxRates: z.number().int().nonnegative(),
  branches: z.number().int().nonnegative(),
  warehouses: z.number().int().nonnegative(),
  fiscalPeriods: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  /**
   * Whether anybody has claimed this install yet.
   *
   * Optional so the seed result — which answers "what got created" — keeps its
   * old shape; `GET /bootstrap/status` supplies it, and the login screen needs
   * it. A fresh packaged install used to land on a login form with an empty
   * account list, a blank email box and nothing saying the machine had never
   * been set up, while the only account that existed had a random PIN nobody
   * knows. The owner typed their own name, failed five times, and was locked
   * out of a brand-new install inside ninety seconds.
   */
  claimed: z.boolean().optional(),
  demoSeeded: z.boolean().optional(),
});

export type LoginRequestDTO = z.infer<typeof loginRequestSchema>;
export type SessionDTO = z.infer<typeof sessionSchema>;
export type LoginResponseDTO = z.infer<typeof loginResponseSchema>;
export type BootstrapAdminRequestDTO = z.infer<typeof bootstrapAdminRequestSchema>;
export type BootstrapSeedResultDTO = z.infer<typeof bootstrapSeedResultSchema>;
