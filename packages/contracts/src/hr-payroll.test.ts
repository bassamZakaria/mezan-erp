import { describe, it, expect } from "vitest";
import {
  employeeAdvanceStatusSchema,
  advanceInstallmentSchema,
  employeeAdvanceSchema,
  createEmployeeAdvanceSchema,
  treasuryDisbursementSchema,
  employeeAdvanceBalanceSchema,
  payrollRunStatusSchema,
  payslipLineKindSchema,
  payslipLineSourceSchema,
  payslipLineSchema,
  payslipSchema,
  payrollRunSchema,
  payrollRunDetailSchema,
  createPayrollRunSchema,
  payrollComponentKindSchema,
  payrollComponentSchema,
  createPayrollComponentSchema,
  updatePayrollComponentSchema,
} from "./hr-payroll.js";

describe("employeeAdvanceStatusSchema", () => {
  it("accepts each of the five known statuses", () => {
    for (const s of ["pending", "approved", "disbursed", "repaid", "rejected"]) {
      expect(employeeAdvanceStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(employeeAdvanceStatusSchema.safeParse("cancelled").success).toBe(false);
  });
});

describe("advanceInstallmentSchema", () => {
  const installment = { seq: 1, dueDate: "2026-09-01", amount: "500.123456", recovered: "0" };

  it("accepts a minimal valid installment and preserves every field verbatim", () => {
    const result = advanceInstallmentSchema.safeParse(installment);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(installment);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = advanceInstallmentSchema.safeParse({ ...installment, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = advanceInstallmentSchema.safeParse({ ...installment, amount: 500.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a zero or negative seq", () => {
    expect(advanceInstallmentSchema.safeParse({ ...installment, seq: 0 }).success).toBe(false);
    expect(advanceInstallmentSchema.safeParse({ ...installment, seq: -1 }).success).toBe(false);
  });
});

describe("employeeAdvanceSchema", () => {
  const advance = {
    id: "adv-1",
    number: "ADV-2026-001",
    employeeId: "emp-1",
    amount: "5000.000000",
    currency: "EGP",
    installmentCount: 5,
    firstDeductionDate: "2026-09-01",
    reason: "family emergency",
    installments: [],
    outstanding: "5000.000000",
    recovered: "0",
    status: "pending" as const,
    requestedAt: "2026-08-30T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    disbursedAt: null,
    disbursementVoucherId: null,
    disbursementJournalEntryId: null,
    repaidAt: null,
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid advance and preserves every field verbatim", () => {
    const result = employeeAdvanceSchema.safeParse(advance);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(advance);
  });

  it("rejects an out-of-enum status", () => {
    const result = employeeAdvanceSchema.safeParse({ ...advance, status: "cancelled" });
    expect(result.success).toBe(false);
  });

  it("rejects an advance missing employeeId", () => {
    const { employeeId, ...rest } = advance;
    const result = employeeAdvanceSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("employeeId");
  });
});

describe("createEmployeeAdvanceSchema", () => {
  const create = { employeeId: "emp-1", amount: "5000.000000", installmentCount: 5, firstDeductionDate: "2026-09-01" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createEmployeeAdvanceSchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("rejects a zero installmentCount", () => {
    const result = createEmployeeAdvanceSchema.safeParse({ ...create, installmentCount: 0 });
    expect(result.success).toBe(false);
  });

  it("silently strips status — an advance always starts pending, the caller cannot set it", () => {
    const result = createEmployeeAdvanceSchema.safeParse({ ...create, status: "approved" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("status");
  });
});

describe("treasuryDisbursementSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = treasuryDisbursementSchema.safeParse({ treasuryAccountId: "acc-cash", branchId: "branch-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing branchId", () => {
    const result = treasuryDisbursementSchema.safeParse({ treasuryAccountId: "acc-cash" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("rejects an out-of-enum paymentMethod", () => {
    const result = treasuryDisbursementSchema.safeParse({ treasuryAccountId: "acc-cash", branchId: "branch-1", paymentMethod: "crypto" });
    expect(result.success).toBe(false);
  });
});

describe("employeeAdvanceBalanceSchema", () => {
  const balance = { employeeId: "emp-1", outstanding: "2000.000000", advanceCount: 2 };

  it("accepts a minimal valid balance and preserves every field verbatim", () => {
    const result = employeeAdvanceBalanceSchema.safeParse(balance);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(balance);
  });

  it("rejects a negative advanceCount", () => {
    const result = employeeAdvanceBalanceSchema.safeParse({ ...balance, advanceCount: -1 });
    expect(result.success).toBe(false);
  });
});

describe("payrollRunStatusSchema", () => {
  it("accepts each of the five known statuses", () => {
    for (const s of ["draft", "calculated", "approved", "disbursed", "cancelled"]) {
      expect(payrollRunStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(payrollRunStatusSchema.safeParse("posted").success).toBe(false);
  });
});

describe("payslipLineKindSchema", () => {
  it("accepts earning, deduction and employer_contribution", () => {
    for (const k of ["earning", "deduction", "employer_contribution"]) {
      expect(payslipLineKindSchema.safeParse(k).success).toBe(true);
    }
  });

  it("rejects a kind outside the enum", () => {
    expect(payslipLineKindSchema.safeParse("bonus").success).toBe(false);
  });
});

describe("payslipLineSourceSchema", () => {
  it("accepts each of the five known sources", () => {
    for (const s of ["contract_basic", "contract_allowance", "contract_deduction", "unpaid_leave", "advance_recovery"]) {
      expect(payslipLineSourceSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a source outside the enum", () => {
    expect(payslipLineSourceSchema.safeParse("manual_entry").success).toBe(false);
  });
});

describe("payrollComponentKindSchema", () => {
  it("is an alias of payslipLineKindSchema and accepts the same values", () => {
    expect(payrollComponentKindSchema.safeParse("earning").success).toBe(true);
    expect(payrollComponentKindSchema.safeParse("bonus").success).toBe(false);
  });
});

describe("payslipLineSchema", () => {
  const line = { id: "pl-1", kind: "earning" as const, source: "contract_basic" as const, nameAr: "الراتب الأساسي", amount: "10000.000000", glAccountId: null, referenceId: null };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = payslipLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects an out-of-enum kind", () => {
    const result = payslipLineSchema.safeParse({ ...line, kind: "bonus" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum source", () => {
    const result = payslipLineSchema.safeParse({ ...line, source: "manual_entry" });
    expect(result.success).toBe(false);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = payslipLineSchema.safeParse({ ...line, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });
});

describe("payslipSchema", () => {
  const payslip = {
    id: "ps-1",
    number: "PS-2026-08-001",
    runId: "run-1",
    employeeId: "emp-1",
    contractId: "contract-1",
    currency: "EGP",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    periodDays: 31,
    paidDays: 31,
    lines: [],
    grossEarnings: "10000.000000",
    totalDeductions: "1000.000000",
    employerContributions: "1500.000000",
    netPay: "9000.000000",
    createdAt: "2026-09-01T10:00:00.000Z",
  };

  it("accepts a minimal valid payslip and preserves every field verbatim", () => {
    const result = payslipSchema.safeParse(payslip);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payslip);
  });

  it("rejects a zero or negative periodDays", () => {
    const result = payslipSchema.safeParse({ ...payslip, periodDays: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative paidDays", () => {
    const result = payslipSchema.safeParse({ ...payslip, paidDays: -1 });
    expect(result.success).toBe(false);
  });

  it("never coerces netPay to a float — high-precision decimal string survives verbatim", () => {
    const result = payslipSchema.safeParse({ ...payslip, netPay: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.netPay).toBe("0.100001");
  });
});

describe("payrollRunSchema", () => {
  const run = {
    id: "run-1",
    number: "PR-2026-08",
    year: 2026,
    month: 8,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    branchId: null,
    currency: "EGP",
    status: "draft" as const,
    employeeCount: 10,
    totalGross: "100000.000000",
    totalDeductions: "10000.000000",
    totalEmployerContributions: "15000.000000",
    totalNet: "90000.000000",
    unpaidLeaveSource: "provider" as const,
    warnings: [],
    journalEntryId: null,
    disbursementVoucherId: null,
    calculatedAt: null,
    approvedAt: null,
    approvedBy: null,
    disbursedAt: null,
    cancelledAt: null,
    createdAt: "2026-08-25T10:00:00.000Z",
  };

  it("accepts a minimal valid run and preserves every field verbatim", () => {
    const result = payrollRunSchema.safeParse(run);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(run);
  });

  it("rejects a month outside 1-12", () => {
    expect(payrollRunSchema.safeParse({ ...run, month: 0 }).success).toBe(false);
    expect(payrollRunSchema.safeParse({ ...run, month: 13 }).success).toBe(false);
  });

  it("rejects an out-of-enum status", () => {
    const result = payrollRunSchema.safeParse({ ...run, status: "posted" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum unpaidLeaveSource", () => {
    const result = payrollRunSchema.safeParse({ ...run, unpaidLeaveSource: "manual" });
    expect(result.success).toBe(false);
  });
});

describe("payrollRunDetailSchema", () => {
  it("extends payrollRunSchema with a payslips array", () => {
    const run = {
      id: "run-1",
      number: "PR-2026-08",
      year: 2026,
      month: 8,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      branchId: null,
      currency: "EGP",
      status: "draft" as const,
      employeeCount: 0,
      totalGross: "0",
      totalDeductions: "0",
      totalEmployerContributions: "0",
      totalNet: "0",
      unpaidLeaveSource: "none" as const,
      warnings: [],
      journalEntryId: null,
      disbursementVoucherId: null,
      calculatedAt: null,
      approvedAt: null,
      approvedBy: null,
      disbursedAt: null,
      cancelledAt: null,
      createdAt: "2026-08-25T10:00:00.000Z",
      payslips: [],
    };
    const result = payrollRunDetailSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it("rejects a detail missing payslips", () => {
    const run = {
      id: "run-1",
      number: "PR-2026-08",
      year: 2026,
      month: 8,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      branchId: null,
      currency: "EGP",
      status: "draft",
      employeeCount: 0,
      totalGross: "0",
      totalDeductions: "0",
      totalEmployerContributions: "0",
      totalNet: "0",
      unpaidLeaveSource: "none",
      warnings: [],
      journalEntryId: null,
      disbursementVoucherId: null,
      calculatedAt: null,
      approvedAt: null,
      approvedBy: null,
      disbursedAt: null,
      cancelledAt: null,
      createdAt: "2026-08-25T10:00:00.000Z",
    };
    const result = payrollRunDetailSchema.safeParse(run);
    expect(result.success).toBe(false);
  });
});

describe("createPayrollRunSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createPayrollRunSchema.safeParse({ year: 2026, month: 8 });
    expect(result.success).toBe(true);
  });

  it("rejects a month outside 1-12", () => {
    const result = createPayrollRunSchema.safeParse({ year: 2026, month: 13 });
    expect(result.success).toBe(false);
  });

  it("silently strips status and totals — a new run always starts as an empty draft", () => {
    const result = createPayrollRunSchema.safeParse({ year: 2026, month: 8, status: "approved", totalNet: "999999" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("status");
      expect(result.data).not.toHaveProperty("totalNet");
    }
  });
});

describe("payrollComponentSchema", () => {
  const component = {
    id: "comp-1",
    code: "BASIC",
    nameAr: "الراتب الأساسي",
    nameEn: null,
    kind: "earning" as const,
    glAccountId: "acc-salary-expense",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a minimal valid component and preserves every field verbatim", () => {
    const result = payrollComponentSchema.safeParse(component);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(component);
  });

  it("rejects an out-of-enum kind — payrollComponentKindSchema is an alias of payslipLineKindSchema", () => {
    const result = payrollComponentSchema.safeParse({ ...component, kind: "bonus" });
    expect(result.success).toBe(false);
  });
});

describe("createPayrollComponentSchema", () => {
  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createPayrollComponentSchema.safeParse({ code: "BASIC", nameAr: "الراتب الأساسي", kind: "earning" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing kind", () => {
    const result = createPayrollComponentSchema.safeParse({ code: "BASIC", nameAr: "الراتب الأساسي" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("kind");
  });
});

describe("updatePayrollComponentSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updatePayrollComponentSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updatePayrollComponentSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ active: false });
  });

  it("strips kind and code — both are immutable, omitted from the update schema", () => {
    const result = updatePayrollComponentSchema.safeParse({ kind: "deduction", code: "NEW-CODE" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("kind");
      expect(result.data).not.toHaveProperty("code");
    }
  });
});
