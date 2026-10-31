import { z } from "zod";
import { scopeSelectionSchema } from "./roles.js";
import { companyNameSchema } from "./company-name.js";

/**
 * Email + password sign-in on every edition. `POST /auth/login`
 * verifies the password against the persisted user's hash and returns the
 * resolved session the web client turns into the permission-gate headers
 * (`x-user-id`, `x-permissions`, `x-branch-scope`, `x-warehouse-scope`) it
 * sends on every subsequent API call.
 */
export const DEVICE_BINDING_HEADER = "x-mezan-device-binding";
export const DEVICE_SECRET_HEADER = "x-mezan-device";

export enum DeviceBinding {
  Header = "1",
  Cookie = "cookie",
}

// CONTRACT: the cloud edge sets these readable cookies beside the HttpOnly
// session cookie; a browser client echoes the value in CSRF_HEADER on every
// request it sends with that session.
export const CSRF_HEADER = "x-mezan-csrf";

export enum CsrfCookie {
  Tenant = "mezan_csrf",
  Platform = "mezan_platform_csrf",
}

// CONTRACT: a wrong CURRENT password from a signed-in caller (password change,
// email change, step-up) answers 403 with this. 401 is kept for "this session
// is gone": the clients sign out on it.
export enum CurrentSecretRefusal {
  IncorrectPassword = "INCORRECT_PASSWORD",
}

// CONTRACT: a session whose user still holds an admin-issued temporary password
// answers 403 with this on every route but the password change, sign-out and
// session read; the client then shows the change-password screen.
export enum PasswordChangeRefusal {
  Required = "PASSWORD_CHANGE_REQUIRED",
}

/** Accepted at sign-in and step-up. Only a NEW password is held to the 8-character policy, so a legacy 6-digit one still signs in once to be replaced. */
export const signInPasswordSchema = z.string().min(1).max(256);

// CONTRACT: a browser whose session cookie was issued by one tenant and whose
// request names another answers 403 with this code; the cookie is neither
// presented to that tenant nor expired, so the session it belongs to lives on.
export enum SessionRefusal {
  TenantMismatch = "SESSION_TENANT_MISMATCH",
}

export const stepUpRequestSchema = z.object({ password: signInPasswordSchema });
export type StepUpRequestDTO = z.infer<typeof stepUpRequestSchema>;

export const unlockAccountRequestSchema = z.object({
  username: z.string().min(1).max(254),
  code: z.string().min(1).max(64),
});
export type UnlockAccountRequestDTO = z.infer<typeof unlockAccountRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ username: z.string().min(1).max(254) });
export type ForgotPasswordRequestDTO = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(8, "Password must be at least 8 characters").max(256),
});
export type ResetPasswordRequestDTO = z.infer<typeof resetPasswordRequestSchema>;

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
  password: signInPasswordSchema,
});

export const UNDISCLOSED_TENANT_NAME = "Mezan";

/** The authenticated session — identity + effective authority. */
export const sessionSchema = z.object({
  userId: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  email: z.string(),
  isCompanyAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
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
  token: z.string().optional(),
  deviceSecret: z.string().optional(),
});

/** `tenantCode` is set when the cloud found the company from the email; the client sends it on every later request. */
export const loginResponseSchema = sessionSchema.extend({ tenantCode: z.string().optional() });

/** First-run wizard "create admin" step — persists the very first company admin. */
export const bootstrapAdminRequestSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().min(1).nullable().default(null),
  /** The first admin's email — and, from this moment on, their login. */
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(256),
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
  roles: z.number().int().nonnegative().optional(),
});

export type LoginRequestDTO = z.infer<typeof loginRequestSchema>;
export type SessionDTO = z.infer<typeof sessionSchema>;
export type LoginResponseDTO = z.infer<typeof loginResponseSchema>;
export type BootstrapAdminRequestDTO = z.infer<typeof bootstrapAdminRequestSchema>;
export type BootstrapSeedResultDTO = z.infer<typeof bootstrapSeedResultSchema>;
