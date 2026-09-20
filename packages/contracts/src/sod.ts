import { z } from "zod";

/** One tripped `permissions/sod.ts` rule, as carried on a 409 and on the report. */
export const sodConflictSchema = z.object({
  ruleId: z.string().min(1),
  labelAr: z.string().min(1),
  labelEn: z.string().min(1),
  sideLabelAr: z.string().min(1),
  sideLabelEn: z.string().min(1),
  checkerLabelAr: z.string().min(1),
  checkerLabelEn: z.string().min(1),
  matchedA: z.array(z.string()),
  matchedB: z.array(z.string()),
});
export type SodConflictDTO = z.infer<typeof sodConflictSchema>;

/** The override a caller must supply to save past a 409 `SOD_CONFLICT`. */
export const sodAcknowledgeFields = {
  acknowledge: z.boolean().optional(),
  reason: z.string().trim().min(1).optional(),
};
