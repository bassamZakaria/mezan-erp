import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { lineVarianceOf, summarizePhysicalCountVariance, varianceLinesOf } from "./physical-count-variance.js";
import type { PhysicalCount, PhysicalCountLine } from "./physical-count.js";

function line(overrides: Partial<PhysicalCountLine> = {}): PhysicalCountLine {
  return { itemId: "item-1", systemQty: Qty.fromMajor("10"), unitCost: Money.fromMajor("20.00"), countedQty: null, recount: false, ...overrides };
}

function count(lines: readonly PhysicalCountLine[]): PhysicalCount {
  return {
    id: "count-1",
    countNo: "COUNT-000001",
    warehouseId: "wh-1",
    date: "2026-03-01",
    memo: "",
    status: "COMPLETED",
    blind: false,
    zoned: false,
    lines,
    createdAt: "2026-03-01T00:00:00.000Z",
    completedAt: "2026-03-01T10:00:00.000Z",
    generatedAdjustmentId: null,
  };
}

describe("lineVarianceOf", () => {
  it("is null/null until the line is counted", () => {
    const variance = lineVarianceOf(line({ countedQty: null }));
    expect(variance.varianceQty).toBeNull();
    expect(variance.varianceValue).toBeNull();
    expect(variance.systemQty.toString()).toBe("10.000000");
  });

  it("an over count values the variance at the snapshotted unit cost — qty and money move together", () => {
    const variance = lineVarianceOf(line({ systemQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("13"), unitCost: Money.fromMajor("20.00") }));
    expect(variance.varianceQty!.toString()).toBe("3.000000");
    expect(variance.varianceValue!.toString()).toBe("60.000000"); // 3 * 20
  });

  it("a short count is the exact negative of the equivalent over count", () => {
    const short = lineVarianceOf(line({ systemQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("7"), unitCost: Money.fromMajor("20.00") }));
    const over = lineVarianceOf(line({ systemQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("13"), unitCost: Money.fromMajor("20.00") }));
    expect(short.varianceQty!.toString()).toBe("-3.000000");
    expect(short.varianceValue!.toString()).toBe("-60.000000");
    expect(short.varianceQty!.equals(over.varianceQty!.negate())).toBe(true);
    expect(short.varianceValue!.equals(over.varianceValue!.negate())).toBe(true);
  });

  it("a matched count (counted exactly equals system) is a real zero variance, not uncounted", () => {
    const variance = lineVarianceOf(line({ systemQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("10") }));
    expect(variance.varianceQty).not.toBeNull();
    expect(variance.varianceQty!.isZero()).toBe(true);
    expect(variance.varianceValue).not.toBeNull();
    expect(variance.varianceValue!.equals(Money.zero())).toBe(true);
  });

  it("a count of zero units on hand is still counted, not treated as uncounted", () => {
    const variance = lineVarianceOf(line({ systemQty: Qty.fromMajor("5"), countedQty: Qty.zero() }));
    expect(variance.varianceQty).not.toBeNull();
    expect(variance.varianceQty!.toString()).toBe("-5.000000");
  });
});

describe("varianceLinesOf", () => {
  it("maps every line of the count in order", () => {
    const c = count([line({ itemId: "a" }), line({ itemId: "b", countedQty: Qty.fromMajor("11") })]);
    const lines = varianceLinesOf(c);
    expect(lines.map((l) => l.itemId)).toEqual(["a", "b"]);
    expect(lines[0]!.varianceQty).toBeNull();
    expect(lines[1]!.varianceQty!.toString()).toBe("1.000000");
  });
});

describe("summarizePhysicalCountVariance", () => {
  it("rolls up uncounted, matched, over and short lines with the money that agrees with the qty", () => {
    const c = count([
      line({ itemId: "uncounted", countedQty: null }),
      line({ itemId: "matched", systemQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("10"), unitCost: Money.fromMajor("20.00") }),
      line({ itemId: "over", systemQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("13"), unitCost: Money.fromMajor("20.00") }),
      line({ itemId: "short", systemQty: Qty.fromMajor("10"), countedQty: Qty.fromMajor("6"), unitCost: Money.fromMajor("15.00") }),
    ]);
    const summary = summarizePhysicalCountVariance(c);

    expect(summary.totalLines).toBe(4);
    expect(summary.countedLines).toBe(3);
    expect(summary.uncountedLines).toBe(1);
    expect(summary.matchedLines).toBe(1);
    expect(summary.overLines).toBe(1);
    expect(summary.shortLines).toBe(1);

    expect(summary.overQty.toString()).toBe("3.000000");
    expect(summary.overValue.toString()).toBe("60.000000"); // 3 * 20
    expect(summary.shortQty.toString()).toBe("4.000000");
    expect(summary.shortValue.toString()).toBe("60.000000"); // 4 * 15

    expect(summary.netQty.toString()).toBe("-1.000000"); // 3 over - 4 short
    expect(summary.netValue.toString()).toBe("0.000000"); // 60 over - 60 short cancels out
    expect(summary.absValue.toString()).toBe("120.000000"); // 60 + 60 does NOT cancel — total value at risk
  });

  it("an all-uncounted count summarizes to all zeros", () => {
    const c = count([line({ countedQty: null }), line({ itemId: "b", countedQty: null })]);
    const summary = summarizePhysicalCountVariance(c);
    expect(summary.countedLines).toBe(0);
    expect(summary.uncountedLines).toBe(2);
    expect(summary.overQty.isZero()).toBe(true);
    expect(summary.shortQty.isZero()).toBe(true);
    expect(summary.netValue.equals(Money.zero())).toBe(true);
  });

  it("a count with zero lines summarizes to all zeros, not an error", () => {
    const summary = summarizePhysicalCountVariance(count([]));
    expect(summary.totalLines).toBe(0);
    expect(summary.countedLines).toBe(0);
    expect(summary.overValue.equals(Money.zero())).toBe(true);
    expect(summary.absValue.equals(Money.zero())).toBe(true);
  });
});
