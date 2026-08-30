import { describe, it, expect } from "vitest";
import {
  PAYROLL_RUN_STATUS_DEFINITIONS,
  getPayrollRunStatusLabel,
  ALLOWED_PAYROLL_RUN_TRANSITIONS,
  canTransitionPayrollRun,
  PAYROLL_GL_ACCOUNTS,
  PAYROLL_UNIMPLEMENTED_RULES,
  daysInPayrollMonth,
  payrollPeriodBounds,
  inclusiveDays,
  type PayrollRunStatus,
} from "./payroll-run.js";

describe("getPayrollRunStatusLabel", () => {
  it("returns the Arabic label for every defined status", () => {
    for (const def of PAYROLL_RUN_STATUS_DEFINITIONS) {
      expect(getPayrollRunStatusLabel(def.code)).toBe(def.labelAr);
    }
  });

  it("falls back to the raw code for an unknown status", () => {
    expect(getPayrollRunStatusLabel("bogus" as PayrollRunStatus)).toBe("bogus");
  });
});

describe("canTransitionPayrollRun", () => {
  it("allows every documented transition", () => {
    for (const [from, tos] of Object.entries(ALLOWED_PAYROLL_RUN_TRANSITIONS)) {
      for (const to of tos) {
        expect(canTransitionPayrollRun(from as PayrollRunStatus, to)).toBe(true);
      }
    }
  });

  it("draft can move to calculated or cancelled, never approved/disbursed", () => {
    expect(canTransitionPayrollRun("draft", "calculated")).toBe(true);
    expect(canTransitionPayrollRun("draft", "cancelled")).toBe(true);
    expect(canTransitionPayrollRun("draft", "approved")).toBe(false);
    expect(canTransitionPayrollRun("draft", "disbursed")).toBe(false);
  });

  it("calculated allows recalculation (self-loop), approval and cancellation", () => {
    expect(canTransitionPayrollRun("calculated", "calculated")).toBe(true);
    expect(canTransitionPayrollRun("calculated", "approved")).toBe(true);
    expect(canTransitionPayrollRun("calculated", "cancelled")).toBe(true);
    expect(canTransitionPayrollRun("calculated", "draft")).toBe(false);
  });

  it("approved only moves to disbursed", () => {
    expect(canTransitionPayrollRun("approved", "disbursed")).toBe(true);
    expect(canTransitionPayrollRun("approved", "cancelled")).toBe(false);
    expect(canTransitionPayrollRun("approved", "calculated")).toBe(false);
  });

  it("disbursed and cancelled are terminal", () => {
    for (const to of ["draft", "calculated", "approved", "disbursed", "cancelled"] as const) {
      expect(canTransitionPayrollRun("disbursed", to)).toBe(false);
      expect(canTransitionPayrollRun("cancelled", to)).toBe(false);
    }
  });
});

describe("daysInPayrollMonth", () => {
  it("returns 31/30 for ordinary months", () => {
    expect(daysInPayrollMonth(2026, 1)).toBe(31);
    expect(daysInPayrollMonth(2026, 4)).toBe(30);
    expect(daysInPayrollMonth(2026, 12)).toBe(31);
  });

  it("returns 29 for February in a leap year, 28 otherwise", () => {
    expect(daysInPayrollMonth(2024, 2)).toBe(29); // divisible by 4, not by 100
    expect(daysInPayrollMonth(2026, 2)).toBe(28);
    expect(daysInPayrollMonth(1900, 2)).toBe(28); // divisible by 100, not by 400
    expect(daysInPayrollMonth(2000, 2)).toBe(28 + 1); // divisible by 400 -> leap
  });
});

describe("payrollPeriodBounds", () => {
  it("returns the inclusive first/last day and day count for the month", () => {
    expect(payrollPeriodBounds(2026, 1)).toEqual({ start: "2026-01-01", end: "2026-01-31", days: 31 });
    expect(payrollPeriodBounds(2026, 4)).toEqual({ start: "2026-04-01", end: "2026-04-30", days: 30 });
    expect(payrollPeriodBounds(2024, 2)).toEqual({ start: "2024-02-01", end: "2024-02-29", days: 29 });
  });

  it("pads single-digit months and days", () => {
    expect(payrollPeriodBounds(2026, 3).start).toBe("2026-03-01");
  });
});

describe("inclusiveDays", () => {
  it("counts both endpoints", () => {
    expect(inclusiveDays("2026-01-01", "2026-01-31")).toBe(31);
  });

  it("is 1 for a single day", () => {
    expect(inclusiveDays("2026-01-15", "2026-01-15")).toBe(1);
  });

  it("is 0 when the range is empty (end before start)", () => {
    expect(inclusiveDays("2026-01-15", "2026-01-14")).toBe(0);
  });
});

describe("PAYROLL_GL_ACCOUNTS", () => {
  it("maps onto the standard COA leaves the module's doc comment names", () => {
    expect(PAYROLL_GL_ACCOUNTS).toEqual({
      salaryExpenseAccountId: "5120",
      salariesPayableAccountId: "2170",
      employeeAdvanceAccountId: "1160",
      deductionLiabilityAccountId: "2190",
      employerContributionExpenseAccountId: "5130",
      employerContributionLiabilityAccountId: "2190",
    });
  });
});

describe("PAYROLL_UNIMPLEMENTED_RULES", () => {
  it("documents every statutory/contractual gap this engine does not compute", () => {
    const codes = PAYROLL_UNIMPLEMENTED_RULES.map((r) => r.code);
    expect(codes).toEqual([
      "income_tax",
      "social_insurance",
      "seniority_bonus",
      "overtime",
      "end_of_service",
      "hourly_daily_basis",
      "pay_frequency",
      "multi_currency",
      "loans_garnishments",
    ]);
  });

  it("flags income tax, social insurance, seniority bonus, overtime and end-of-service as always-on gaps", () => {
    const alwaysOn = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => r.appliesToEveryPayslip).map((r) => r.code);
    expect(alwaysOn).toEqual(["income_tax", "social_insurance", "seniority_bonus", "overtime", "end_of_service"]);
  });

  it("flags hourly/daily basis, pay frequency, multi-currency and loans/garnishments as conditional gaps", () => {
    const conditional = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => !r.appliesToEveryPayslip).map((r) => r.code);
    expect(conditional).toEqual(["hourly_daily_basis", "pay_frequency", "multi_currency", "loans_garnishments"]);
  });
});
