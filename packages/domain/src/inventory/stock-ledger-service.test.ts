import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { NegativeStockError, InvalidStockMovementError, UncostedDeficitIssueError } from "./errors.js";
import { PeriodNotOpenForPostingError } from "../fiscal-periods/errors.js";
import type { InventoryDomainEvent, InventoryGlPosting } from "./ports.js";
import {
  InMemoryStockLedger,
  InMemoryCostLayers,
  InMemorySnapshots,
} from "./test-helpers/in-memory-stores.js";

function build(policy = { allowNegativeStock: false }, fallbackUnitCost?: (itemId: string) => Money | null) {
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
    fallbackUnitCost,
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

  it("tags projectId on every line and costCategory only on the counterpart (expense) line, for a stock-out adjustment", async () => {
    const { service, postings } = build();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ2",
      warehouseId: "W1",
      reason: "SHORTAGE",
      lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("4") }],
      gl: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
      projectId: "PROJ-1",
      costCategory: "materials",
    });
    const p = postings[0] as InventoryGlPosting;
    const inventoryLine = p.lines.find((l) => l.accountId === "1200");
    const counterpartLine = p.lines.find((l) => l.accountId === "5900");
    expect(inventoryLine?.projectId).toBe("PROJ-1");
    expect(counterpartLine?.projectId).toBe("PROJ-1");
    expect(counterpartLine?.costCategory).toBe("materials");
    expect(inventoryLine?.costCategory ?? null).toBeNull();
  });

  it("refuses a costCategory with no projectId on an adjustment", async () => {
    const { service } = build();
    await expect(
      service.postAdjustment({
        adjustmentId: "ADJ1",
        warehouseId: "W1",
        reason: "OTHER",
        lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }],
        costCategory: "materials",
      }),
    ).rejects.toBeInstanceOf(InvalidStockMovementError);
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

