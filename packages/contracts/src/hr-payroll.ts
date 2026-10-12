import { z } from "zod";
import { moneyString } from "./money-string.js";
import { isoDateOrInstant } from "./iso-date.js";

/**
 * Wire contracts for HR payroll (docs/archive/catalog/06-crm-hr.md "الرواتب" and
 * "سلف الموظفين"). Money crosses the wire as an exact decimal string, never a
 * float (docs/archive/plan.md §2.3); the domain re-parses via `Money.fromMajor`.
 */

// --- Employee advances -----------------------------------------------------

export const employeeAdvanceStatusSchema = z.enum(["pending", "approved", "disbursed", "repaid", "rejected", "cancelled"]);

export const advanceInstallmentSchema = z.object({
  seq: z.number().int().positive(),
  dueDate: z.string().min(1),
  amount: moneyString,
  recovered: z.string(),
});

export const advanceRepaymentSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  amount: z.string(),
  paymentMethod: z.string().min(1),
  treasuryAccountId: z.string().min(1),
  voucherId: z.string().min(1),
  voucherNo: z.string().nullable(),
  journalEntryId: z.string().nullable(),
  note: z.string().nullable(),
  recordedBy: z.string().min(1),
  recordedAt: z.string().min(1),
});

export const employeeAdvanceSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  employeeId: z.string().min(1),
  amount: moneyString,
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
  repayments: z.array(advanceRepaymentSchema).optional(),
});

export const createEmployeeAdvanceSchema = z.object({
  id: z.string().min(1).optional(),
  employeeId: z.string().min(1),
  amount: moneyString,
  currency: z.string().min(1).optional(),
  installmentCount: z.number().int().positive(),
  firstDeductionDate: z.string().min(1),
  reason: z.string().nullable().optional(),
});

/** Body shared by "صرف السلفة" and "صرف الرواتب" — the treasury the money leaves from. */
export const treasuryDisbursementSchema = z.object({
  treasuryAccountId: z.string().min(1),
  branchId: z.string().min(1),
  date: isoDateOrInstant.optional(),
  paymentMethod: z.enum(["cash", "bank", "cheque", "card", "wallet"]).optional(),
  referenceNo: z.string().nullable().optional(),
});

/** «سداد نقدي» — repaying an advance outside payroll. `repaymentId` is the idempotency key a retry must reuse. */
export const repayEmployeeAdvanceSchema = treasuryDisbursementSchema.extend({
  repaymentId: z.string().min(1).max(100),
  amount: moneyString,
  note: z.string().max(500).nullable().optional(),
});

export const employeeAdvanceRepayableSchema = z.object({
  advanceId: z.string().min(1),
  outstanding: z.string(),
  pendingPayrollRecovery: z.string(),
  repayable: z.string(),
});

export const employeeAdvanceBalanceSchema = z.object({
  employeeId: z.string().min(1),
  outstanding: z.string(),
  advanceCount: z.number().int().nonnegative(),
});

// --- Payroll runs & payslips ----------------------------------------------

export const payrollRunStatusSchema = z.enum(["draft", "calculated", "approved", "disbursed", "cancelled"]);
export const payslipLineKindSchema = z.enum(["earning", "deduction", "employer_contribution", "termination_adjustment"]);
export const payslipLineSourceSchema = z.enum([
  "contract_basic",
  "contract_allowance",
  "contract_deduction",
  "unpaid_leave",
  "advance_recovery",
  "garnishment",
  "overtime",
  "income_tax",
  "social_insurance_employee",
  "social_insurance_employer",
  "statutory_levy",
  "termination_adjustment",
]);

export const payslipLineSchema = z.object({
  id: z.string().min(1),
  kind: payslipLineKindSchema,
  source: payslipLineSourceSchema,
  nameAr: z.string().min(1),
  amount: moneyString,
  glAccountId: z.string().nullable(),
  referenceId: z.string().nullable(),
  /** True when a `garnishment` line hit the Art. 44 wage-attachment cap, or an `advance_recovery` line hit the Art. 43 10% cap (D183). Absent on lines predating either cap. */
  capped: z.boolean().optional(),
});

