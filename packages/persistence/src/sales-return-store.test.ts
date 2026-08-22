import { describe, it, expect } from "vitest";
import { Money, Qty, type SalesReturnLine } from "@mezan/domain";
import { createStandaloneSqliteSalesReturnStore } from "./sales-return-store.js";

function line(): SalesReturnLine {
  return {
    itemId: "ITEM1",
    warehouseId: "WH1",
    customerId: "CUST1",
    sourceInvoiceId: "INV1",
    sourceInvoiceNumber: "INV-000014",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor("5"),
    qty: Qty.fromMajor("2"),
    unitPrice: Money.fromMajor("100"),
    unitCost: Money.fromMajor("60"),
    taxAmount: Money.fromMajor("28"),
  };
}

describe("createStandaloneSqliteSalesReturnStore", () => {
  it("round-trips a document losslessly, including Money/Qty precision", async () => {
    const store = createStandaloneSqliteSalesReturnStore();
    try {
      await store.save({
        id: "SR1",
        docType: "SALES_RETURN",
        docNo: null,
        date: "2026-08-21",
        memo: "test",
        status: "draft",
        lines: [line()],
        createdAt: "2026-08-21T00:00:00.000Z",
        confirmedAt: null,
        reversesDocId: null,
        reversedByDocId: null,
        workflowRequestId: null,
        journalEntryId: null,
      });

      const found = await store.findById("SR1");
      expect(found).toBeTruthy();
      expect(found?.lines[0]?.qty.toString()).toBe("2.000000");
      expect(found?.lines[0]?.unitCost.toString()).toBe("60.000000");
      expect(found?.lines[0]?.reason).toBe("DEFECTIVE");

      await store.update({ ...(found as NonNullable<typeof found>), status: "confirmed", docNo: "SRT-000001" });
      const confirmed = await store.findById("SR1");
      expect(confirmed?.status).toBe("confirmed");
      expect(confirmed?.docNo).toBe("SRT-000001");

      const listed = await store.list({ status: "confirmed" });
      expect(listed).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
