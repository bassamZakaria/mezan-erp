import { z } from "zod";
import { scopeSelectionSchema } from "./roles.js";
import { sodAcknowledgeFields } from "./sod.js";

export const userStatusSchema = z.enum(["active", "inactive"]);

/** ~180KB of base64 — a 256px avatar with room to spare, and far below a raw camera JPEG. */
export const PHOTO_MAX_CHARS = 250_000;

/**
 * SIX digits, exactly. A four-digit PIN is 10,000 combinations guarding a
 * ledger — and on this login the PIN is the whole credential, because the
 * device supplies the identity. Six is the shortest code the reviewers would
 * sign off on beside a lockout.
 */
const pinSchema = z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits");

/** The login identifier. Normalised on the wire so the client cannot create a case variant. */
const loginEmailSchema = z.string().trim().toLowerCase().email();

/** Wire shape returned to clients — secrets never cross this boundary. */
export const userSchema = z.object({
  id: z.string().min(1),
  /**
   * TWO NAMES, following `project.ts`: the Arabic one is the record — this is
   * an Arabic-first product and every printed document, approval trail and
   * audit row is read in Arabic — and the English one is optional, for the
   * English UI, a Latin-only report, or a person who signs in Latin script.
   */
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  email: loginEmailSchema,
  phone: z.string().nullable(),
  roleId: z.string().nullable(),
  isCompanyAdmin: z.boolean(),
  employeeId: z.string().nullable(),
  branchScope: scopeSelectionSchema,
  warehouseScope: scopeSelectionSchema,
  status: userStatusSchema,
  hasPin: z.boolean(),
  /** Profile photo as a stored data URL, or null when the user has none. */
  photoUrl: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  /** When the person's data was erased (D348); the row then carries only placeholders. */
  erasedAt: z.string().nullable().optional(),
});

const userBaseFields = {
  nameAr: z.string().min(1),
  nameEn: z.string().min(1).nullable().default(null),
  email: loginEmailSchema,
  phone: z.string().min(1).nullable().default(null),
  roleId: z.string().min(1).nullable(),
  isCompanyAdmin: z.boolean(),
  employeeId: z.string().min(1).nullable().default(null),
  branchScope: scopeSelectionSchema,
  warehouseScope: scopeSelectionSchema,
  status: userStatusSchema.default("active"),
  /**
   * A small square image as a `data:` URL. Bounded on the wire because it goes
   * into the SQLite row itself: the desktop edition has no blob store, and an
   * unbounded string here is how one 4MB camera photo lands in every user list.
   */
  photoUrl: z.string().max(PHOTO_MAX_CHARS).nullable().default(null),
};

export const createUserSchema = z
  .object({
    ...userBaseFields,
    password: z.string().min(8, "Password must be at least 8 characters"),
    pin: pinSchema.nullable().optional(),
    ...sodAcknowledgeFields,
  })
  .refine((v) => v.isCompanyAdmin !== (v.roleId !== null), {
    message: "Provide exactly one of: roleId, or isCompanyAdmin",
    path: ["roleId"],
  });

export const updateUserSchema = z
  .object({
    ...userBaseFields,
    password: z.string().min(8, "Password must be at least 8 characters").optional(),
    pin: pinSchema.nullable().optional(),
    ...sodAcknowledgeFields,
  })
  .refine((v) => v.isCompanyAdmin !== (v.roleId !== null), {
    message: "Provide exactly one of: roleId, or isCompanyAdmin",
    path: ["roleId"],
  });

/** Personal data held for an erased person that the erasure deliberately keeps, and why a lawyer must confirm it. */
export enum ErasureRetention {
  PostedJournalEntries = "posted_journal_entries",
  AuditTrail = "audit_trail",
  ApprovalDecisions = "approval_decisions",
  NamesPrintedOnPostedDocuments = "names_printed_on_posted_documents",
  PayrollRecords = "payroll_records",
  AttendanceHours = "attendance_hours",
}

/**
 * «محو البيانات الشخصية» — the admin types the account's current email to
 * confirm which person is being erased, and records the request it answers.
 */
export const eraseUserSchema = z.object({
  confirmEmail: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const userErasureResultSchema = z.object({
  user: userSchema,
  erased: z.object({
    employee: z.boolean(),
    clockInSelfies: z.number().int().nonnegative(),
    webauthnCredentials: z.number().int().nonnegative(),
    webauthnChallenges: z.number().int().nonnegative(),
    attendanceLocations: z.number().int().nonnegative(),
    sessionsRevoked: z.boolean(),
  }),
  retained: z.array(z.nativeEnum(ErasureRetention)),
});

export type UserDTO = z.infer<typeof userSchema>;
export type EraseUserDTO = z.infer<typeof eraseUserSchema>;
export type UserErasureResultDTO = z.infer<typeof userErasureResultSchema>;
export type UserStatusDTO = z.infer<typeof userStatusSchema>;
export type CreateUserDTO = z.infer<typeof createUserSchema>;
export type UpdateUserDTO = z.infer<typeof updateUserSchema>;
