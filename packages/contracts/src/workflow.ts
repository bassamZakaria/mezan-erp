import { z } from "zod";

/** إعدادات الموافقات — one step in a gate config: an ordered approver role + optional description. */
export const gateStepSchema = z.object({
  role: z.string().min(1),
  description: z.string().optional(),
});

export const workflowConfigSchema = z.object({
  id: z.string().min(1),
  /** One of the 26 gateable action-type codes (@mezan/domain's `GATEABLE_ACTION_TYPES`). */
  actionType: z.string().min(1),
  steps: z.array(gateStepSchema).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createWorkflowConfigSchema = z.object({
  actionType: z.string().min(1),
  steps: z.array(gateStepSchema).min(1),
});

export const updateWorkflowConfigSchema = z.object({
  steps: z.array(gateStepSchema).min(1),
});

/** الموافقات — an in-flight or resolved approval instance. */
export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "modification_requested"]);
export enum DocumentApprovalStatus {
  Pending = "pending",
  Approved = "approved",
  Rejected = "rejected",
  ModificationRequested = "modification_requested",
}

/** The approval request standing behind a gated document, and why it was last rejected. */
export const documentApprovalSchema = z.object({
  status: approvalStatusSchema,
  rejectionReason: z.string().nullable(),
  rejectedBy: z.string().nullable(),
});

export const decisionKindSchema = z.enum(["approve", "reject", "request_modification", "bypass"]);

export const decisionRecordSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  kind: decisionKindSchema,
  actorId: z.string(),
  comment: z.string().optional(),
  at: z.number().optional(),
});

export const approvalRequestSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  submittedBy: z.string(),
  steps: z.array(gateStepSchema),
  currentStep: z.number().int().nonnegative(),
  status: approvalStatusSchema,
  decisions: z.array(decisionRecordSchema),
  entityLabel: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** `POST /workflow/requests` — submits a new approval request for a gateable action. */
export const submitApprovalRequestSchema = z.object({
  actionType: z.string().min(1),
  entityLabel: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
});

/** `POST /workflow/requests/:id/decide` — the inbox's approve / reject / request-modification actions. */
export const decideApprovalRequestSchema = z.object({
  decision: z.enum(["approve", "reject", "request_modification"]),
  comment: z.string().optional(),
});

export type GateStepDTO = z.infer<typeof gateStepSchema>;
export type WorkflowConfigDTO = z.infer<typeof workflowConfigSchema>;
export type CreateWorkflowConfigDTO = z.infer<typeof createWorkflowConfigSchema>;
export type UpdateWorkflowConfigDTO = z.infer<typeof updateWorkflowConfigSchema>;
export type ApprovalStatusDTO = z.infer<typeof approvalStatusSchema>;
export type DocumentApprovalDTO = z.infer<typeof documentApprovalSchema>;
export type DecisionKindDTO = z.infer<typeof decisionKindSchema>;
export type DecisionRecordDTO = z.infer<typeof decisionRecordSchema>;
export type ApprovalRequestDTO = z.infer<typeof approvalRequestSchema>;
export type SubmitApprovalRequestDTO = z.infer<typeof submitApprovalRequestSchema>;
export type DecideApprovalRequestDTO = z.infer<typeof decideApprovalRequestSchema>;