describe("StockLedgerService — what a deficit issue costs (D101)", () => {
  it("refuses an issue from an item that was never received anywhere and has no cost price — a zero cost is never right (D101)", async () => {
    const { service } = build({ allowNegativeStock: true });

    await expect(
      service.postAdjustment({
        adjustmentId: "ADJ-DEFICIT",
        warehouseId: "W1",
        reason: "SHORTAGE",
        lines: [{ itemId: "I-NEW", direction: "OUT", qty: Qty.fromMajor("4") }],
      }),
    ).rejects.toThrow(UncostedDeficitIssueError);

    const position = await service.getBalanceDetail("I-NEW", "W1");
    expect(position.onHand.scaled).toBe(0n);
    expect(position.totalValue.scaled).toBe(0n);
  });

  it("costs the deficit at the item master's cost price when nothing was ever received, and says so on an event", async () => {
    const { service, events } = build({ allowNegativeStock: true }, () => Money.fromMajor("7.5"));

    await service.postAdjustment({
      adjustmentId: "ADJ-DEFICIT",
      warehouseId: "W1",
      reason: "SHORTAGE",
      lines: [{ itemId: "I-NEW", direction: "OUT", qty: Qty.fromMajor("4") }],
    });

    const position = await service.getBalanceDetail("I-NEW", "W1");
    expect(position.onHand.toString()).toBe("-4.000000");
    // 4 units out at 7.50 — COGS carries the whole deficit instead of nothing.
    expect(position.totalValue.toString()).toBe("-30.000000");
    expect(position.averageCost.toString()).toBe("7.500000");

    const short = events.filter((e) => e.type === "StockIssuedShort");
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({
      itemId: "I-NEW",
      warehouseId: "W1",
      costBasis: "item_cost_price",
    });

    // And the cache still equals a full replay: the movement carries the cost
    // it left at, so replay does not recompute a zero behind it.
    const drift = await service.checkDriftFor("I-NEW", "W1");
    expect(drift.cacheDrift.toString()).toBe("0.000000");
  });

  it("prefers the last cost this position was received at over the item master's price", async () => {
    const { service, events } = build({ allowNegativeStock: true }, () => Money.fromMajor("7.5"));
    await service.postAdjustment({
      adjustmentId: "ADJ-IN",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I3", direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("4") }],
    });
    // Drain it to exactly zero, so the position holds nothing and has no average.
    await service.postAdjustment({
      adjustmentId: "ADJ-DRAIN",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I3", direction: "OUT", qty: Qty.fromMajor("2") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ-SHORT",
      warehouseId: "W1",
      reason: "SHORTAGE",
      lines: [{ itemId: "I3", direction: "OUT", qty: Qty.fromMajor("3") }],
    });

    const position = await service.getBalanceDetail("I3", "W1");
    expect(position.onHand.toString()).toBe("-3.000000");
    expect(position.totalValue.toString()).toBe("-12.000000");
    expect(events.filter((e) => e.type === "StockIssuedShort")[0]).toMatchObject({
      costBasis: "last_receipt_here",
      unitCost: Money.fromMajor("4"),
    });
  });

  it("falls back to the last cost the same item was received at in ANOTHER warehouse", async () => {
    const { service, events } = build({ allowNegativeStock: true });
    await service.postAdjustment({
      adjustmentId: "ADJ-OTHER-WH",
      warehouseId: "W2",
      reason: "OTHER",
      lines: [{ itemId: "I4", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("6") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ-SHORT-W1",
      warehouseId: "W1",
      reason: "SHORTAGE",
      lines: [{ itemId: "I4", direction: "OUT", qty: Qty.fromMajor("2") }],
    });

    const position = await service.getBalanceDetail("I4", "W1");
    expect(position.totalValue.toString()).toBe("-12.000000");
    expect(events.filter((e) => e.type === "StockIssuedShort")[0]).toMatchObject({
      costBasis: "last_receipt_elsewhere",
    });
  });

  it("costs a deficit issue at the average it had before going negative, when there was one", async () => {
    const { service } = build({ allowNegativeStock: true });
    await service.postAdjustment({
      adjustmentId: "ADJ-IN",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I2", direction: "IN", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("3") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ-OUT",
      warehouseId: "W1",
      reason: "SHORTAGE",
      lines: [{ itemId: "I2", direction: "OUT", qty: Qty.fromMajor("8") }],
    });

    const position = await service.getBalanceDetail("I2", "W1");
    expect(position.onHand.toString()).toBe("-3.000000");
    // 5 units in at 3.00 = 15.00; 8 out at the 3.00 average = 24.00; the
    // position is left owing 9.00 of value against three units it does not have.
    expect(position.totalValue.toString()).toBe("-9.000000");
    expect(position.averageCost.toString()).toBe("3.000000");
  });

  it("a TRANSFER out of an unknown position is still allowed — both legs take the same cost, so total valuation is unchanged whatever it is", async () => {
    const { service } = build({ allowNegativeStock: true });
    await service.postTransfer({
      transferId: "TRF-DEFICIT",
      transferNumber: "TRF-000009",
      fromWarehouseId: "W1",
      toWarehouseId: "W2",
      lines: [{ itemId: "I-NEW", qty: Qty.fromMajor("4") }],
    });
    expect((await service.getValuation()).totalValue.scaled).toBe(0n);
    expect((await service.getBalanceDetail("I-NEW", "W1")).onHand.toString()).toBe("-4.000000");
    expect((await service.getBalanceDetail("I-NEW", "W2")).onHand.toString()).toBe("4.000000");
  });

  it("refuses the same issue outright when negative stock is not allowed", async () => {
    const { service } = build({ allowNegativeStock: false });
    await expect(
      service.postAdjustment({
        adjustmentId: "ADJ-DEFICIT",
        warehouseId: "W1",
        reason: "SHORTAGE",
        lines: [{ itemId: "I-NEW", direction: "OUT", qty: Qty.fromMajor("4") }],
      }),
    ).rejects.toThrow();

    const position = await service.getBalanceDetail("I-NEW", "W1");
    expect(position.onHand.scaled).toBe(0n);
    expect(position.totalValue.scaled).toBe(0n);
  });
});

describe("StockLedgerService — no movement is dated into a shut fiscal period", () => {
  const SHUT = new PeriodNotOpenForPostingError({ id: "fp-2026-06", year: 2026, periodNumber: 6 }, "locked");

  function gated() {
    const ledger = new InMemoryStockLedger();
    const layers = new InMemoryCostLayers();
    const service = new StockLedgerService({
      ledger,
      layers,
      snapshots: new InMemorySnapshots(),
      policy: { allowNegativeStock: false },
      periodGate: async (date) => {
        if (date.startsWith("2026-06")) throw SHUT;
      },
    });
    return { service, ledger };
  }

  async function stocked() {
    const world = gated();
    await world.service.postReceipt({
      receiptId: "R-MAY",
      sourceDocType: "PURCHASE_RECEIPT",
      warehouseId: "W1",
      occurredAt: "2026-05-10T00:00:00.000Z",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    return world;
  }

  const JUNE = "2026-06-15T00:00:00.000Z";
  const WRITES: readonly [string, (service: StockLedgerService, occurredAt: string) => Promise<unknown>][] = [
    ["a transfer", (s, occurredAt) => s.postTransfer({ transferId: "T1", fromWarehouseId: "W1", toWarehouseId: "W2", occurredAt, lines: [{ itemId: "I1", qty: Qty.fromMajor("2") }] })],
    ["an adjustment", (s, occurredAt) => s.postAdjustment({ adjustmentId: "A1", warehouseId: "W1", reason: "DAMAGE", occurredAt, lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("1") }] })],
    ["an issue", (s, occurredAt) => s.postIssue({ issueId: "S1", sourceDocType: "MATERIAL_CONSUMPTION", sourceDocId: "S1", warehouseId: "W1", occurredAt, lines: [{ itemId: "I1", qty: Qty.fromMajor("1") }] })],
    ["a receipt", (s, occurredAt) => s.postReceipt({ receiptId: "R2", sourceDocType: "PURCHASE_RECEIPT", warehouseId: "W1", occurredAt, lines: [{ itemId: "I1", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("5") }] })],
    ["a receipt reversal", (s, occurredAt) => s.reverseReceipt({ reversalId: "R-MAY:cancel", sourceDocType: "PURCHASE_RECEIPT", sourceDocId: "R-MAY", occurredAt, positions: [{ itemId: "I1", warehouseId: "W1" }] })],
    ["a document stock plan", (s, occurredAt) => s.applyDocumentStockPlan({ sourceDocType: "SALES_RETURN", sourceDocId: "SR1", sourceDocNumber: null, warehouseId: "W1", occurredAt, lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("5") }] })],
    ["a landed cost", (s, occurredAt) => s.applyLandedCostRevaluation({ itemId: "I1", warehouseId: "W1", sourceDocId: "R-MAY", valueDelta: Money.fromMajor("3"), landedCostDocId: "LC1", occurredAt })],
  ];

  it.each(WRITES)("%s dated in the shut month is refused and appends nothing", async (_name, write) => {
    const { service, ledger } = await stocked();
    const before = (await ledger.listByPosition("I1", "W1")).length;
    await expect(write(service, JUNE)).rejects.toBe(SHUT);
    expect((await ledger.listByPosition("I1", "W1")).length).toBe(before);
    expect((await ledger.listByPosition("I1", "W2")).length).toBe(0);
  });

  it.each(WRITES)("%s dated in an open month goes through", async (_name, write) => {
    const { service, ledger } = await stocked();
    const before = (await ledger.listByPosition("I1", "W1")).length;
    await write(service, "2026-07-02T00:00:00.000Z");
    expect((await ledger.listByPosition("I1", "W1")).length).toBeGreaterThan(before);
  });
});
