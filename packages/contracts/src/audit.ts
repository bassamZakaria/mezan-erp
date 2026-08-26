import { z } from "zod";

export const auditSeveritySchema = z.enum([
  "CRITICAL",
  "ERROR",
  "WARNING",
  "INFO",
]);

export const auditStreamSchema = z.enum(["security", "sensitive"]);

/** Wire contract for an append-only audit event (`/api/audit/*`). */
export const auditEventSchema = z.object({
  stream: auditStreamSchema,
  module: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().nullable(),
  action: z.string().min(1),
  actor: z.string().min(1),
  /** The branch the action happened in; null for rows written before the field existed, or for a request not narrowed to one branch. */
  branchId: z.string().nullable(),
  timestamp: z.string().min(1), // ISO-8601 UTC
  severity: auditSeveritySchema,
  details: z.record(z.unknown()).nullable(),
});

export type AuditSeverityDTO = z.infer<typeof auditSeveritySchema>;
export type AuditStreamDTO = z.infer<typeof auditStreamSchema>;
export type AuditEventDTO = z.infer<typeof auditEventSchema>;

/** Query params for `GET /audit` — every field optional and AND-combined. */
export const auditQuerySchema = z.object({
  stream: auditStreamSchema.optional(),
  branchId: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  severity: auditSeveritySchema.optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const auditQueryResponseSchema = z.object({
  events: z.array(auditEventSchema),
  total: z.number().int().nonnegative(),
});

export type AuditQueryDTO = z.infer<typeof auditQuerySchema>;
export type AuditQueryResponseDTO = z.infer<typeof auditQueryResponseSchema>;
