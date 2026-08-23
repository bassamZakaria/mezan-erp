import { z } from "zod";
import { scopeSelectionSchema } from "./roles.js";

/**
 * Real desktop login (docs/plan.md — username + PIN). `POST /auth/login`
 * verifies the PIN against the persisted user's hash and returns the
 * resolved session the web client turns into the permission-gate headers
 * (`x-user-id`, `x-permissions`, `x-branch-scope`, `x-warehouse-scope`) it
 * sends on every subsequent API call.
 */
export const loginRequestSchema = z.object({
  /** Matched case-insensitively against the user's full name or email. */
  username: z.string().min(1),
  pin: z.string().min(4).max(6),
});

/** The authenticated session — identity + effective authority. */
export const sessionSchema = z.object({
  userId: z.string(),
  fullName: z.string(),
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
  branchScope: scopeSelectionSchema,
  warehouseScope: scopeSelectionSchema,
  tenantName: z.string(),
});

export const loginResponseSchema = sessionSchema;

/** First-run wizard "create admin" step — persists the very first company admin. */
export const bootstrapAdminRequestSchema = z.object({
  fullName: z.string().min(1),
  email: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/),
});

/** Result of the idempotent `POST /bootstrap/seed` — what the empty-DB seed created (or found). */
export const bootstrapSeedResultSchema = z.object({
  accounts: z.number().int().nonnegative(),
  taxRates: z.number().int().nonnegative(),
  branches: z.number().int().nonnegative(),
  warehouses: z.number().int().nonnegative(),
  fiscalPeriods: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
});

export type LoginRequestDTO = z.infer<typeof loginRequestSchema>;
export type SessionDTO = z.infer<typeof sessionSchema>;
export type LoginResponseDTO = z.infer<typeof loginResponseSchema>;
export type BootstrapAdminRequestDTO = z.infer<typeof bootstrapAdminRequestSchema>;
export type BootstrapSeedResultDTO = z.infer<typeof bootstrapSeedResultSchema>;
