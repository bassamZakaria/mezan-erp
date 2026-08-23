import { z } from "zod";

/** Wire contracts for سياسات الإجازات — Leave Policies (docs/catalog/06-crm-hr.md §"سياسات الإجازات"). */

export const leaveTypeCodeSchema = z.enum([
  "ANNUAL",
  "SICK",
  "PERSONAL",
  "CASUAL",
  "MATERNITY",
  "PATERNITY",
  "UNPAID",
  "EMERGENCY",
]);

export const leaveAccrualFrequencySchema = z.enum(["MONTHLY", "ANNUAL", "NONE"]);
export const leaveCarryoverPolicySchema = z.enum(["NONE", "LIMITED", "UNLIMITED"]);
export const leavePolicySourceSchema = z.enum(["MANUAL", "PRESET_EG_LAW_12_2003", "PRESET_EG_LAW_14_2025"]);

export const leavePolicyVersionSchema = z.object({
  id: z.string().min(1),
  leaveTypeCode: leaveTypeCodeSchema,
  effectiveDate: z.string(),
  baseBalanceDays: z.number().min(0),
  accrualFrequency: leaveAccrualFrequencySchema,
  carryover: leaveCarryoverPolicySchema,
  carryoverMaxDays: z.number().min(0).nullable(),
  payoutOnTermination: z.boolean(),
  legallyMandatory: z.boolean(),
  source: leavePolicySourceSchema,
  createdAt: z.string(),
});

export const setLeavePolicySchema = z.object({
  leaveTypeCode: leaveTypeCodeSchema,
  effectiveDate: z.string(),
  baseBalanceDays: z.number().min(0),
  accrualFrequency: leaveAccrualFrequencySchema,
  carryover: leaveCarryoverPolicySchema,
  carryoverMaxDays: z.number().min(0).nullable().optional(),
  payoutOnTermination: z.boolean(),
  legallyMandatory: z.boolean(),
});

export const applyLeavePolicyPresetSchema = z.object({
  source: z.enum(["PRESET_EG_LAW_12_2003", "PRESET_EG_LAW_14_2025"]),
});

export type LeaveTypeCodeDTO = z.infer<typeof leaveTypeCodeSchema>;
export type LeaveAccrualFrequencyDTO = z.infer<typeof leaveAccrualFrequencySchema>;
export type LeaveCarryoverPolicyDTO = z.infer<typeof leaveCarryoverPolicySchema>;
export type LeavePolicySourceDTO = z.infer<typeof leavePolicySourceSchema>;
export type LeavePolicyVersionDTO = z.infer<typeof leavePolicyVersionSchema>;
export type SetLeavePolicyDTO = z.infer<typeof setLeavePolicySchema>;
export type ApplyLeavePolicyPresetDTO = z.infer<typeof applyLeavePolicyPresetSchema>;
