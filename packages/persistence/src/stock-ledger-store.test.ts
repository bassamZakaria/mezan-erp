import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Money, Qty, StockLedgerService, NegativeStockError } from "@mezan/domain";
import { createSqliteStockLedgerStore, type SqliteStockLedgerHandle } from "./stock-ledger-store.js";

const handles: SqliteStockLedgerHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newStore() {
  const store = createSqliteStockLedgerStore();
  handles.push(store);
  return store;
}

function newService(policy = { allowNegativeStock: false }) {
  const store = newStore();
  const service = new StockLedgerService({
    ledger: store.ledger,
    layers: store.layers,
    snapshots: store.snapshots,
    policy,
    transaction: (fn) => store.transaction(fn),
    clock: (() => {
      let t = 0;
      return () => `2026-03-01T00:00:${String(t++).padStart(2, "0")}.000Z`;
    })(),
  });
  return { store, service };
}

describe("SqliteStockLedgerStore — round-trip & scaled-integer storage", () => {
  it("appends and reads movements in ledger order with exact Money/Qty", async () => {
    const store = newStore();
    await store.ledger.append({
      id: "M1",
      itemId: "I1",
      warehouseId: "W1",
      direction: "IN",
      qty: Qty.fromMajor("10.5"),
      unitCost: Money.fromMajor("3.250000"),
      sourceDocType: "ADJUSTMENT",
      sourceDocId: "ADJ1",
      sourceDocNumber: "ADJ-000001",
      reason: "INITIAL_STOCK",
      occurredAt: "2026-03-01T00:00:00.000Z",
    });
    const [m] = await store.ledger.listByPosition("I1", "W1");
    expect(m?.qty.toString()).toBe("10.500000");
    expect(m?.unitCost.toString()).toBe("3.250000");
    expect(m?.reason).toBe("INITIAL_STOCK");
  });
});

describe("SqliteStockLedgerStore — storage-level immutability triggers", () => {
  it("blocks UPDATE/DELETE on movements and unit-cost changes on layers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mezan-ledger-"));
    const file = join(dir, "ledger.db");
    const store = createSqliteStockLedgerStore(file);
    try {
      await store.ledger.append({
        id: "M1",
        itemId: "I1",
        warehouseId: "W1",
        direction: "IN",
        qty: Qty.fromMajor("1"),
        unitCost: Money.fromMajor("5"),
        sourceDocType: "ADJUSTMENT",
        sourceDocId: "ADJ1",
        sourceDocNumber: null,
        reason: null,
        occurredAt: "2026-03-01T00:00:00.000Z",
      });
      await store.layers.add({
        id: "L1",
        itemId: "I1",
        warehouseId: "W1",
        unitCost: Money.fromMajor("5"),
        originalQty: Qty.fromMajor("1"),
        remainingQty: Qty.fromMajor("1"),
        sourceDocType: "ADJUSTMENT",
        sourceDocId: "ADJ1",
        sourceDocNumber: null,
        createdAt: "2026-03-01T00:00:00.000Z",
      });
      store.close();

      const raw = new Database(file);
      expect(() => raw.exec("UPDATE stock_movement SET qty = 999 WHERE id = 'M1'")).toThrow(
        /append-only/,
      );
      expect(() => raw.exec("DELETE FROM stock_movement WHERE id = 'M1'")).toThrow(/append-only/);
      expect(() => raw.exec("UPDATE cost_layer SET unit_cost = 999 WHERE id = 'L1'")).toThrow(
        /immutable/,
      );
      // remaining_qty CAN be updated (FIFO draw-down).
      expect(() => raw.exec("UPDATE cost_layer SET remaining_qty = 0 WHERE id = 'L1'")).not.toThrow();
      raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("StockLedgerService on SQLite — parity with the pure engine", () => {
  it("computes weighted average and drift identically to replay", async () => {
    const { service } = newService();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "OTHER",
      lines: [
        { itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") },
        { itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("7") },
      ],
    });
    await service.postAdjustment({
      adjustmentId: "ADJ2",
      warehouseId: "W1",
      reason: "SHORTAGE",
      lines: [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("15") }],
    });

    const detail = await service.getBalanceDetail("I1", "W1");
    expect(detail.onHand.toString()).toBe("5.000000");
    expect(detail.averageCost.toString()).toBe("6.000000");
    expect(detail.totalValue.toString()).toBe("30.000000");

    const drift = await service.checkDriftFor("I1", "W1");
    expect(drift.cacheDrift.toString()).toBe("0.000000");
    expect(drift.layersValue.toString()).toBe("35.000000"); // 5 remaining @ 7
    expect(drift.layerDrift.toString()).toBe("-5.000000");
  });

  it("rolls back the whole adjustment when negative stock is rejected", async () => {
    const { service, store } = newService({ allowNegativeStock: false });
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "INITIAL_STOCK",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("2") }],
    });
    await expect(
      service.postAdjustment({
        adjustmentId: "ADJ2",
        warehouseId: "W1",
        reason: "OTHER",
        lines: [
          { itemId: "I2", direction: "IN", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("9") },
          { itemId: "I1", direction: "OUT", qty: Qty.fromMajor("99") }, // fails → rollback
        ],
      }),
    ).rejects.toBeInstanceOf(NegativeStockError);

    // The first line (I2) must have been rolled back with the failing one.
    expect((await store.ledger.listByPosition("I2", "W1")).length).toBe(0);
    expect((await service.getBalanceDetail("I2", "W1")).onHand.toString()).toBe("0.000000");
    expect((await service.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("5.000000");
  });

  it("keeps transfers valuation-neutral through the store", async () => {
    const { service } = newService();
    await service.postAdjustment({
      adjustmentId: "ADJ1",
      warehouseId: "W1",
      reason: "INITIAL_STOCK",
      lines: [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    await service.postTransfer({
      transferId: "TRF1",
      fromWarehouseId: "W1",
      toWarehouseId: "W2",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("4") }],
    });
    const { totalValue } = await service.getValuation();
    expect(totalValue.toString()).toBe("50.000000");
  });
});

