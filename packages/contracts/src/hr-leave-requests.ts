import { z } from "zod";
import { leaveTypeCodeSchema } from "./hr-leave-policies.js";

/**
 * Wire contracts for طلبات الإجازات — Leave Requests (docs/catalog/06-crm-hr.md
 * §"طلبات الإجازات"). `gateActionType`/step `role` are kept as permissive
 * strings rather than importing the workflow engine's `GateableActionType`
 * union from `@mezan/domain` — `@mezan/contracts` has no dependency on
 * `@mezan/domain` (matches `events.ts`'s/`warehouse.ts`'s existing rationale).
 */

export const leaveRequestStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);

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

export const leaveRequestSchema = z.object({
  id: z.string().min(1),
  requestNo: z.string(),
  employeeId: z.string().min(1),
  leaveTypeCode: leaveTypeCodeSchema,
  startDate: z.string(),
  endDate: z.string(),
  halfDay: z.boolean(),
  days: z.number(),
  reason: z.string().nullable(),
  status: leaveRequestStatusSchema,
  gateActionType: z.string(),
  workflowRequestId: z.string(),
  steps: z.array(gateStepSchema),
  currentStepIndex: z.number().int(),
  decisions: z.array(decisionRecordSchema),
  submittedBy: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});

export const submitLeaveRequestSchema = z.object({
  employeeId: z.string().min(1),
  leaveTypeCode: leaveTypeCodeSchema,
  startDate: z.string(),
  endDate: z.string(),
  halfDay: z.boolean().optional(),
  reason: z.string().nullable().optional(),
});

export const decideLeaveRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().optional(),
});

export type LeaveRequestStatusDTO = z.infer<typeof leaveRequestStatusSchema>;
export type GateStepDTO = z.infer<typeof gateStepSchema>;
export type DecisionRecordDTO = z.infer<typeof decisionRecordSchema>;
export type LeaveRequestDTO = z.infer<typeof leaveRequestSchema>;
export type SubmitLeaveRequestDTO = z.infer<typeof submitLeaveRequestSchema>;
export type DecideLeaveRequestDTO = z.infer<typeof decideLeaveRequestSchema>;
