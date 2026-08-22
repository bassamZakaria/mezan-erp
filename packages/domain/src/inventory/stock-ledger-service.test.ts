import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { NegativeStockError, InvalidStockMovementError } from "./errors.js";
import type { InventoryDomainEvent, InventoryGlPosting } from "./ports.js";
import {
  InMemoryStockLedger,
  InMemoryCostLayers,
  InMemorySnapshots,
} from "./test-helpers/in-memory-stores.js";

function build(policy = { allowNegativeStock: false }) {
  const ledger = new InMemoryStockLedger();
  const layers = new InMemoryCostLayers();
  const snapshots = new InMemorySnapshots();
  const events: InventoryDomainEvent[] = [];
  const postings: InventoryGlPosting[] = [];
  let clockTick = 0;
  const service = new StockLedgerService({
    ledger,
    layers,
    snapshots,
    policy,
    events: { publish: (e) => events.push(e) },
    gl: { post: async (p) => void postings.push(p) },
    clock: () => `2026-02-01T00:00:${String(clockTick++).padStart(2, "0")}.000Z`,
  });
  return { service, ledger, layers, snapshots, events, postings };
}

describe("StockLedgerService — receipts, issues, weighted average", () => {
  it("maintains a cached snapshot equal to a full ledger replay", async () => {
    const { service } = build();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ2",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("7") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ3",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("5") }],
    });

    const detail = await service.getBalanceDetail("I1", "W1");
    expect(detail.onHand.toString()).toBe("15.000000");
    expect(detail.averageCost.toString()).toBe("6.000000");
    expect(detail.totalValue.toString()).toBe("90.000000");

    // Cache must equal replay exactly → zero cache drift.
    const drift = await service.checkDriftFor("I1", "W1");
    expect(drift.cacheDrift.toString()).toBe("0.000000");
    expect(drift.withinTolerance).toBe(true);
  });

  it("emits StockMoved with the post-move on-hand and average", async () => {
    const { service, events } = build();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("2.5") }],
    });
    const moved = events.find((e) => e.type === "StockMoved");
    expect(moved).toBeDefined();
    if (moved?.type === "StockMoved") {
      expect(moved.onHandAfter.toString()).toBe("4.000000");
      expect(moved.averageCostAfter.toString()).toBe("2.500000");
      expect(moved.movement.sourceDocType).toBe("ADJUSTMENT");
    }
    expect(events.some((e) => e.type === "StockAdjustmentPosted")).toBe(true);
  });
});

describe("StockLedgerService — negative-stock guard (policy)", () => {
  it("rejects an issue below zero when allowNegativeStock is off", async () => {
    const { service } = build({ allowNegativeStock: false });
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("3") }],
    });
    await expect(
      service.postAdjustment({
        adjustmentId: "ADJ2",
        warehouseId: "W1",
        reason: "SHORTAGE",
        lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("10") }],
      }),
    ).rejects.toBeInstanceOf(NegativeStockError);
    // Balance untouched (transaction-style: the whole adjustment failed).
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("5.000000");
  });

  it("permits negative stock when the policy allows it", async () => {
    const { service } = build({ allowNegativeStock: true });
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("3") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ2",
      warehouseId: "W1",
      reason: "SHORTAGE",
      lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("8") }],
    });
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("-3.000000");
  });
});

describe("StockLedgerService — adjustment validation & GL posting", () => {
  it("rejects a line whose direction contradicts the reason", async () => {
    const { service } = build();
    await expect(
      service.postAdjustment({
        adjustmentId: "ADJ1",
        warehouseId: "W1",
        reason: "INITIAL_STOCK", // IN-only
        lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("1") }],
      }),
    ).rejects.toBeInstanceOf(InvalidStockMovementError);
  });

  it("posts a balanced Dr Inventory / Cr counterpart entry for a value increase", async () => {
    const { service, postings } = build();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      adjustmentNumber: "ADJ-000015",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
      gl: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
    });
    expect(postings).toHaveLength(1);
    const p = postings[0] as InventoryGlPosting;
    const dr = p.lines.find((l) => l.debit.scaled > 0n);
    const cr = p.lines.find((l) => l.credit.scaled > 0n);
    expect(dr?.accountId).toBe("1200");
    expect(dr?.debit.toString()).toBe("50.000000");
    expect(cr?.accountId).toBe("5900");
    expect(cr?.credit.toString()).toBe("50.000000");
  });
});