/** Every figure in `contractCurrency` is for the reader; the payslip's own amounts are in the run's currency. */
export const payslipBasisSchema = z.object({
  payBasis: z.enum(["monthly", "hourly", "daily"]),
  quantity: z.number().nonnegative().nullable(),
  rate: z.string(),
  contractCurrency: z.string().min(1),
  fxRate: z.string().nullable(),
  fxRateDate: z.string().nullable(),
  grossInContractCurrency: z.string().nullable(),
  netInContractCurrency: z.string().nullable(),
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
  partMonthTaxNotice: z.string().nullable().optional(),
  partMonthTaxNoticeEn: z.string().nullable().optional(),
  lines: z.array(payslipLineSchema),
  grossEarnings: z.string(),
  totalDeductions: z.string(),
  employerContributions: z.string(),
  netPay: z.string(),
  insurableWage: z.string(),
  insurableWageCapped: z.boolean(),
  annualTaxableIncome: z.string(),
  /** Null on a payslip calculated before this field existed (D191) — never "0", a fabricated employer cost. */
  totalEmployerCost: z.string().nullable(),
  /** Null on a payslip calculated before the basis was recorded. */
  basis: payslipBasisSchema.nullable().optional(),
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
  totalNet: moneyString,
  /** As {@link payslipSchema.totalEmployerCost} — null on a run calculated before this field existed (D191). */
  totalEmployerCost: moneyString.nullable(),
  unpaidLeaveSource: z.enum(["none", "provider"]),
  overtimeSource: z.enum(["none", "provider"]),
  /** Empty = computed with statutory rules OFF; the screens then keep saying tax and insurance were not computed. */
  statutoryTableCodes: z.array(z.string()),
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
export type AdvanceRepaymentDTO = z.infer<typeof advanceRepaymentSchema>;
export type RepayEmployeeAdvanceDTO = z.infer<typeof repayEmployeeAdvanceSchema>;
export type EmployeeAdvanceRepayableDTO = z.infer<typeof employeeAdvanceRepayableSchema>;
export type PayrollRunStatusDTO = z.infer<typeof payrollRunStatusSchema>;
export type PayslipLineKindDTO = z.infer<typeof payslipLineKindSchema>;
export type PayslipLineSourceDTO = z.infer<typeof payslipLineSourceSchema>;
export type PayslipLineDTO = z.infer<typeof payslipLineSchema>;
export type PayslipDTO = z.infer<typeof payslipSchema>;
export type PayslipBasisDTO = z.infer<typeof payslipBasisSchema>;
export type PayrollRunDTO = z.infer<typeof payrollRunSchema>;
export type PayrollRunDetailDTO = z.infer<typeof payrollRunDetailSchema>;
export type CreatePayrollRunDTO = z.infer<typeof createPayrollRunSchema>;

// --- Payroll components (GL routing, R10.7) --------------------------------

export const payrollComponentKindSchema = z.enum(["earning", "deduction", "employer_contribution"]);

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

// --- Garnishments (الحجز على الأجر) ----------------------------------------

export const garnishmentKindSchema = z.enum(["court_order", "alimony", "debt_settlement", "union_dues", "other"]);

export const garnishmentSchema = z.object({
  id: z.string().min(1),
  employeeId: z.string().min(1),
  kind: garnishmentKindSchema,
  reference: z.string().min(1),
  labelAr: z.string().min(1),
  totalAmount: moneyString,
  monthlyAmount: moneyString,
  outstanding: moneyString,
  recovered: moneyString,
  currency: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const createGarnishmentSchema = z.object({
  id: z.string().min(1).optional(),
  employeeId: z.string().min(1),
  kind: garnishmentKindSchema,
  reference: z.string().min(1),
  labelAr: z.string().min(1),
  totalAmount: moneyString,
  monthlyAmount: moneyString,
  currency: z.string().min(1).default("EGP"),
  startDate: z.string().min(1),
  endDate: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type GarnishmentDTO = z.infer<typeof garnishmentSchema>;
export type CreateGarnishmentDTO = z.infer<typeof createGarnishmentSchema>;

// --- Statutory insurance-year overrides and the statutory switch ------------

export const socialInsuranceYearOverrideSchema = z.object({
  year: z.number().int().min(2019).max(2100),
  monthlyWageFloor: z.string().min(1),
  monthlyWageCeiling: z.string().min(1),
  note: z.string().nullable(),
  enteredBy: z.string().min(1),
  enteredAt: z.string().min(1),
});

export const upsertSocialInsuranceYearSchema = z.object({
  year: z.number().int().min(2019).max(2100),
  /** Exact decimal strings, transcribed from the published decree. */
  monthlyWageFloor: z.string().regex(/^\d+(\.\d{1,2})?$/, "الحد الأدنى يجب أن يكون رقماً"),
  monthlyWageCeiling: z.string().regex(/^\d+(\.\d{1,2})?$/, "الحد الأقصى يجب أن يكون رقماً"),
  note: z.string().nullable().optional(),
});

export const payrollStatutoryFlagSchema = z.object({
  enabled: z.boolean(),
  changedBy: z.string().nullable(),
  changedAt: z.string().nullable(),
  acknowledged: z.boolean(),
  /** Codes of the statutory rows nobody has checked against the primary text. */
  unverifiedTableCodes: z.array(z.string()),
});

export const setPayrollStatutoryFlagSchema = z.object({
  enabled: z.boolean(),
  /** Required true to switch ON: the admin accepts that the figures are unverified. */
  acknowledged: z.boolean().optional(),
});

export type SocialInsuranceYearOverrideDTO = z.infer<typeof socialInsuranceYearOverrideSchema>;
export type UpsertSocialInsuranceYearDTO = z.infer<typeof upsertSocialInsuranceYearSchema>;
export type PayrollStatutoryFlagDTO = z.infer<typeof payrollStatutoryFlagSchema>;
export type SetPayrollStatutoryFlagDTO = z.infer<typeof setPayrollStatutoryFlagSchema>;
