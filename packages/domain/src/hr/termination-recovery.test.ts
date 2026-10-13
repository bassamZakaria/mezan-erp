import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { Payslip, PayslipLine } from "./payroll-run.js";
import { payslipOverpaymentAfter, payslipPaidSpan } from "./termination-recovery.js";

const september = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };

function line(source: PayslipLine["source"], amount: string, kind: PayslipLine["kind"] = "earning"): PayslipLine {
  return { id: `${source}-${amount}`, kind, source, nameAr: source, amount: Money.fromMajor(amount), glAccountId: null, referenceId: null, capped: false };
}

function slip(paidDays: number, lines: readonly PayslipLine[], periodDays = 30): Pick<Payslip, "id" | "periodDays" | "paidDays" | "lines" | "basis"> {
  return { id: "PS", periodDays, paidDays, lines, basis: null };
}

describe("the days a payslip paid for", () => {
  it("a contract that ended on the fifteenth was paid to the fifteenth, not to the month end", () => {
    expect(payslipPaidSpan({ ...september, paidDays: 15 }, "2024-01-01", "2025-09-16")).toEqual({ paidStart: "2026-09-01", paidThrough: "2026-09-15" });
  });

  it("a joiner on the sixteenth was paid from the sixteenth to the month end", () => {
    expect(payslipPaidSpan({ ...september, paidDays: 15 }, "2026-09-16", "2026-09-16")).toEqual({ paidStart: "2026-09-16", paidThrough: "2026-09-30" });
  });

  it("a full month was paid to its last day", () => {
    expect(payslipPaidSpan({ ...september, paidDays: 30 }, "2020-01-01", null)).toEqual({ paidStart: "2026-09-01", paidThrough: "2026-09-30" });
  });
});

describe("what a payslip paid for days after the last day of service", () => {
  const full = { paidStart: "2026-09-01", paidThrough: "2026-09-30" };
  const lines = [line("contract_basic", "9000"), line("contract_allowance", "600"), line("overtime", "450"), line("income_tax", "300", "deduction")];

  it("is nothing when the last day is the last paid day or later", () => {
    expect(payslipOverpaymentAfter(slip(30, lines), full, "2026-09-30", "FIXED_30")).toBeNull();
    expect(payslipOverpaymentAfter(slip(15, lines), { paidStart: "2026-09-01", paidThrough: "2026-09-15" }, "2026-09-15", "FIXED_30")).toBeNull();
  });

  it("prices the unworked days on basic pay and allowances only, never on overtime or deductions", () => {
    const owed = payslipOverpaymentAfter(slip(30, lines), full, "2026-09-12", "FIXED_30");
    expect(owed?.days).toBe(18);
    expect(owed?.lines.map((l) => l.amount.toString())).toEqual(["5400.000000", "360.000000"]);
  });

  it("is the whole of the time-based pay when the last day is before the payslip began", () => {
    const owed = payslipOverpaymentAfter(slip(30, lines), full, "2026-08-20", "FIXED_30");
    expect(owed?.days).toBe(30);
    expect(owed?.lines.map((l) => l.amount.toString())).toEqual(["9000.000000", "600.000000"]);
  });

  it("on a calendar-day divisor the thirty-first day of a month is a day of pay; on a 30-day divisor it is not", () => {
    const july = { paidStart: "2026-07-01", paidThrough: "2026-07-31" };
    expect(payslipOverpaymentAfter(slip(31, [line("contract_basic", "9300")], 31), july, "2026-07-30", "CALENDAR_DAYS")?.lines[0]?.amount.toString()).toBe("300.000000");
    expect(payslipOverpaymentAfter(slip(31, [line("contract_basic", "9300")], 31), july, "2026-07-30", "FIXED_30")).toBeNull();
  });

  it("an attendance-based contract is owed nothing back: its pay stopped with its attendance", () => {
    const hourly = { ...slip(30, lines), basis: { payBasis: "hourly" } as Payslip["basis"] };
    expect(payslipOverpaymentAfter(hourly, full, "2026-09-12", "FIXED_30")).toBeNull();
  });
});
