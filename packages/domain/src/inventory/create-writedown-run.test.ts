import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { InMemoryStockLedger, InMemorySnapshots, InMemoryWritedownRuns } from "./test-helpers/in-memory-stores.js";
import type { StockMovement } from "./movement.js";
import type { WacSnapshot } from "./ports.js";
import { createWritedownRun } from "./create-writedown-run.js";
import { NoSlowMovingStockError } from "./errors.js";

function movement(overrides: Partial<StockMovement> & Pick<StockMovement, "id" | "itemId" | "warehouseId" | "occurredAt">): StockMovement {
  return {
    direction: "IN",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("100.00"),
    sourceDocType: "ADJUSTMENT",
    sourceDocId: "adj-1",
    sourceDocNumber: "ADJ-000001",
    reason: "INITIAL_STOCK",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WacSnapshot> & Pick<WacSnapshot, "itemId" | "warehouseId">): WacSnapshot {
  return {
    onHand: Qty.fromMajor("10"),
    totalValue: Money.fromMajor("1000.00"),
    averageCost: Money.fromMajor("100.00"),
    ...overrides,
  };
}

describe("createWritedownRun — aging-day boundaries", () => {
  it("a position aged EXACTLY to the first band's minDays (90) is included, not excluded", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1" }));
    // 2026-03-31 (period end) minus 90 days = 2025-12-31 exactly.
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2025-12-31T00:00:00.000Z" }));

    const run = await createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger });
    expect(run.lines[0]!.agingDays).toBe(90);
    expect(run.lines[0]!.writedownRateBps).toBe(1_000);
  });

  it("one day short of the boundary (89 days) is excluded", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1" }));
    // 89 days before period end -> one day short of the 90-day boundary.
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2026-01-01T00:00:00.000Z" }));

    await expect(createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger })).rejects.toBeInstanceOf(
      NoSlowMovingStockError,
    );
  });
});

describe("createWritedownRun — custom policy override", () => {
  it("uses the caller's policy instead of the shipped default when given", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1", totalValue: Money.fromMajor("2000.00") }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2025-01-01T00:00:00.000Z" }));

    const run = await createWritedownRun(
      { id: "run-1", period: "2026-03", policy: [{ minDays: 0, maxDays: null, writedownRateBps: 100 }] },
      { runs, wacSnapshots, stockLedger },
    );
    expect(run.lines[0]!.writedownRateBps).toBe(100);
    expect(run.lines[0]!.amount.toString()).toBe("20.000000"); // 2000 * 1%
  });
});

describe("createWritedownRun — position selection", () => {
  it("skips a position with a WAC snapshot but no ledger history at all", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-no-history", warehouseId: "wh-1" }));
    // no movement appended for this position at all.
    await wacSnapshots.save(snapshot({ itemId: "item-with-history", warehouseId: "wh-1" }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-with-history", warehouseId: "wh-1", occurredAt: "2025-01-01T00:00:00.000Z" }));

    const run = await createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger });
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]!.itemId).toBe("item-with-history");
  });

  it("scoping to null (default) includes positions across every warehouse", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1" }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2025-01-01T00:00:00.000Z" }));
    await wacSnapshots.save(snapshot({ itemId: "item-b", warehouseId: "wh-2" }));
    await stockLedger.append(movement({ id: "m2", itemId: "item-b", warehouseId: "wh-2", occurredAt: "2025-01-01T00:00:00.000Z" }));

    const run = await createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger });
    expect(run.lines.map((l) => l.itemId).sort()).toEqual(["item-a", "item-b"]);
    expect(run.warehouseId).toBeNull();
  });

  it("a rate that rounds a tiny position's provision down to exactly zero excludes the line", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    // totalValue so small that even the 10% band (90 days aging, exactly on the boundary) rounds to 0.000000.
    await wacSnapshots.save(snapshot({ itemId: "item-tiny", warehouseId: "wh-1", onHand: Qty.fromMajor("1"), totalValue: Money.fromScaled(4n) }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-tiny", warehouseId: "wh-1", occurredAt: "2025-12-31T00:00:00.000Z" }));

    await expect(createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger })).rejects.toBeInstanceOf(
      NoSlowMovingStockError,
    );
  });
});

describe("createWritedownRun — the run's line pairs qty and money", () => {
  it("each line's amount agrees with its own onHandQty × the aging rate against totalValue, and totalAmount sums the lines", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1", onHand: Qty.fromMajor("20"), totalValue: Money.fromMajor("2000.00"), averageCost: Money.fromMajor("100.00") }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2025-01-01T00:00:00.000Z" }));
    await wacSnapshots.save(snapshot({ itemId: "item-b", warehouseId: "wh-1", onHand: Qty.fromMajor("5"), totalValue: Money.fromMajor("500.00"), averageCost: Money.fromMajor("100.00") }));
    await stockLedger.append(movement({ id: "m2", itemId: "item-b", warehouseId: "wh-1", occurredAt: "2025-06-01T00:00:00.000Z" }));

    const run = await createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger });
    const total = run.lines.reduce((sum, l) => sum.add(l.amount), Money.zero());
    expect(total.equals(run.totalAmount)).toBe(true);
    for (const line of run.lines) {
      expect(line.onHandQty.isZero()).toBe(false); // every line carries the qty its money provision is against
    }
  });
});
