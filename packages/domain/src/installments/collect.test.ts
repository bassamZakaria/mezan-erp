import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { collectInstallment, outstandingOf } from "./collect.js";
import {
  InstallmentPlanNotCollectableError,
  InstallmentLineNotCollectableError,
  InstallmentOverpaymentError,
} from "./errors.js";
import type { InstallmentLine, InstallmentPlanDocument } from "./installment-plan-document.js";

function line(no: number, amount: string, over: Partial<InstallmentLine> = {}): InstallmentLine {
  return {
    no,
    customerId: "cust-1",
    sourceInvoiceId: "inv-1",
    sourceInvoiceNumber: "INV-000001",
    frequency: "MONTHLY",
    downPayment: Money.zero(),
    dueDate: `2026-0${no}-01`,
    amount: Money.fromMajor(amount),
    paidAmount: Money.zero(),
    status: "pending",
    lateFeeAmount: Money.zero(),
    ...over,
  };
}

function plan(over: Partial<InstallmentPlanDocument> = {}): InstallmentPlanDocument {
  return {
    id: "plan-1",
    docType: "INSTALLMENT_PLAN",
    docNo: "IP-000001",
    date: "2026-01-01",
    memo: null,
    status: "confirmed",
    lines: [line(1, "100"), line(2, "100"), line(3, "100")],
    createdAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: "2026-01-01T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...over,
  } as InstallmentPlanDocument;
}

describe("collectInstallment — the money actually lands on the line (D119)", () => {
  it("settles the named installment and marks it paid", () => {
    const result = collectInstallment(plan(), { installmentNo: 2, amount: Money.fromMajor("100") });
    const settled = result.plan.lines.find((l) => l.no === 2);
    expect(settled?.paidAmount.toString()).toBe(Money.fromMajor("100").toString());
    expect(settled?.status).toBe("paid");
    expect(result.plan.lines.find((l) => l.no === 1)?.status).toBe("pending");
  });

  it("leaves a part-paid installment open, carrying what was received", () => {
    const result = collectInstallment(plan(), { installmentNo: 1, amount: Money.fromMajor("40") });
    const partial = result.plan.lines[0];
    expect(partial?.paidAmount.toString()).toBe(Money.fromMajor("40").toString());
    expect(partial?.status).toBe("pending");
    expect(outstandingOf(partial as InstallmentLine).toString()).toBe(Money.fromMajor("60").toString());
  });

  it("runs a round sum down the schedule oldest-first when no installment is named", () => {
    const result = collectInstallment(plan(), { amount: Money.fromMajor("250") });
    expect(result.plan.lines.map((l) => l.paidAmount.toString())).toEqual([
      Money.fromMajor("100").toString(),
      Money.fromMajor("100").toString(),
      Money.fromMajor("50").toString(),
    ]);
    expect(result.plan.lines.map((l) => l.status)).toEqual(["paid", "paid", "pending"]);
    expect(result.applied.map((a) => a.no)).toEqual([1, 2, 3]);
    expect(result.remaining.toString()).toBe(Money.fromMajor("50").toString());
  });

  it("collects an overdue installment — being late is not a reason to refuse the money", () => {
    const overdue = plan({ lines: [line(1, "100", { status: "overdue", lateFeeAmount: Money.zero() })] });
    const result = collectInstallment(overdue, { installmentNo: 1, amount: Money.fromMajor("100") });
    expect(result.plan.lines[0]?.status).toBe("paid");
  });

  it("refuses more than the plan still owes rather than parking a credit it cannot show", () => {
    expect(() => collectInstallment(plan(), { amount: Money.fromMajor("500") })).toThrow(InstallmentOverpaymentError);
  });

  it("refuses a collection against a draft plan", () => {
    expect(() =>
      collectInstallment(plan({ status: "draft" }), { amount: Money.fromMajor("10") }),
    ).toThrow(InstallmentPlanNotCollectableError);
  });

  it("refuses a zero or negative amount", () => {
    expect(() => collectInstallment(plan(), { amount: Money.zero() })).toThrow(InstallmentLineNotCollectableError);
  });

  it("refuses an installment that is already paid, and one that was cancelled", () => {
    const settled = plan({ lines: [line(1, "100", { status: "paid", paidAmount: Money.fromMajor("100") })] });
    expect(() =>
      collectInstallment(settled, { installmentNo: 1, amount: Money.fromMajor("10") }),
    ).toThrow(InstallmentLineNotCollectableError);

    const cancelled = plan({ lines: [line(1, "100", { status: "cancelled" })] });
    expect(() =>
      collectInstallment(cancelled, { installmentNo: 1, amount: Money.fromMajor("10") }),
    ).toThrow(InstallmentLineNotCollectableError);
  });

  it("refuses an installment number the plan does not carry", () => {
    expect(() =>
      collectInstallment(plan(), { installmentNo: 9, amount: Money.fromMajor("10") }),
    ).toThrow(InstallmentLineNotCollectableError);
  });

  it("settles the late fee before the installment is called paid", () => {
    const withFee = plan({ lines: [line(1, "100", { status: "overdue", lateFeeAmount: Money.fromMajor("10") })] });
    const part = collectInstallment(withFee, { installmentNo: 1, amount: Money.fromMajor("100") });
    expect(part.plan.lines[0]?.status).toBe("overdue");
    const rest = collectInstallment(part.plan, { installmentNo: 1, amount: Money.fromMajor("10") });
    expect(rest.plan.lines[0]?.status).toBe("paid");
  });

  it("never mutates the plan it was given", () => {
    const before = plan();
    collectInstallment(before, { amount: Money.fromMajor("300") });
    expect(before.lines.every((l) => l.paidAmount.scaled === 0n)).toBe(true);
    expect(before.lines.every((l) => l.status === "pending")).toBe(true);
  });

  it("reports the invoice and customer the voucher must be raised against", () => {
    const result = collectInstallment(plan(), { amount: Money.fromMajor("100") });
    expect(result.sourceInvoiceId).toBe("inv-1");
    expect(result.customerId).toBe("cust-1");
  });
});
