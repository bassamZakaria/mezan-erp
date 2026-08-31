import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { InvalidStockMovementError } from "./errors.js";
import type { InventoryDomainEvent } from "./ports.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "./test-helpers/in-memory-stores.js";

function build(policy = { allowNegativeStock: false }) {
  const ledger = new InMemoryStockLedger();
  const layers = new InMemoryCostLayers();
  const snapshots = new InMemorySnapshots();
  const events: InventoryDomainEvent[] = [];
  let clockTick = 0;
  const service = new StockLedgerService({
    ledger,
    layers,
    snapshots,
    policy,
    events: { publish: (e) => events.push(e) },
    clock: () => `2026-02-01T00:00:${String(clockTick++).padStart(2, "0")}.000Z`,
  });
  return { service, ledger, layers, snapshots, events };
}

async function receipt(
  service: StockLedgerService,
  receiptId: string,
  itemId = "I1",
  warehouseId = "W1",
  qty = "10",
  unitCost = "5",
) {
  await service.postReceipt({
    receiptId,
    receiptNumber: `GR-${receiptId}`,
    warehouseId,
    sourceDocType: "PURCHASE_RECEIPT",
    lines: [{ itemId, qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) }],
  });
}

describe("StockLedgerService — reversing a receipt", () => {
  it("removes the layer, unwinds the snapshot and files a mirror-image OUT movement", async () => {
    const { service, layers } = build();
    await receipt(service, "GR1");

    await service.reverseReceipt({
      reversalId: "GR1-REV",
      sourceDocType: "PURCHASE_RECEIPT",
      sourceDocId: "GR1",
      positions: [{ itemId: "I1", warehouseId: "W1" }],
    });

    const detail = await service.getBalanceDetail("I1", "W1");
    expect(detail.onHand.toString()).toBe("0.000000");
    expect(detail.totalValue.toString()).toBe("0.000000");
    expect(await layers.listByPosition("I1", "W1")).toEqual([]);

    const movements = await service.getMovements("I1", "W1");
    expect(movements.at(-1)).toMatchObject({ direction: "OUT", sourceDocId: "GR1-REV" });
  });

  it("refuses to reverse a receipt whose goods have already been drawn down", async () => {
    const { service } = build();
    await receipt(service, "GR1");
    await service.postAdjustment({
      adjustmentId: "ADJ-OUT",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("1") }],
    });

    await expect(
      service.reverseReceipt({
        reversalId: "GR1-REV",
        sourceDocType: "PURCHASE_RECEIPT",
        sourceDocId: "GR1",
        positions: [{ itemId: "I1", warehouseId: "W1" }],
      }),
    ).rejects.toThrow(InvalidStockMovementError);

    // Nothing moved: the position is exactly as the issue left it.
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("9.000000");
  });

  it("leaves a position alone when the named document created no layer in it", async () => {
    const { service } = build();
    await receipt(service, "GR1");

    await service.reverseReceipt({
      reversalId: "GR-OTHER-REV",
      sourceDocType: "PURCHASE_RECEIPT",
      sourceDocId: "GR-OTHER",
      positions: [{ itemId: "I1", warehouseId: "W1" }],
      occurredAt: "2026-03-01T00:00:00.000Z",
    });

    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("10.000000");
  });

  it("publishes the reversal as a StockMoved event like any other movement", async () => {
    const { service, events } = build();
    await receipt(service, "GR1");
    events.length = 0;

    await service.reverseReceipt({
      reversalId: "GR1-REV",
      sourceDocType: "PURCHASE_RECEIPT",
      sourceDocId: "GR1",
      positions: [{ itemId: "I1", warehouseId: "W1" }],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "StockMoved" });
  });
});

describe("StockLedgerService — the document framework's stock plan", () => {
  it("moves nothing, and reports nothing moved, for a plan with no lines", async () => {
    const { service, ledger } = build();
    const result = await service.applyDocumentStockPlan({
      sourceDocType: "ADJUSTMENT",
      sourceDocId: "DOC-EMPTY",
      sourceDocNumber: null,
      warehouseId: "W1",
      lines: [],
    });
    expect(result.valueMoved.toString()).toBe("0.000000");
    expect(await ledger.listByPosition("I1", "W1")).toEqual([]);
  });

  it("applies an IN and an OUT line and reports the net value moved", async () => {
    const { service } = build();
    await receipt(service, "GR1", "I1", "W1", "10", "5");

    const result = await service.applyDocumentStockPlan({
      sourceDocType: "ADJUSTMENT",
      sourceDocId: "DOC-1",
      sourceDocNumber: "ADJ-000001",
      warehouseId: "W1",
      lines: [
        { itemId: "I1", direction: "OUT", qty: Qty.fromMajor("4") },
        { itemId: "I2", direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("15") },
      ],
      occurredAt: "2026-02-05T00:00:00.000Z",
    });

    // −20 issued at cost 5, +30 received: a net +10 of value.
    expect(result.valueMoved.toString()).toBe("10.000000");
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("6.000000");
    expect((await service.getBalanceDetail("I2", "W1")).averageCost.toString()).toBe("15.000000");
  });
});

