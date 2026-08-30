import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { createDocumentWorkflowGate } from "../documents/journal-document.js";
import { InMemoryDocumentRepository } from "../documents/test-helpers/in-memory-document-repository.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "./test-helpers/in-memory-stores.js";
import { stockAdjustmentDocumentType, type StockAdjustmentDocLine } from "./stock-adjustment-document.js";
import { createInventoryOpsStockHook } from "./document-hooks.js";
import {
  PhysicalCountService,
  type PhysicalCount,
  type PhysicalCountRepository,
} from "./physical-count.js";

class InMemoryPhysicalCountRepo implements PhysicalCountRepository {
  private readonly rows = new Map<string, PhysicalCount>();
  async save(count: PhysicalCount): Promise<void> {
    this.rows.set(count.id, count);
  }
  async update(count: PhysicalCount): Promise<void> {
    this.rows.set(count.id, count);
  }
  async findById(id: string): Promise<PhysicalCount | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<readonly PhysicalCount[]> {
    return [...this.rows.values()];
  }
}

function harness() {
  const ledger = new InMemoryStockLedger();
  const layers = new InMemoryCostLayers();
  const snapshots = new InMemorySnapshots();
  const stockLedger = new StockLedgerService({
    ledger,
    layers,
    snapshots,
    policy: { allowNegativeStock: false },
  });

  let adjCounter = 0;
  const adjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: new InMemoryDocumentRepository<StockAdjustmentDocLine>(),
    numbering: { next: async () => ({ value: ++adjCounter, formatted: `ADJ-${String(adjCounter).padStart(6, "0")}` }) },
    workflow: createDocumentWorkflowGate(() => null),
    stock: createInventoryOpsStockHook(stockLedger),
  });

  let cntCounter = 0;
  const counts = new PhysicalCountService({
    repo: new InMemoryPhysicalCountRepo(),
    stockLedger,
    adjustments,
    numbering: { next: async () => ({ formatted: `CNT-${String(++cntCounter).padStart(6, "0")}` }) },
  });

  return { counts, adjustments, stockLedger };
}

async function seed(adjustments: ReturnType<typeof harness>["adjustments"], itemId: string, warehouseId: string, qty: string, unitCost: string) {
  await adjustments.createDraft({
    id: `SEED-${itemId}`,
    date: "2026-01-01",
    memo: "seed",
    lines: [{ itemId, warehouseId, reason: "INITIAL_STOCK", direction: "IN", qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) }],
  });
  await adjustments.confirm(`SEED-${itemId}`);
}

describe("PhysicalCountService — count → variance → adjustment flow", () => {
  it("snapshots system qty at start, computes variance, and generates a matching adjustment", async () => {
    const { counts, adjustments, stockLedger } = harness();
    await seed(adjustments, "I1", "W1", "10", "5"); // system will read 10
    await seed(adjustments, "I2", "W1", "6", "3");

    const count = await counts.start({
      id: "C1",
      warehouseId: "W1",
      date: "2026-02-01",
      itemIds: ["I1", "I2"],
    });
    expect(count.status).toBe("IN_PROGRESS");
    expect(count.countNo).toBe("CNT-000001");
    expect(count.lines.find((l) => l.itemId === "I1")?.systemQty.toString()).toBe("10.000000");

    // Counted: I1 short by 2 (8 counted vs 10 system) -> OUT variance.
    // I2 over by 1 (7 counted vs 6 system) -> IN variance at current avg cost (3).
    await counts.recordCounts("C1", [
      { itemId: "I1", countedQty: Qty.fromMajor("8") },
      { itemId: "I2", countedQty: Qty.fromMajor("7") },
    ]);
    const completed = await counts.complete("C1");
    expect(completed.status).toBe("COMPLETED");

    const { count: finalCount, adjustment } = await counts.generateAdjustment({
      countId: "C1",
      adjustmentId: "ADJGEN1",
    });
    expect(finalCount.status).toBe("ADJUSTMENT_GENERATED");
    expect(finalCount.generatedAdjustmentId).toBe("ADJGEN1");
    expect(adjustment?.status).toBe("confirmed");
    expect(adjustment?.docNo).toBe("ADJ-000003"); // after the 2 seed adjustments

    expect((await stockLedger.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("8.000000");
    expect((await stockLedger.getBalanceDetail("I2", "W1")).onHand.toString()).toBe("7.000000");

    const adjLines = adjustment?.lines ?? [];
    expect(adjLines).toHaveLength(2);
    const i1Line = adjLines.find((l) => l.itemId === "I1");
    const i2Line = adjLines.find((l) => l.itemId === "I2");
    expect(i1Line?.direction).toBe("OUT");
    expect(i1Line?.qty.toString()).toBe("2.000000");
    expect(i2Line?.direction).toBe("IN");
    expect(i2Line?.qty.toString()).toBe("1.000000");
    expect(i2Line?.unitCost?.toString()).toBe("3.000000"); // priced at I2's current average cost
    expect(adjLines.every((l) => l.reason === "PHYSICAL_COUNT")).toBe(true);
  });

  it("generates no adjustment document when every counted line matches system qty", async () => {
    const { counts, adjustments } = harness();
    await seed(adjustments, "I1", "W1", "10", "5");
    await counts.start({ id: "C1", warehouseId: "W1", date: "2026-02-01", itemIds: ["I1"] });
    await counts.recordCounts("C1", [{ itemId: "I1", countedQty: Qty.fromMajor("10") }]);
    await counts.complete("C1");
    const { count, adjustment } = await counts.generateAdjustment({ countId: "C1", adjustmentId: "ADJGEN1" });
    expect(count.status).toBe("ADJUSTMENT_GENERATED");
    expect(count.generatedAdjustmentId).toBeNull();
    expect(adjustment).toBeNull();
  });

  it("rejects completing a count before every line is counted", async () => {
    const { counts, adjustments } = harness();
    await seed(adjustments, "I1", "W1", "10", "5");
    await seed(adjustments, "I2", "W1", "6", "3");
    await counts.start({ id: "C1", warehouseId: "W1", date: "2026-02-01", itemIds: ["I1", "I2"] });
    await counts.recordCounts("C1", [{ itemId: "I1", countedQty: Qty.fromMajor("10") }]);
    await expect(counts.complete("C1")).rejects.toThrow();
  });

  it("rejects generating an adjustment before the count is completed", async () => {
    const { counts, adjustments } = harness();
    await seed(adjustments, "I1", "W1", "10", "5");
    await counts.start({ id: "C1", warehouseId: "W1", date: "2026-02-01", itemIds: ["I1"] });
    await expect(counts.generateAdjustment({ countId: "C1", adjustmentId: "A1" })).rejects.toThrow();
  });

  it("cancel is blocked once an adjustment has been generated", async () => {
    const { counts, adjustments } = harness();
    await seed(adjustments, "I1", "W1", "10", "5");
    await counts.start({ id: "C1", warehouseId: "W1", date: "2026-02-01", itemIds: ["I1"] });
    await counts.recordCounts("C1", [{ itemId: "I1", countedQty: Qty.fromMajor("10") }]);
    await counts.complete("C1");
    await counts.generateAdjustment({ countId: "C1", adjustmentId: "A1" });
    await expect(counts.cancel("C1")).rejects.toThrow();
  });
});
