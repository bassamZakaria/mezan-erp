import { z } from "zod";

/**
 * Wire contracts for HR payroll (docs/archive/catalog/06-crm-hr.md "الرواتب" and
 * "سلف الموظفين"). Money crosses the wire as an exact decimal string, never a
 * float (docs/archive/plan.md §2.3); the domain re-parses via `Money.fromMajor`.
 */

// --- Employee advances -----------------------------------------------------

export const employeeAdvanceStatusSchema = z.enum(["pending", "approved", "disbursed", "repaid", "rejected"]);

export const advanceInstallmentSchema = z.object({
  seq: z.number().int().positive(),
  dueDate: z.string().min(1),
  amount: z.string(),
  recovered: z.string(),
});

export const employeeAdvanceSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  employeeId: z.string().min(1),
  amount: z.string(),
  currency: z.string().min(1),
  installmentCount: z.number().int().positive(),
  firstDeductionDate: z.string().min(1),
  reason: z.string().nullable(),
  installments: z.array(advanceInstallmentSchema),
  outstanding: z.string(),
  recovered: z.string(),
  status: employeeAdvanceStatusSchema,
  requestedAt: z.string().min(1),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  disbursedAt: z.string().nullable(),
  disbursementVoucherId: z.string().nullable(),
  disbursementJournalEntryId: z.string().nullable(),
  repaidAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const createEmployeeAdvanceSchema = z.object({
  id: z.string().min(1).optional(),
  employeeId: z.string().min(1),
  amount: z.string(),
  currency: z.string().min(1).optional(),
  installmentCount: z.number().int().positive(),
  firstDeductionDate: z.string().min(1),
  reason: z.string().nullable().optional(),
});

/** Body shared by "صرف السلفة" and "صرف الرواتب" — the treasury the money leaves from. */
export const treasuryDisbursementSchema = z.object({
  treasuryAccountId: z.string().min(1),
  branchId: z.string().min(1),
  date: z.string().min(1).optional(),
  paymentMethod: z.enum(["cash", "bank", "cheque", "card", "wallet"]).optional(),
  referenceNo: z.string().nullable().optional(),
});

export const employeeAdvanceBalanceSchema = z.object({
  employeeId: z.string().min(1),
  outstanding: z.string(),
  advanceCount: z.number().int().nonnegative(),
});

// --- Payroll runs & payslips ----------------------------------------------

export const payrollRunStatusSchema = z.enum(["draft", "calculated", "approved", "disbursed", "cancelled"]);
export const payslipLineKindSchema = z.enum(["earning", "deduction", "employer_contribution"]);
export const payslipLineSourceSchema = z.enum([
  "contract_basic",
  "contract_allowance",
  "contract_deduction",
  "unpaid_leave",
  "advance_recovery",
]);

export const payslipLineSchema = z.object({
  id: z.string().min(1),
  kind: payslipLineKindSchema,
  source: payslipLineSourceSchema,
  nameAr: z.string().min(1),
  amount: z.string(),
  glAccountId: z.string().nullable(),
  referenceId: z.string().nullable(),
});

export const payslipSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  runId: z.string().min(1),
  employeeId: z.string().min(1),
  contractId: z.string().min(1),
  currency: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  periodDays: z.number().int().positive(),
  paidDays: z.number().int().nonnegative(),
  lines: z.array(payslipLineSchema),
  grossEarnings: z.string(),
  totalDeductions: z.string(),
  employerContributions: z.string(),
  netPay: z.string(),
  createdAt: z.string().min(1),
});

export const payrollRunSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  branchId: z.string().nullable(),
  currency: z.string().min(1),
  status: payrollRunStatusSchema,
  employeeCount: z.number().int().nonnegative(),
  totalGross: z.string(),
  totalDeductions: z.string(),
  totalEmployerContributions: z.string(),
  totalNet: z.string(),
  unpaidLeaveSource: z.enum(["none", "provider"]),
  warnings: z.array(z.string()),
  journalEntryId: z.string().nullable(),
  disbursementVoucherId: z.string().nullable(),
  calculatedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  disbursedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string().min(1),
});

export const payrollRunDetailSchema = payrollRunSchema.extend({
  payslips: z.array(payslipSchema),
});

export const createPayrollRunSchema = z.object({
  id: z.string().min(1).optional(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  branchId: z.string().nullable().optional(),
  currency: z.string().min(1).optional(),
});

export type EmployeeAdvanceStatusDTO = z.infer<typeof employeeAdvanceStatusSchema>;
export type AdvanceInstallmentDTO = z.infer<typeof advanceInstallmentSchema>;
export type EmployeeAdvanceDTO = z.infer<typeof employeeAdvanceSchema>;
export type CreateEmployeeAdvanceDTO = z.infer<typeof createEmployeeAdvanceSchema>;
export type TreasuryDisbursementDTO = z.infer<typeof treasuryDisbursementSchema>;
export type EmployeeAdvanceBalanceDTO = z.infer<typeof employeeAdvanceBalanceSchema>;
export type PayrollRunStatusDTO = z.infer<typeof payrollRunStatusSchema>;
export type PayslipLineKindDTO = z.infer<typeof payslipLineKindSchema>;
export type PayslipLineSourceDTO = z.infer<typeof payslipLineSourceSchema>;
export type PayslipLineDTO = z.infer<typeof payslipLineSchema>;
export type PayslipDTO = z.infer<typeof payslipSchema>;
export type PayrollRunDTO = z.infer<typeof payrollRunSchema>;
export type PayrollRunDetailDTO = z.infer<typeof payrollRunDetailSchema>;
export type CreatePayrollRunDTO = z.infer<typeof createPayrollRunSchema>;

// --- Payroll components (GL routing, R10.7) --------------------------------

export const payrollComponentKindSchema = payslipLineKindSchema;

export const payrollComponentSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  kind: payrollComponentKindSchema,
  /** Debit account for an earning or employer contribution, credit account for a deduction. */
  glAccountId: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const createPayrollComponentSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  kind: payrollComponentKindSchema,
  glAccountId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export const updatePayrollComponentSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  glAccountId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export type PayrollComponentKindDTO = z.infer<typeof payrollComponentKindSchema>;
export type PayrollComponentDTO = z.infer<typeof payrollComponentSchema>;
export type CreatePayrollComponentDTO = z.infer<typeof createPayrollComponentSchema>;
export type UpdatePayrollComponentDTO = z.infer<typeof updatePayrollComponentSchema>;