describe("StockLedgerService — landed cost absorbed onto an existing position", () => {
  it("refuses a delta that is not positive", async () => {
    const { service } = build();
    await receipt(service, "GR1");
    await expect(
      service.applyLandedCostRevaluation({
        itemId: "I1",
        warehouseId: "W1",
        sourceDocId: "GR1",
        valueDelta: Money.zero(),
      }),
    ).rejects.toThrow(InvalidStockMovementError);
  });

  it("raises the cost basis with no quantity change, and the cache still equals a replay", async () => {
    const { service } = build();
    await receipt(service, "GR1", "I1", "W1", "10", "5");

    const absorption = await service.applyLandedCostRevaluation({
      itemId: "I1",
      warehouseId: "W1",
      sourceDocId: "GR1",
      valueDelta: Money.fromMajor("20.00"),
      landedCostDocId: "LC-1",
      landedCostDocNumber: "LC-000001",
      occurredAt: "2026-02-10T00:00:00.000Z",
    });

    expect(absorption.absorbed.toString()).toBe("20.000000");
    expect(absorption.unabsorbed.toString()).toBe("0.000000");

    const detail = await service.getBalanceDetail("I1", "W1");
    expect(detail.onHand.toString()).toBe("10.000000");
    expect(detail.totalValue.toString()).toBe("70.000000");
    expect(detail.averageCost.toString()).toBe("7.000000");

    // D36: the ledger stays the single source of truth, so nothing drifts.
    const drift = await service.checkDriftFor("I1", "W1");
    expect(drift.cacheDrift.toString()).toBe("0.000000");
  });

  it("reports the part it could not absorb when the goods have already gone", async () => {
    const { service } = build();
    await receipt(service, "GR1", "I1", "W1", "10", "5");
    await service.postAdjustment({
      adjustmentId: "ADJ-OUT",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("10") }],
    });

    const absorption = await service.applyLandedCostRevaluation({
      itemId: "I1",
      warehouseId: "W1",
      sourceDocId: "GR1",
      valueDelta: Money.fromMajor("20.00"),
    });
    expect(absorption.unabsorbed.toString()).toBe("20.000000");
    expect(absorption.absorbed.toString()).toBe("0.000000");
  });

  it("never dates the revaluation before the position's last movement", async () => {
    const { service } = build();
    await receipt(service, "GR1", "I1", "W1", "10", "5");

    await service.applyLandedCostRevaluation({
      itemId: "I1",
      warehouseId: "W1",
      sourceDocId: "GR1",
      valueDelta: Money.fromMajor("5.00"),
      occurredAt: "2020-01-01T00:00:00.000Z",
    });

    const movements = await service.getMovements("I1", "W1");
    const revaluation = movements.at(-1)!;
    expect(revaluation.occurredAt >= movements[0]!.occurredAt).toBe(true);
  });
});

describe("StockLedgerService — what the screens read back", () => {
  async function seeded() {
    const built = build();
    const { service } = built;
    await service.recordOpeningBalance({
      adjustmentId: "OPEN-1",
      warehouseId: "W1",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    await service.recordOpeningBalance({
      adjustmentId: "OPEN-2",
      warehouseId: "W2",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("6") }],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ-DMG",
      adjustmentNumber: "ADJ-000009",
      warehouseId: "W1",
      reason: "DAMAGE",
      lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("1") }],
    });
    await service.postTransfer({
      transferId: "TR-1",
      fromWarehouseId: "W1",
      toWarehouseId: "W2",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("2") }],
    });
    return built;
  }

  it("reports every warehouse an item sits in, and the open layers behind them", async () => {
    const { service } = await seeded();

    const positions = await service.getItemPositions("I1");
    expect(positions.map((p) => p.warehouseId).sort()).toEqual(["W1", "W2"]);

    const costLayers = await service.getItemCostLayers("I1");
    expect(costLayers.length).toBeGreaterThan(0);
    expect(costLayers.every((l) => l.remainingQty.scaled > 0n)).toBe(true);
    // Oldest first, so a FIFO reader sees them in the order they were created.
    const created = costLayers.map((l) => l.createdAt);
    expect([...created].sort()).toEqual(created);

    expect(await service.getItemPositions("I-NONE")).toEqual([]);
  });

  it("rolls the whole valuation up across positions", async () => {
    const { service } = await seeded();
    const valuation = await service.getValuation();
    expect(valuation.positions.length).toBe(2);
    expect(valuation.totalValue.toString()).toBe(
      Money.sum(valuation.positions.map((p) => p.totalValue)).toString(),
    );
  });

  it("folds the posted adjustments and transfers back out of the ledger", async () => {
    const { service } = await seeded();

    const adjustments = await service.listPostedAdjustments();
    expect(adjustments.map((a) => a.id)).toEqual(expect.arrayContaining(["OPEN-1", "OPEN-2", "ADJ-DMG"]));

    const damage = await service.listPostedAdjustments({ reason: "DAMAGE" });
    expect(damage.map((a) => a.id)).toEqual(["ADJ-DMG"]);

    const byWarehouse = await service.listPostedAdjustments({ warehouseId: "W2" });
    expect(byWarehouse.map((a) => a.id)).toEqual(["OPEN-2"]);

    const one = await service.getPostedAdjustment("ADJ-DMG");
    expect(one?.docNo).toBe("ADJ-000009");
    expect(await service.getPostedAdjustment("nope")).toBeNull();

    const transfers = await service.listPostedTransfers();
    expect(transfers.map((t) => t.id)).toEqual(["TR-1"]);
    expect((await service.getPostedTransfer("TR-1"))?.fromWarehouseId).toBe("W1");
    expect(await service.getPostedTransfer("nope")).toBeNull();
  });

  it("returns every movement one document produced, across the positions it touched", async () => {
    const { service } = await seeded();
    const movements = await service.getMovementsOfDocument("TR-1");
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.direction).sort()).toEqual(["IN", "OUT"]);
  });

  it("replays a position that has never moved as an empty one", async () => {
    const { service } = build();
    const position = await service.getPosition("GHOST", "W1");
    expect(position.onHand.toString()).toBe("0.000000");
    expect(position.totalValue.toString()).toBe("0.000000");
  });
});
