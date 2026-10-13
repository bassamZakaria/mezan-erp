import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { runReport } from "./engine.js";
import { createInstallmentsOverdueReport } from "./installments-overdue.js";
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
    lines: [planLine()],
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
    branchId: null,
    active: true,
    priceListId: null,
    creditLimit: Money.zero(),
    taxExempt: false,
    taxExemptionRateId: null,
    etaBuyerType: "auto",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
    ...overrides,
  };
}

describe("createInstallmentsOverdueReport", () => {
  it("lists only unpaid lines with a due date before asOfDate, ranked by days late descending", () => {
    const definition = createInstallmentsOverdueReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22", bucket: "" },
      {
        plans: [
          plan({
            lines: [
              planLine({ no: 1, dueDate: "2026-02-01", paidAmount: Money.fromMajor("400.00"), status: "paid" }),
              planLine({ no: 2, dueDate: "2026-06-01" }),
              planLine({ no: 3, dueDate: "2026-08-10" }),
            ],
          }),
        ],
        customers: [customer()],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // line 1 is paid (excluded); line 2 (82 days late) and line 3 (12 days late) remain, most-late first.
    expect(outcome.rows.map((r) => r.lineId)).toEqual(["plan-1|2", "plan-1|3"]);
    expect(outcome.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(outcome.rows[0]?.daysLate).toBe(82);
    expect(outcome.rows[0]?.customerNameAr).toBe("عميل تجريبي");
  });

  it("filters by overdue bucket", () => {
    const definition = createInstallmentsOverdueReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22", bucket: "1to30" },
      { plans: [plan({ lines: [planLine({ no: 1, dueDate: "2026-08-10" })] })], customers: [customer()] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
  });

  it("excludes plans that are not confirmed", () => {
    const definition = createInstallmentsOverdueReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22", bucket: "" },
      { plans: [plan({ status: "cancelled" })], customers: [customer()] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("rejects an invalid asOfDate", () => {
    const definition = createInstallmentsOverdueReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "not-a-date", bucket: "" }, { plans: [plan()], customers: [customer()] });
    expect(outcome.ok).toBe(false);
  });
});
