import { describe, it, expect } from "vitest";
import { Money, generateInstallmentSchedule, type InstallmentLine } from "@mezan/domain";
import { createStandaloneSqliteInstallmentPlanStore } from "./installment-plan-store.js";

describe("createStandaloneSqliteInstallmentPlanStore", () => {
  it("round-trips a generated schedule losslessly", async () => {
    const store = createStandaloneSqliteInstallmentPlanStore();
    try {
      const schedule = generateInstallmentSchedule({
        invoiceTotal: Money.fromMajor("375"),
        downPayment: Money.zero(),
        installmentCount: 6,
        frequency: "MONTHLY",
        startDate: "2026-08-21",
      });
      const lines: InstallmentLine[] = schedule.installments.map((i) => ({
        no: i.no,
        customerId: "CUST1",
        sourceInvoiceId: "INV1",
        sourceInvoiceNumber: "INV-000014",
        frequency: "MONTHLY",
        downPayment: schedule.downPayment,
        dueDate: i.dueDate,
        amount: i.amount,
        paidAmount: Money.zero(),
        status: "pending",
        lateFeeAmount: Money.zero(),
      }));

      await store.save({
        id: "IP1",
        docType: "INSTALLMENT_PLAN",
        docNo: null,
        date: "2026-08-21",
        memo: "",
        status: "draft",
        lines,
        createdAt: "2026-08-21T00:00:00.000Z",
        confirmedAt: null,
        reversesDocId: null,
        reversedByDocId: null,
        workflowRequestId: null,
        journalEntryId: null,
      });

      const found = await store.findById("IP1");
      expect(found?.lines).toHaveLength(6);
      expect(found?.lines[0]?.amount.toString()).toBe("62.500000");
      expect(found?.lines[0]?.dueDate).toBe("2026-08-21");
      expect(found?.lines.at(-1)?.dueDate).toBe("2027-01-21");
    } finally {
      store.close();
    }
  });
});
