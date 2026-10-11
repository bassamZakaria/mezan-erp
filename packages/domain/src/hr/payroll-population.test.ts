import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { Contract } from "./contract.js";
import { PayrollExclusionReason, inServiceDuring, payrollEligibility, type PayrollCapabilities } from "./payroll-population.js";

const JUNE = { periodStart: "2026-06-01", periodEnd: "2026-06-30" };
const CAN: PayrollCapabilities = { attendanceBound: false, runCurrency: "EGP", canConvertCurrency: false };

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: "CT-1", number: "CTR-0001", employeeId: "E1", type: "indefinite", payBasis: "monthly", payFrequency: "monthly",
    startDate: "2026-01-01", endDate: null, monthlySalary: Money.fromMajor("9000.00"), currency: "EGP",
    leaveEntitlement: { annualLeaveDays: null, sickLeaveDays: null, personalLeaveDays: null }, allowances: [], deductions: [],
    status: "active", terminatedAt: null, createdAt: "2026-01-01T00:00:00.000Z", ...over,
  };
}
const active = { hireDate: "2026-01-01", status: "active" as const, terminatedAt: null };
const leftOn = (day: string) => ({ hireDate: "2026-01-01", status: "terminated" as const, terminatedAt: day });

describe("inServiceDuring — who a month's payroll is for", () => {
  it("is anyone hired by the month's end who had not left before it began, whatever their status today", () => {
    expect(inServiceDuring(active, JUNE)).toBe(true);
    expect(inServiceDuring({ ...active, status: "suspended" }, JUNE)).toBe(true);
    expect(inServiceDuring({ ...active, hireDate: "2026-07-01" }, JUNE)).toBe(false);
    expect(inServiceDuring(leftOn("2026-08-20"), JUNE)).toBe(true);
    expect(inServiceDuring(leftOn("2026-06-12"), JUNE)).toBe(true);
    expect(inServiceDuring(leftOn("2026-06-01"), JUNE)).toBe(true);
    expect(inServiceDuring(leftOn("2026-05-31"), JUNE)).toBe(false);
  });

  it("reads a termination stamped as an instant by its day, and a termination with no date as not in service", () => {
    expect(inServiceDuring(leftOn("2026-06-12T19:21:15.000Z"), JUNE)).toBe(true);
    expect(inServiceDuring({ ...active, status: "terminated", terminatedAt: null }, JUNE)).toBe(false);
  });
});

describe("payrollEligibility — the one answer the run and the period close both read", () => {
  it("pays the whole month to someone who left after it, and to the last day of service for someone who left inside it", () => {
    expect(payrollEligibility(leftOn("2026-08-20"), [contract()], JUNE, CAN)).toMatchObject({ payable: true, paidStart: "2026-06-01", paidEnd: "2026-06-30", paidDays: 30 });
    expect(payrollEligibility(leftOn("2026-06-12"), [contract()], JUNE, CAN)).toMatchObject({ payable: true, paidStart: "2026-06-01", paidEnd: "2026-06-12", paidDays: 12 });
  });

  it("starts a joiner on the later of the hire date and the contract's start", () => {
    expect(payrollEligibility({ ...active, hireDate: "2026-06-10" }, [contract({ startDate: "2026-06-16" })], JUNE, CAN)).toMatchObject({ payable: true, paidStart: "2026-06-16", paidDays: 15 });
  });

  it("still finds a contract that was terminated after the month began, and stops paying on the day it ended", () => {
    const ended = contract({ status: "terminated", terminatedAt: "2026-06-20T08:00:00.000Z" });
    expect(payrollEligibility(active, [ended], JUNE, CAN)).toMatchObject({ payable: true, paidEnd: "2026-06-20", paidDays: 20 });
    expect(payrollEligibility(active, [contract({ status: "terminated", terminatedAt: "2026-05-20" })], JUNE, CAN)).toEqual({ payable: false, reason: PayrollExclusionReason.NoContract, contract: null });
  });

  it("names why someone is left out: not in service, no contract, attendance not bound, another currency", () => {
    const reason = (...args: Parameters<typeof payrollEligibility>) => {
      const result = payrollEligibility(...args);
      return result.payable ? null : result.reason;
    };
    expect(reason(leftOn("2026-05-31"), [contract()], JUNE, CAN)).toBe(PayrollExclusionReason.NotInService);
    expect(reason(active, [], JUNE, CAN)).toBe(PayrollExclusionReason.NoContract);
    expect(reason(active, [contract({ endDate: "2026-05-31", type: "fixed_term" })], JUNE, CAN)).toBe(PayrollExclusionReason.NoContract);
    expect(reason(active, [contract({ payBasis: "daily" })], JUNE, CAN)).toBe(PayrollExclusionReason.NeedsAttendance);
    expect(reason(active, [contract({ payBasis: "daily" })], JUNE, { ...CAN, attendanceBound: true })).toBeNull();
    expect(reason(active, [contract({ currency: "USD" })], JUNE, CAN)).toBe(PayrollExclusionReason.CurrencyMismatch);
    expect(reason(active, [contract({ currency: "USD" })], JUNE, { ...CAN, canConvertCurrency: true })).toBeNull();
  });
});
