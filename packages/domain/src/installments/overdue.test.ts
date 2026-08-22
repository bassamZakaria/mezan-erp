import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { processOverdueInstallments } from "./overdue.js";
import type { InstallmentLine, InstallmentPlanDocument } from "./installment-plan-document.js";

function planLine(overrides: Partial<InstallmentLine> = {}): InstallmentLine {
  return {
    no: 1,
    customerId: "CUST1",
    sourceInvoiceId: "INV1",
    sourceInvoiceNumber: "INV-000014",
    frequency: "MONTHLY",
    downPayment: Money.zero(),
    dueDate: "2026-08-21",
    amount: Money.fromMajor("62.50"),
    paidAmount: Money.zero(),
    status: "pending",
    lateFeeAmount: Money.zero(),
    ...overrides,
  };
}

function plan(lines: InstallmentLine[], status: InstallmentPlanDocument["status"] = "confirmed"): InstallmentPlanDocument {
  return {
    id: "IP1",
    docType: "INSTALLMENT_PLAN",
    docNo: "IP-000001",
    date: "2026-08-21",
    memo: "",
    status,
    lines,
    createdAt: "2026-08-21T00:00:00.000Z",
    confirmedAt: "2026-08-21T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

describe("processOverdueInstallments", () => {
  it("flips pending installments past their due date to overdue, leaves the rest alone", () => {
    const p = plan([
      planLine({ no: 1, dueDate: "2026-08-21", status: "pending" }), // past due as of 2026-09-01
      planLine({ no: 2, dueDate: "2026-09-21", status: "pending" }), // not yet due
      planLine({ no: 3, dueDate: "2026-07-21", status: "paid" }), // already paid — untouched even though past due
    ]);

    const result = processOverdueInstallments([p], "2026-09-01");

    expect(result.newlyOverdueCount).toBe(1);
    const updated = result.updatedPlans[0] as InstallmentPlanDocument;
    expect(updated.lines[0]?.status).toBe("overdue");
    expect(updated.lines[1]?.status).toBe("pending");
    expect(updated.lines[2]?.status).toBe("paid");
  });

  it("is a no-op for plans that aren't confirmed", () => {
    const p = plan([planLine({ dueDate: "2026-01-01", status: "pending" })], "draft");
    const result = processOverdueInstallments([p], "2026-09-01");
    expect(result.newlyOverdueCount).toBe(0);
    expect(result.updatedPlans[0]).toBe(p); // same reference — untouched
  });

  it("late fees are stubbed at exactly zero (documented TODO — no config exists yet)", () => {
    const p = plan([planLine({ dueDate: "2026-01-01", status: "pending" })]);
    const result = processOverdueInstallments([p], "2026-09-01", { feePercent: 5, graceDays: 3 });
    expect(result.totalLateFeesApplied.toString()).toBe("0.000000");
    expect(result.updatedPlans[0]?.lines[0]?.lateFeeAmount.toString()).toBe("0.000000");
  });

  it("does not mutate the input plans (pure)", () => {
    const original = plan([planLine({ dueDate: "2026-01-01", status: "pending" })]);
    const snapshotStatus = original.lines[0]?.status;
    processOverdueInstallments([original], "2026-09-01");
    expect(original.lines[0]?.status).toBe(snapshotStatus);
  });
});
