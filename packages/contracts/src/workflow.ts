import { z } from "zod";

/**
 * Wire contracts for the workflow/approvals engine's user-facing surface
 * (docs/catalog/09 §الموافقات): `/settings/workflow` (which action types are
 * gated, by whom, above what amount) and `/workflow/requests` (the approvals
 * inbox — pending/mine/acted). Money crosses the wire as an exact decimal
 * string, same convention as journal.ts/sales-returns.ts — never a float.
 */

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

export const gateStepSchema = z.object({
  /** Approver role code (a tenant-defined role's `code`, e.g. "FINANCE_MANAGER"). */
  role: z.string().min(1),
  description: z.string().trim().max(200).optional(),
});
export type GateStepDTO = z.infer<typeof gateStepSchema>;

export const workflowActionCategorySchema = z.enum([
  "sales",
  "purchases",
  "treasury",
  "inventory",
  "accounting",
  "hr_payroll",
  "hr_leave",
  "manufacturing",
]);
export type WorkflowActionCategoryDTO = z.infer<typeof workflowActionCategorySchema>;

/** `PUT /workflow/config/:actionType` body. An empty `steps` array clears the gate (every submission grants immediately). */
export const workflowConfigInputSchema = z.object({
  steps: z.array(gateStepSchema).max(10),
  minAmount: decimalString.nullable().optional(),
});
export type WorkflowConfigInputDTO = z.infer<typeof workflowConfigInputSchema>;

export const workflowConfigSchema = z.object({
  actionType: z.string(),
  labelAr: z.string(),
  category: workflowActionCategorySchema,
  steps: z.array(gateStepSchema),
  minAmount: z.string().nullable(),
  configured: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type WorkflowConfigDTO = z.infer<typeof workflowConfigSchema>;

/** `POST /workflow/requests/:id/approve` and `.../reject` body. */
export const workflowDecisionCommentSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
});
export type WorkflowDecisionCommentDTO = z.infer<typeof workflowDecisionCommentSchema>;

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "modification_requested"]);
export type ApprovalStatusDTO = z.infer<typeof approvalStatusSchema>;

export const decisionKindSchema = z.enum(["approve", "reject", "request_modification", "bypass"]);
export type DecisionKindDTO = z.infer<typeof decisionKindSchema>;

export const decisionRecordSchema = z.object({
  stepIndex: z.number().int(),
  kind: decisionKindSchema,
  actorId: z.string(),
  actorName: z.string().nullable(),
  comment: z.string().nullable(),
  /** ISO-8601 UTC, when the decision carries a timestamp. */
  at: z.string().nullable(),
});
export type DecisionRecordDTO = z.infer<typeof decisionRecordSchema>;

/** The document a request gates — null when it can't be resolved (see `@mezan/persistence`'s subject resolver). */
export const workflowSubjectSchema = z.object({
  docType: z.string(),
  docTypeLabelAr: z.string(),
  docId: z.string(),
  docNo: z.string().nullable(),
  date: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
});
export type WorkflowSubjectDTO = z.infer<typeof workflowSubjectSchema>;

export const approvalRequestSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  actionLabelAr: z.string(),
  submittedBy: z.string(),
  submittedByName: z.string().nullable(),
  currentStep: z.number().int(),
  totalSteps: z.number().int(),
  /** Role code awaiting a decision — null once resolved (approved/rejected). */
  currentStepRole: z.string().nullable(),
  status: approvalStatusSchema,
  steps: z.array(gateStepSchema),
  decisions: z.array(decisionRecordSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  subject: workflowSubjectSchema.nullable(),
  /** True when the calling user (per their session) may act on this request right now. Set only on inbox-scoped rows. */
  canAct: z.boolean(),
});
export type ApprovalRequestDTO = z.infer<typeof approvalRequestSchema>;

export const workflowRequestScopeSchema = z.enum(["inbox", "mine", "acted"]);
export type WorkflowRequestScopeDTO = z.infer<typeof workflowRequestScopeSchema>;