describe("StockLedgerService — opening balance (INITIAL_STOCK)", () => {
  it("records the opening balance and posts Dr Inventory / Cr Owner Capital", async () => {
    const { service, postings } = build();
    await service.recordOpeningBalance({
      adjustmentId: "ADJ-OPEN",
      adjustmentNumber: "ADJ-000001",
      warehouseId: "W1",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("5000") }],
      gl: { inventoryAccountId: "1200", counterpartAccountId: "3100" },
    });
    const detail = await service.getBalanceDetail("I1", "W1");
    expect(detail.onHand.toString()).toBe("100.000000");
    expect(detail.totalValue.toString()).toBe("500000.000000"); // matches catalog sample
    // Dr المخزون 1200 500,000 / Cr رأس مال الملاك 3100 500,000
    const p = postings[0] as InventoryGlPosting;
    expect(p.lines.find((l) => l.debit.scaled > 0n)?.accountId).toBe("1200");
    expect(p.lines.find((l) => l.credit.scaled > 0n)?.accountId).toBe("3100");
    expect(p.lines.find((l) => l.credit.scaled > 0n)?.credit.toString()).toBe("500000.000000");

    const moved = (await service.getMovements("I1", "W1"))[0];
    expect(moved?.reason).toBe("INITIAL_STOCK");
  });
});

describe("StockLedgerService — valuation-neutral transfers", () => {
  it("moves quantity between warehouses without changing total inventory value", async () => {
    const { service } = build();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "INITIAL_STOCK",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    const before = await service.getValuation();
    expect(before.totalValue.toString()).toBe("50.000000");

    await service.postTransfer({
      transferId: "TRF1",
      transferNumber: "TRF-000001",
      fromWarehouseId: "W1",
      toWarehouseId: "W2",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("4") }],
    });

    const after = await service.getValuation();
    expect(after.totalValue.toString()).toBe("50.000000"); // UNCHANGED — valuation neutral
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("6.000000");
    expect((await service.getBalanceDetail("I1", "W1")).totalValue.toString()).toBe("30.000000");
    expect((await service.getBalanceDetail("I1", "W2")).onHand.toString()).toBe("4.000000");
    expect((await service.getBalanceDetail("I1", "W2")).totalValue.toString()).toBe("20.000000");
    expect((await service.getBalanceDetail("I1", "W2")).averageCost.toString()).toBe("5.000000");
  });

  it("rejects a transfer to the same warehouse and never posts to the GL", async () => {
    const { service, postings } = build();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "INITIAL_STOCK",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    await expect(
      service.postTransfer({
        transferId: "TRF1",
        fromWarehouseId: "W1",
        toWarehouseId: "W1",
        lines: [{ itemId: "I1", qty: Qty.fromMajor("1") }],
      }),
    ).rejects.toThrow();
    await service.postTransfer({
      transferId: "TRF2",
      fromWarehouseId: "W1",
      toWarehouseId: "W2",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("2") }],
    });
    expect(postings).toHaveLength(0); // transfers are never value-impacting
  });
});

describe("StockLedgerService — drift & rebuild", () => {
  it("rebuild restores a corrupted cache and layers from the ledger", async () => {
    const { service, snapshots, layers } = build();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [
        { itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") },
        { itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("7") },
      ],
    });
    // Corrupt the cache and blow away a layer.
    await snapshots.save({
      itemId: "I1",
      warehouseId: "W1",
      onHand: Qty.fromMajor("20"),
      totalValue: Money.fromMajor("999"),
      averageCost: Money.fromMajor("49.95"),
    });
    layers.layers.splice(0, layers.layers.length);

    const before = await service.checkDriftFor("I1", "W1");
    expect(before.withinTolerance).toBe(false);

    const rebuilt = await service.rebuild("I1", "W1");
    expect(rebuilt.totalValue.toString()).toBe("120.000000");
    expect(rebuilt.averageCost.toString()).toBe("6.000000");
    expect(rebuilt.layers).toHaveLength(2);

    const after = await service.checkDriftFor("I1", "W1");
    expect(after.cacheDrift.toString()).toBe("0.000000");
    expect(after.withinTolerance).toBe(true);
  });
});
