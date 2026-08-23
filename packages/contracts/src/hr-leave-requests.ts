import { z } from "zod";
import { leaveTypeCodeSchema } from "./hr-leave-policies.js";

/**
 * Wire contracts for طلبات الإجازات — Leave Requests (docs/catalog/06-crm-hr.md
 * §"طلبات الإجازات"). `gateActionType`/step `role` are kept as permissive
 * strings rather than importing the workflow engine's `GateableActionType`
 * union from `@mezan/domain` — `@mezan/contracts` has no dependency on
 * `@mezan/domain` (matches `events.ts`'s/`warehouse.ts`'s existing rationale).
 */

export const leaveApplicationStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);

export const gateStepSchema = z.object({
  role: z.string().min(1),
  description: z.string().optional(),
});

export const decisionRecordSchema = z.object({
  stepIndex: z.number().int(),
  kind: z.enum(["approve", "reject", "request_modification", "bypass"]),
  actorId: z.string(),
  comment: z.string().optional(),
  at: z.number().optional(),
});

export const leaveApplicationSchema = z.object({
  id: z.string().min(1),
  requestNo: z.string(),
  employeeId: z.string().min(1),
  leaveTypeCode: leaveTypeCodeSchema,
  startDate: z.string(),
  endDate: z.string(),
  halfDay: z.boolean(),
  days: z.number(),
  reason: z.string().nullable(),
  status: leaveApplicationStatusSchema,
  gateActionType: z.string(),
  workflowRequestId: z.string(),
  steps: z.array(gateStepSchema),
  currentStepIndex: z.number().int(),
  decisions: z.array(decisionRecordSchema),
  submittedBy: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});

export const submitLeaveApplicationSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeCode: leaveTypeCodeSchema,
  startDate: z.string(),
  endDate: z.string(),
  halfDay: z.boolean().optional(),
  reason: z.string().nullable().optional(),
});

export const decideLeaveApplicationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
});

export type LeaveApplicationStatusDTO = z.infer<typeof leaveApplicationStatusSchema>;
export type GateStepDTO = z.infer<typeof gateStepSchema>;
export type DecisionRecordDTO = z.infer<typeof decisionRecordSchema>;
export type LeaveApplicationDTO = z.infer<typeof leaveApplicationSchema>;
export type SubmitLeaveApplicationDTO = z.infer<typeof submitLeaveApplicationSchema>;
export type DecideLeaveApplicationDTO = z.infer<typeof decideLeaveApplicationSchema>;
