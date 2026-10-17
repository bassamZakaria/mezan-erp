import { z } from "zod";
import { moneyString } from "../money-string.js";
import { cockpitSchema } from "./e1-01.js";
import { ownerDigestExceptionSchema } from "./e3-02.js";

export const glanceQuerySchema = z.object({
  branchId: z.string().trim().max(120).default(""),
});
export type GlanceQueryDTO = z.infer<typeof glanceQuerySchema>;

export const glanceBranchSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});
export type GlanceBranchDTO = z.infer<typeof glanceBranchSchema>;

export const glanceBalanceSchema = z.object({
  amount: moneyString,
});
export type GlanceBalanceDTO = z.infer<typeof glanceBalanceSchema>;

export const glanceApprovalsSchema = z.object({
  waiting: z.number().int(),
  oldestWaitingSince: z.string().nullable(),
});
export type GlanceApprovalsDTO = z.infer<typeof glanceApprovalsSchema>;

export const glanceSchema = z.object({
  generatedAt: z.string(),
  companyName: z.string(),
  currency: z.string(),
  branchId: z.string(),
  branches: z.array(glanceBranchSchema),
  cockpit: cockpitSchema,
  receivables: glanceBalanceSchema.nullable(),
  payables: glanceBalanceSchema.nullable(),
  approvals: glanceApprovalsSchema.nullable(),
  exceptions: z.array(ownerDigestExceptionSchema),
});
export type GlanceDTO = z.infer<typeof glanceSchema>;
