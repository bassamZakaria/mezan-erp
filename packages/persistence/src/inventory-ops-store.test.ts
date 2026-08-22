import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  Qty,
  DocumentService,
  stockAdjustmentDocumentType,
  stockTransferDocumentType,
  createInventoryStockHook,
  StockLedgerService,
  PhysicalCountService,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
} from "@mezan/domain";
import { createSqliteStockLedgerStore, type SqliteStockLedgerHandle } from "./stock-ledger-store.js";
import { createSqliteInventoryOpsStore, type SqliteInventoryOpsStoreHandle } from "./inventory-ops-store.js";

const ledgerHandles: SqliteStockLedgerHandle[] = [];
const opsHandles: SqliteInventoryOpsStoreHandle[] = [];
afterEach(() => {
  for (const h of ledgerHandles.splice(0)) h.close();
  for (const h of opsHandles.splice(0)) h.close();
});

function harness() {
  const ledgerStore = createSqliteStockLedgerStore();
  ledgerHandles.push(ledgerStore);
  const ops = createSqliteInventoryOpsStore();
  opsHandles.push(ops);

  const stockLedger = new StockLedgerService({
    ledger: ledgerStore.ledger,
    layers: ledgerStore.layers,
    snapshots: ledgerStore.snapshots,
    policy: { allowNegativeStock: false },
    transaction: (fn) => ledgerStore.transaction(fn),
  });

  let adjCounter = 0;
  const adjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: ops.stockAdjustments,
    numbering: { next: async () => ({ value: ++adjCounter, formatted: `ADJ-${String(adjCounter).padStart(6, "0")}` }) },
    stock: createInventoryStockHook(stockLedger),
  });

  let trfCounter = 0;
  const transfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: ops.stockTransfers,
    numbering: { next: async () => ({ value: ++trfCounter, formatted: `TRF-${String(trfCounter).padStart(6, "0")}` }) },
    stock: createInventoryStockHook(stockLedger),
  });

  let cntCounter = 0;
  const counts = new PhysicalCountService({
    repo: ops.physicalCounts,
    stockLedger,
    adjustments,
    numbering: { next: async () => ({ formatted: `CNT-${String(++cntCounter).padStart(6, "0")}` }) },
  });

  return { adjustments, transfers, counts, stockLedger };
}

describe("SqliteInventoryOpsStore — Stock Adjustment round-trip", () => {
  it("persists a confirmed adjustment with exact Money/Qty across a reload-by-id", async () => {
    const { adjustments } = harness();
    await adjustments.createDraft({
      id: "A1",
      date: "2026-01-01",
      memo: "test",
      lines: [
        {
          itemId: "I1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          direction: "IN",
          qty: Qty.fromMajor("12.500000"),
          unitCost: Money.fromMajor("3.250000"),
        },
      ],
    });
    const { document } = await adjustments.confirm("A1");
    expect(document.docNo).toBe("ADJ-000001");

    const reloaded = await adjustments.findById("A1");
    expect(reloaded?.status).toBe("confirmed");
    expect(reloaded?.lines[0]?.qty.toString()).toBe("12.500000");
    expect(reloaded?.lines[0]?.unitCost?.toString()).toBe("3.250000");
    expect(reloaded?.lines[0]?.reason).toBe("INITIAL_STOCK");
  });

  it("lists by status", async () => {
    const { adjustments } = harness();
    await adjustments.createDraft({
      id: "A1",
      date: "2026-01-01",
      memo: "",
      lines: [{ itemId: "I1", warehouseId: "W1", reason: "OTHER", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }],
    });
    await adjustments.createDraft({
      id: "A2",
      date: "2026-01-02",
      memo: "",
      lines: [{ itemId: "I1", warehouseId: "W1", reason: "OTHER", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }],
    });
    await adjustments.confirm("A2");

    const drafts = await adjustments.list({ status: "draft" });
    const confirmed = await adjustments.list({ status: "confirmed" });
    expect(drafts.map((d) => d.id)).toEqual(["A1"]);
    expect(confirmed.map((d) => d.id)).toEqual(["A2"]);
  });
});

describe("SqliteInventoryOpsStore — Stock Transfer round-trip", () => {
  it("persists a confirmed transfer and moves stock through the real SQLite ledger", async () => {
    const { adjustments, transfers, stockLedger } = harness();
    await adjustments.createDraft({
      id: "OPEN1",
      date: "2026-01-01",
      memo: "",
      lines: [{ itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    await adjustments.confirm("OPEN1");

    await transfers.createDraft({
      id: "T1",
      date: "2026-01-02",
      memo: "",
      lines: [{ itemId: "I1", fromWarehouseId: "W1", toWarehouseId: "W2", qty: Qty.fromMajor("3") }],
    });
    await transfers.confirm("T1");

    const reloaded = await transfers.findById("T1");
    expect(reloaded?.status).toBe("confirmed");
    expect(reloaded?.docNo).toBe("TRF-000001");
    expect((await stockLedger.getBalanceDetail("I1", "W2")).onHand.toString()).toBe("3.000000");
  });
});

describe("SqliteInventoryOpsStore — Physical Count round-trip", () => {
  it("persists a count session end to end through generate-adjustment", async () => {
    const { adjustments, counts, stockLedger } = harness();
    await adjustments.createDraft({
      id: "OPEN1",
      date: "2026-01-01",
      memo: "",
      lines: [{ itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") }],
    });
    await adjustments.confirm("OPEN1");

    await counts.start({ id: "C1", warehouseId: "W1", date: "2026-02-01", itemIds: ["I1"] });
    await counts.recordCounts("C1", [{ itemId: "I1", countedQty: Qty.fromMajor("8") }]);
    await counts.complete("C1");
    const { adjustment } = await counts.generateAdjustment({ countId: "C1", adjustmentId: "ADJGEN1" });

    expect(adjustment?.status).toBe("confirmed");
    const reloadedCount = await counts.findById("C1");
    expect(reloadedCount?.status).toBe("ADJUSTMENT_GENERATED");
    expect(reloadedCount?.generatedAdjustmentId).toBe("ADJGEN1");
    expect(reloadedCount?.lines[0]?.countedQty?.toString()).toBe("8.000000");
    expect((await stockLedger.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("8.000000");
  });
});
