import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { generateInstallmentSchedule } from "./schedule.js";
import { InvalidInstallmentScheduleError } from "./errors.js";

describe("generateInstallmentSchedule", () => {
  it("matches the catalog's worked example: 375.00, 6 monthly, no down payment, start 2026-08-21", () => {
    const schedule = generateInstallmentSchedule({
      invoiceTotal: Money.fromMajor("375"),
      downPayment: Money.zero(),
      installmentCount: 6,
      frequency: "MONTHLY",
      startDate: "2026-08-21",
    });

    expect(schedule.remainingAmount.toString()).toBe("375.000000");
    expect(schedule.installments).toHaveLength(6);
    for (const installment of schedule.installments) {
      expect(installment.amount.toString()).toBe("62.500000");
    }
    expect(schedule.installments.map((i) => i.dueDate)).toEqual([
      "2026-08-21",
      "2026-09-21",
      "2026-10-21",
      "2026-11-21",
      "2026-12-21",
      "2027-01-21",
    ]);
    // Running balance counts down to exactly 0.00 on the final installment.
    expect(schedule.installments.at(-1)?.remainingAfter.toString()).toBe("0.000000");
  });

  it("subtracts the down payment from what gets scheduled", () => {
    const schedule = generateInstallmentSchedule({
      invoiceTotal: Money.fromMajor("1000"),
      downPayment: Money.fromMajor("200"),
      installmentCount: 4,
      frequency: "MONTHLY",
      startDate: "2026-01-01",
    });
    expect(schedule.remainingAmount.toString()).toBe("800.000000");
    expect(Money.sum(schedule.installments.map((i) => i.amount)).toString()).toBe("800.000000");
  });

  it("reconciles exactly under a non-divisible total (largest-remainder rounding)", () => {
    const schedule = generateInstallmentSchedule({
      invoiceTotal: Money.fromMajor("100"),
      downPayment: Money.zero(),
      installmentCount: 3,
      frequency: "WEEKLY",
      startDate: "2026-01-01",
    });
    const sum = Money.sum(schedule.installments.map((i) => i.amount));
    expect(sum.toString()).toBe("100.000000");
    expect(schedule.installments.map((i) => i.dueDate)).toEqual(["2026-01-01", "2026-01-08", "2026-01-15"]);
  });

  it("advances biweekly/quarterly frequencies correctly", () => {
    const biweekly = generateInstallmentSchedule({
      invoiceTotal: Money.fromMajor("200"),
      downPayment: Money.zero(),
      installmentCount: 2,
      frequency: "BIWEEKLY",
      startDate: "2026-01-01",
    });
    expect(biweekly.installments.map((i) => i.dueDate)).toEqual(["2026-01-01", "2026-01-15"]);

    const quarterly = generateInstallmentSchedule({
      invoiceTotal: Money.fromMajor("200"),
      downPayment: Money.zero(),
      installmentCount: 2,
      frequency: "QUARTERLY",
      startDate: "2026-01-01",
    });
    expect(quarterly.installments.map((i) => i.dueDate)).toEqual(["2026-01-01", "2026-04-01"]);
  });

  it("rejects a down payment greater than the invoice total", () => {
    expect(() =>
      generateInstallmentSchedule({
        invoiceTotal: Money.fromMajor("100"),
        downPayment: Money.fromMajor("150"),
        installmentCount: 3,
        frequency: "MONTHLY",
        startDate: "2026-01-01",
      }),
    ).toThrow(InvalidInstallmentScheduleError);
  });

  it("rejects zero/negative installment counts", () => {
    expect(() =>
      generateInstallmentSchedule({
        invoiceTotal: Money.fromMajor("100"),
        downPayment: Money.zero(),
        installmentCount: 0,
        frequency: "MONTHLY",
        startDate: "2026-01-01",
      }),
    ).toThrow(InvalidInstallmentScheduleError);
  });
});
