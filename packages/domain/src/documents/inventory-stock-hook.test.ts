import { describe, it, expect, vi } from "vitest";
import { Qty } from "../money/index.js";
import { createInventoryStockHook } from "./inventory-stock-hook.js";
import type { StockLedgerService } from "../inventory/index.js";
import type { DocumentStockPlan } from "./hooks.js";

describe("createInventoryStockHook", () => {
  it("forwards the framework's generic plan into applyDocumentStockPlan with the sourceDocType narrowed", async () => {
    const applyDocumentStockPlan = vi.fn().mockResolvedValue(undefined);
    const service = { applyDocumentStockPlan } as unknown as StockLedgerService;
    const hook = createInventoryStockHook(service);

    const plan: DocumentStockPlan = {
      sourceDocType: "SALES_RETURN",
      sourceDocId: "SR1",
      sourceDocNumber: "SR-000001",
      warehouseId: "WH1",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("5") }],
    };

    await hook.apply(plan);

    expect(applyDocumentStockPlan).toHaveBeenCalledTimes(1);
    expect(applyDocumentStockPlan).toHaveBeenCalledWith({
      sourceDocType: "SALES_RETURN",
      sourceDocId: "SR1",
      sourceDocNumber: "SR-000001",
      warehouseId: "WH1",
      lines: plan.lines,
    });
  });

  it("propagates a rejection from the underlying stock-ledger service (e.g. negative stock)", async () => {
    const applyDocumentStockPlan = vi.fn().mockRejectedValue(new Error("NEGATIVE_STOCK"));
    const service = { applyDocumentStockPlan } as unknown as StockLedgerService;
    const hook = createInventoryStockHook(service);

    await expect(
      hook.apply({
        sourceDocType: "SALES_INVOICE",
        sourceDocId: "INV1",
        sourceDocNumber: "INV-000001",
        warehouseId: "WH1",
        lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("999") }],
      }),
    ).rejects.toThrow("NEGATIVE_STOCK");
  });
});
