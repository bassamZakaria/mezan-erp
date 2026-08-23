import { z } from "zod";
import { leaveTypeCodeSchema } from "./hr-leave-policies.js";

/** Wire contracts for استحقاقات الإجازات — Leave Accrual Batches (docs/catalog/06-crm-hr.md §"استحقاقات الإجازات"). */

export const leaveAccrualRunTypeSchema = z.enum(["MANUAL", "SCHEDULED"]);
export const leaveAccrualBatchStatusSchema = z.enum(["draft", "posted", "cancelled"]);

export const leaveAccrualLineSchema = z.object({
  employeeId: z.string(),
  leaveTypeCode: leaveTypeCodeSchema,
  creditedDays: z.number(),
  value: z.string(),
});

export const leaveAccrualBatchSchema = z.object({
  id: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  runDate: z.string(),
  runType: leaveAccrualRunTypeSchema,
  status: leaveAccrualBatchStatusSchema,
  lines: z.array(leaveAccrualLineSchema),
  totalDays: z.number(),
  totalValue: z.string(),
  journalEntryId: z.string().nullable(),
  executedBy: z.string().nullable(),
  createdAt: z.string(),
  postedAt: z.string().nullable(),
});

export const createAccrualBatchSchema = z.object({
  runDate: z.string(),
  runType: leaveAccrualRunTypeSchema.optional(),
});

export type LeaveAccrualRunTypeDTO = z.infer<typeof leaveAccrualRunTypeSchema>;
export type LeaveAccrualBatchStatusDTO = z.infer<typeof leaveAccrualBatchStatusSchema>;
export type LeaveAccrualLineDTO = z.infer<typeof leaveAccrualLineSchema>;
export type LeaveAccrualBatchDTO = z.infer<typeof leaveAccrualBatchSchema>;
export type CreateAccrualBatchDTO = z.infer<typeof createAccrualBatchSchema>;
