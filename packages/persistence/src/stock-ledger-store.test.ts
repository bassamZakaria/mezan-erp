import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Money, Qty, StockLedgerService, NegativeStockError, movementValue, replay } from "@mezan/domain";
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

describe("SqliteStockLedgerStore — the value a movement moved", () => {
  it("stores the exact value of a drain, which quantity × the rounded unit cost does not give, and replays to the stored position", async () => {
    const { store, service } = newService();
    const plan = (sourceDocId: string, lines: Parameters<typeof service.applyDocumentStockPlan>[0]["lines"]) =>
      service.applyDocumentStockPlan({ sourceDocType: "SALES_INVOICE", sourceDocId, sourceDocNumber: sourceDocId, warehouseId: "W1", lines });
    await plan("GRN-1", [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10") }]);
    await plan("GRN-2", [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10.01") }]);
    await plan("ISS-1", [{ itemId: "I1", direction: "OUT", qty: Qty.fromMajor("3") }]);
    const drain = (await store.ledger.listByPosition("I1", "W1")).at(-1);
    expect([drain?.unitCost.toString(), drain?.value?.toString()]).toEqual(["10.006667", "30.020000"]);
    await plan("ISS-1:void", [{ itemId: "I1", direction: "IN", qty: Qty.fromMajor("3"), unitCost: drain!.unitCost, value: drain!.value ?? undefined }]);
    const detail = await service.getBalanceDetail("I1", "W1");
    const again = replay("I1", "W1", await store.ledger.listByPosition("I1", "W1"));
    expect([detail.onHand.toString(), detail.totalValue.toString()]).toEqual(["3.000000", "30.020000"]);
    expect([again.onHand.toString(), again.totalValue.toString()]).toEqual(["3.000000", "30.020000"]);
  });

  it("reads a row written before the column as quantity × unit cost, and adds the column to a file that lacks it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mezan-stock-value-"));
    const file = join(dir, "t.db");
    const first = createSqliteStockLedgerStore(file);
    await first.ledger.append({
      id: "M1", itemId: "I1", warehouseId: "W1", direction: "IN", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("10.006667"),
      sourceDocType: "ADJUSTMENT", sourceDocId: "ADJ1", sourceDocNumber: null, reason: "INITIAL_STOCK", occurredAt: "2026-03-01T00:00:00.000Z",
    });
    first.close();
    const raw = new Database(file);
    raw.exec("ALTER TABLE stock_movement DROP COLUMN value");
    raw.close();
    const reopened = createSqliteStockLedgerStore(file);
    handles.push(reopened);
    const [legacy] = await reopened.ledger.listByPosition("I1", "W1");
    expect(legacy?.value ?? null).toBeNull();
    expect(movementValue(legacy!).toString()).toBe("30.020001");
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([1, 2])("brings a schema-%i file that lacks the column up to shape and keeps its rows; the version stamp is left to the upgrade that owns it", async (fileVersion) => {
    const dir = mkdtempSync(join(tmpdir(), "mezan-stock-value-schema-"));
    const file = join(dir, "t.db");
    const first = createSqliteStockLedgerStore(file);
    await first.ledger.append({
      id: "M1", itemId: "I1", warehouseId: "W1", direction: "IN", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10"),
      sourceDocType: "ADJUSTMENT", sourceDocId: "ADJ1", sourceDocNumber: null, reason: "INITIAL_STOCK", occurredAt: "2026-03-01T00:00:00.000Z",
    });
    first.close();
    const raw = new Database(file);
    raw.exec("ALTER TABLE stock_movement DROP COLUMN value");
    raw.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    raw.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(fileVersion));
    raw.pragma(`user_version = ${fileVersion}`);
    raw.close();

    const reopened = createSqliteStockLedgerStore(file);
    handles.push(reopened);
    const [legacy] = await reopened.ledger.listByPosition("I1", "W1");
    expect([legacy?.value ?? null, movementValue(legacy!).toString()]).toEqual([null, "20.000000"]);
    await reopened.ledger.append({
      id: "M2", itemId: "I1", warehouseId: "W1", direction: "OUT", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10"), value: Money.fromMajor("20"),
      sourceDocType: "SALES_INVOICE", sourceDocId: "SI1", sourceDocNumber: null, reason: null, occurredAt: "2026-03-02T00:00:00.000Z",
    });
    expect((await reopened.ledger.listByPosition("I1", "W1")).at(-1)?.value?.toString()).toBe("20.000000");
    const check = new Database(file, { readonly: true });
    const columns = (check.prepare("PRAGMA table_info(stock_movement)").all() as { name: string }[]).map((column) => column.name);
    const stampedVersion = check.pragma("user_version", { simple: true });
    check.close();
    expect(columns).toContain("value");
    expect(stampedVersion).toBe(fileVersion);
    rmSync(dir, { recursive: true, force: true });
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
