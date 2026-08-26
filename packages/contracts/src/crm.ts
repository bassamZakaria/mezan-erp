import { z } from "zod";

/**
 * Wire contracts for CRM (docs/catalog/06-crm-hr.md "العملاء المحتملون /
 * الفرص / خط المبيعات / مراحل خط المبيعات / الأنشطة"). Money crosses the
 * wire as an exact decimal string, never a float (docs/plan.md §2.3); the
 * domain re-parses via `Money.fromMajor`.
 */

export const leadStatusSchema = z.enum(["new", "contacted", "qualified", "converted", "lost", "unqualified"]);
export const leadSourceSchema = z.enum(["website", "referral", "phone", "social", "other"]);

export const leadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  company: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source: leadSourceSchema,
  expectedValue: z.string().nullable(),
  interest: z.string().nullable(),
  notes: z.string().nullable(),
  status: leadStatusSchema,
  convertedCustomerId: z.string().nullable(),
  convertedOpportunityId: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const createLeadSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  company: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  source: leadSourceSchema.optional(),
  expectedValue: z.string().nullable().optional(),
  interest: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const transitionLeadSchema = z.object({
  status: leadStatusSchema,
});

export const convertLeadSchema = z.object({
  createCustomer: z.boolean(),
  customer: z
    .object({
      id: z.string().min(1),
      code: z.string().min(1),
    })
    .optional(),
  createOpportunity: z.boolean(),
  opportunity: z
    .object({
      id: z.string().min(1),
      title: z.string().min(1),
      branchId: z.string().min(1).nullable().optional(),
      stageId: z.string().min(1),
      expectedValue: z.string(),
      probability: z.number().min(0).max(100),
      expectedCloseDate: z.string().nullable().optional(),
    })
    .optional(),
});

export const opportunityStatusSchema = z.enum(["open", "won", "lost"]);

export const opportunitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  customerId: z.string().min(1),
  branchId: z.string().nullable(),
  stageId: z.string().min(1),
  expectedValue: z.string(),
  probability: z.number().min(0).max(100),
  expectedCloseDate: z.string().nullable(),
  notes: z.string().nullable(),
  status: opportunityStatusSchema,
  createdAt: z.string().min(1),
  closedAt: z.string().nullable(),
});

export const createOpportunitySchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  customerId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  stageId: z.string().min(1),
  expectedValue: z.string().optional(),
  probability: z.number().min(0).max(100).optional(),
  expectedCloseDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const moveOpportunityStageSchema = z.object({
  stageId: z.string().min(1),
});

export const pipelineStageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  order: z.number().int().min(0),
  defaultProbability: z.number().min(0).max(100),
  color: z.string().min(1),
  isWinStage: z.boolean(),
  isLossStage: z.boolean(),
  active: z.boolean(),
});

export const createPipelineStageSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  defaultProbability: z.number().min(0).max(100).optional(),
  color: z.string().min(1).optional(),
  isWinStage: z.boolean().optional(),
  isLossStage: z.boolean().optional(),
});

export const activityTypeSchema = z.enum(["call", "meeting", "todo", "email"]);
export const activityStatusSchema = z.enum(["pending", "completed", "cancelled"]);

export const activitySchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  type: activityTypeSchema,
  relatedLeadId: z.string().nullable(),
  relatedOpportunityId: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: activityStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const createActivitySchema = z.object({
  id: z.string().min(1).optional(),
  subject: z.string().min(1),
  type: activityTypeSchema.optional(),
  relatedLeadId: z.string().nullable().optional(),
  relatedOpportunityId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type LeadStatusDTO = z.infer<typeof leadStatusSchema>;
export type LeadSourceDTO = z.infer<typeof leadSourceSchema>;
export type LeadDTO = z.infer<typeof leadSchema>;
export type CreateLeadDTO = z.infer<typeof createLeadSchema>;
export type TransitionLeadDTO = z.infer<typeof transitionLeadSchema>;
export type ConvertLeadDTO = z.infer<typeof convertLeadSchema>;
export type OpportunityStatusDTO = z.infer<typeof opportunityStatusSchema>;
export type OpportunityDTO = z.infer<typeof opportunitySchema>;
export type CreateOpportunityDTO = z.infer<typeof createOpportunitySchema>;
export type MoveOpportunityStageDTO = z.infer<typeof moveOpportunityStageSchema>;
export type PipelineStageDTO = z.infer<typeof pipelineStageSchema>;
export type CreatePipelineStageDTO = z.infer<typeof createPipelineStageSchema>;
export type ActivityTypeDTO = z.infer<typeof activityTypeSchema>;
export type ActivityStatusDTO = z.infer<typeof activityStatusSchema>;
export type ActivityDTO = z.infer<typeof activitySchema>;
export type CreateActivityDTO = z.infer<typeof createActivitySchema>;
