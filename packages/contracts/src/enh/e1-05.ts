import { z } from "zod";

export const auditFieldChangeSchema = z.object({
  field: z.string().min(1),
  key: z.string().optional(),
  redacted: z.boolean().optional(),
  from: z.unknown(),
  to: z.unknown(),
});

export type AuditFieldChangeDTO = z.infer<typeof auditFieldChangeSchema>;