/**
 * Q-6: the inventory reports read the whole ledger by issuing one synchronous
 * query PER POSITION (12,001 of them on the reference database). `listAll`
 * replaces that, and its ORDER is part of the contract — it must be byte for
 * byte what `listPositions()` + a `listByPosition` per position produced, or
 * the ledger and drift reports read a different ledger.
 */
describe("SqliteStockLedgerStore — listAll equals the per-position walk (guards Q-6)", () => {
  it("returns every movement and every layer in the same order, in one query", async () => {
    const { store, service } = newService({ allowNegativeStock: true });
    // Two items across two warehouses, interleaved so position order and
    // insertion order genuinely differ.
    for (const [n, itemId, warehouseId] of [
      [1, "I2", "W2"],
      [2, "I1", "W1"],
      [3, "I2", "W1"],
      [4, "I1", "W2"],
      [5, "I1", "W1"],
    ] as const) {
      await service.recordOpeningBalance({
        adjustmentId: `open-${n}`,
        warehouseId,
        lines: [{ itemId, qty: Qty.fromMajor("10"), unitCost: Money.fromMajor(`${n}.50`) }],
      });
    }
    await service.postIssue({
      issueId: "iss-1",
      warehouseId: "W1",
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "inv-1",
      sourceDocNumber: null,
      occurredAt: "2026-03-02T00:00:00.000Z",
      lines: [{ itemId: "I1", qty: Qty.fromMajor("4") }],
    });

    const positions = await store.ledger.listPositions();
    const walked = (
      await Promise.all(positions.map((p) => store.ledger.listByPosition(p.itemId, p.warehouseId)))
    ).flat();
    const inOneQuery = await store.ledger.listAll!();
    expect(inOneQuery.map((m) => m.id)).toEqual(walked.map((m) => m.id));
    expect(inOneQuery).toEqual(walked);

    const walkedLayers = (
      await Promise.all(positions.map((p) => store.layers.listByPosition(p.itemId, p.warehouseId)))
    ).flat();
    const layersInOneQuery = await store.layers.listAll!();
    expect(layersInOneQuery.map((l) => l.id)).toEqual(walkedLayers.map((l) => l.id));
    expect(layersInOneQuery).toEqual(walkedLayers);
  });
});
