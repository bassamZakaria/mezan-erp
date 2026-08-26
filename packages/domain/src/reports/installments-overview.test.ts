import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInstallmentsOverviewReport } from "./installments-overview.js";
import type { InstallmentLine, InstallmentPlanDocument } from "../installments/index.js";
import type { Customer } from "../customers/customer.js";

function planLine(overrides: Partial<InstallmentLine> = {}): InstallmentLine {
  return {
    no: 1,
    customerId: "cust-1",
    sourceInvoiceId: "inv-1",
    sourceInvoiceNumber: "INV-000001",
    frequency: "MONTHLY",
    downPayment: Money.zero(),
    dueDate: "2026-02-01",
    amount: Money.fromMajor("400.00"),
    paidAmount: Money.zero(),
    status: "pending",
    lateFeeAmount: Money.zero(),
    ...overrides,
  };
}

function plan(overrides: Partial<InstallmentPlanDocument> = {}): InstallmentPlanDocument {
  return {
    id: "plan-1",
    docType: "INSTALLMENT_PLAN",
    docNo: "IP-000001",
    date: "2026-01-01",
    memo: "خطة أقساط",
    status: "confirmed",
    lines: [
      planLine({ no: 1, dueDate: "2026-02-01", paidAmount: Money.fromMajor("400.00"), status: "paid" }),
      planLine({ no: 2, dueDate: "2026-03-01" }),
      planLine({ no: 3, dueDate: "2026-04-01" }),
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    confirmedAt: "2026-01-01T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    code: "C001",
    nameAr: "عميل تجريبي",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 0,
    currency: "EGP",
    openingBalance: Money.zero(),
    active: true,
    priceListId: null,
    creditLimit: Money.zero(),
    taxExempt: false,
    etaBuyerType: "auto",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
    ...overrides,
  };
}

describe("createInstallmentsOverviewReport", () => {
  it("computes plan totals (Σ amount + downPayment) and percent paid from the denormalized lines", () => {
    const definition = createInstallmentsOverviewReport("2026-08-22");
    const outcome = runReport(definition, {}, { plans: [plan()], customers: [customer()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.totalAmount).toBe(1200);
    expect(outcome.rows[0]?.remaining).toBe(800);
    expect(outcome.rows[0]?.percentPaid).toBeCloseTo(33.333, 2);
    expect(outcome.rows[0]?.installmentsCount).toBe(3);
    expect(outcome.rows[0]?.customerNameAr).toBe("عميل تجريبي");
  });

  it("counts unpaid lines past due as of the report date", () => {
    const definition = createInstallmentsOverviewReport("2026-08-22");
    const outcome = runReport(definition, {}, { plans: [plan()], customers: [customer()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // line 1 is paid (excluded); lines 2 and 3 are both before 2026-08-22.
    expect(outcome.rows[0]?.overdueCount).toBe(2);
  });

  it("excludes plans that are not confirmed (draft/cancelled/reversed)", () => {
    const definition = createInstallmentsOverviewReport("2026-08-22");
    const outcome = runReport(
      definition,
      {},
      { plans: [plan({ id: "p-draft", status: "draft" }), plan({ id: "p-cancelled", status: "cancelled" })], customers: [customer()] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("labels a fully-paid plan مكتملة and sorts by remaining balance descending", () => {
    const definition = createInstallmentsOverviewReport("2026-08-22");
    const outcome = runReport(
      definition,
      {},
      {
        plans: [
          plan({ id: "p-small", docNo: "IP-000002", lines: [planLine({ no: 1, amount: Money.fromMajor("100.00") })] }),
          plan({ id: "p-paid", docNo: "IP-000003", lines: [planLine({ no: 1, amount: Money.fromMajor("500.00"), paidAmount: Money.fromMajor("500.00"), status: "paid" })] }),
        ],
        customers: [customer()],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.planId)).toEqual(["p-small", "p-paid"]);
    expect(outcome.rows[1]?.statusLabel).toBe("مكتملة");
  });
});
