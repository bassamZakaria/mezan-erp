import { describe, it, expect, vi } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createInventoryStockHook } from "./inventory-stock-hook.js";
import type { StockLedgerService } from "../inventory/index.js";
import type { DocumentStockPlan } from "./hooks.js";
import { StockPlanDateRequiredError } from "./errors.js";

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
      date: "2026-08-22",
    };

    await hook.apply(plan);

    expect(applyDocumentStockPlan).toHaveBeenCalledTimes(1);
    expect(applyDocumentStockPlan).toHaveBeenCalledWith({
      sourceDocType: "SALES_RETURN",
      sourceDocId: "SR1",
      sourceDocNumber: "SR-000001",
      warehouseId: "WH1",
      lines: plan.lines,
      occurredAt: "2026-08-22T00:00:00.000Z",
    });
  });

  it("refuses a plan that carries no document date instead of stamping the wall clock", async () => {
    const applyDocumentStockPlan = vi.fn();
    const getMovementsOfDocument = vi.fn().mockResolvedValue([
      { itemId: "I1", warehouseId: "WH1", direction: "IN", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("10.00") },
    ]);
    const hook = createInventoryStockHook({ applyDocumentStockPlan, getMovementsOfDocument } as unknown as StockLedgerService);
    const undated: DocumentStockPlan = {
      sourceDocType: "SALES_RETURN",
      sourceDocId: "SR1",
      sourceDocNumber: "SR-000001",
      warehouseId: "WH1",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("5") }],
    };

    await expect(hook.apply(undated)).rejects.toThrow(StockPlanDateRequiredError);
    await expect(hook.reverse!(undated, "SR0")).rejects.toThrow(StockPlanDateRequiredError);
    expect(applyDocumentStockPlan).not.toHaveBeenCalled();
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
        date: "2026-08-22",
      }),
    ).rejects.toThrow("NEGATIVE_STOCK");
  });
});

/** guards B-10 — a reversed document's goods stayed on hand while the GL had been credited. */
describe("createInventoryStockHook.reverse", () => {
  const plan: DocumentStockPlan = {
    sourceDocType: "SALES_RETURN",
    sourceDocId: "SR1-REV",
    sourceDocNumber: "SR-000002",
    warehouseId: "WH1",
    lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("5") }],
    date: "2026-08-22",
  };

  it("mirrors every movement of the original at the cost it was recorded at", async () => {
    const applyDocumentStockPlan = vi.fn().mockResolvedValue({ valueMoved: Money.zero() });
    const getMovementsOfDocument = vi.fn().mockResolvedValue([
      { itemId: "I1", warehouseId: "WH9", direction: "OUT", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("40.00") },
      { itemId: "I2", warehouseId: "WH9", direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("15.50") },
      // A landed cost: value with no quantity. Nothing to give back.
      { itemId: "I3", warehouseId: "WH9", direction: "IN", qty: Qty.fromMajor("0"), unitCost: Money.zero() },
    ]);
    const service = { applyDocumentStockPlan, getMovementsOfDocument } as unknown as StockLedgerService;

    await createInventoryStockHook(service).reverse!(plan, "SR1");

    expect(getMovementsOfDocument).toHaveBeenCalledWith("SR1");
    const applied = applyDocumentStockPlan.mock.calls[0]![0];
    // Keyed to the REVERSING document, in the warehouse the goods actually moved in.
    expect(applied.sourceDocId).toBe("SR1-REV");
    expect(applied.warehouseId).toBe("WH9");
    expect(applied.lines).toHaveLength(2);
    expect(applied.lines[0].direction).toBe("IN");
    expect(applied.lines[0].unitCost.toString()).toBe("40.000000");
    expect(applied.lines[1].direction).toBe("OUT");
  });

  it("moves nothing when the original never moved stock", async () => {
    const applyDocumentStockPlan = vi.fn();
    const service = {
      applyDocumentStockPlan,
      getMovementsOfDocument: vi.fn().mockResolvedValue([]),
    } as unknown as StockLedgerService;

    const result = await createInventoryStockHook(service).reverse!(plan, "SR1");
    expect(applyDocumentStockPlan).not.toHaveBeenCalled();
    expect(result.valueMoved.toString()).toBe("0.000000");
  });

  it("returns an issue drawn from two warehouses to each of them, at the cost each left at", async () => {
    const applyDocumentStockPlan = vi.fn().mockResolvedValue({ valueMoved: Money.zero() });
    const service = {
      applyDocumentStockPlan,
      getMovementsOfDocument: vi.fn().mockResolvedValue([
        { itemId: "I1", warehouseId: "WH1", direction: "OUT", qty: Qty.fromMajor("12"), unitCost: Money.fromMajor("40.00") },
        { itemId: "I2", warehouseId: "WH2", direction: "OUT", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("7.50") },
      ]),
    } as unknown as StockLedgerService;

    await createInventoryStockHook(service).reverse!(plan, "INV1");

    const applied = applyDocumentStockPlan.mock.calls[0]![0];
    expect(applied.warehouseId).toBe("WH1");
    expect(applied.lines.map((l: { itemId: string; direction: string; qty: Qty; unitCost: Money; warehouseId?: string }) => [l.itemId, l.direction, l.qty.toString(), l.unitCost.toString(), l.warehouseId ?? "WH1"])).toEqual([
      ["I1", "IN", "12.000000", "40.000000", "WH1"],
      ["I2", "IN", "3.000000", "7.500000", "WH2"],
    ]);
  });

  it("refuses rather than guess when the original spanned two warehouses", async () => {
    const service = {
      applyDocumentStockPlan: vi.fn(),
      getMovementsOfDocument: vi.fn().mockResolvedValue([
        { itemId: "I1", warehouseId: "WH1", direction: "OUT", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("40.00") },
        { itemId: "I1", warehouseId: "WH2", direction: "IN", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("40.00") },
      ]),
    } as unknown as StockLedgerService;

    await expect(createInventoryStockHook(service).reverse!(plan, "TR1")).rejects.toThrow(
      "لا يمكن عكس حركة مخزنية موزّعة على أكثر من مستودع",
    );
  });
});
