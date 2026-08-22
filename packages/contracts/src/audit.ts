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
  action: z.string().min(1),
  actor: z.string().min(1),
  timestamp: z.string().min(1), // ISO-8601 UTC
  severity: auditSeveritySchema,
  details: z.record(z.unknown()).nullable(),
});

export type AuditSeverityDTO = z.infer<typeof auditSeveritySchema>;
export type AuditStreamDTO = z.infer<typeof auditStreamSchema>;
export type AuditEventDTO = z.infer<typeof auditEventSchema>;
