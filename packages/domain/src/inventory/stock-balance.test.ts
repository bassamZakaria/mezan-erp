import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { rollupStockBalance } from "./stock-balance.js";
import type { WacSnapshot } from "./ports.js";

function snap(itemId: string, warehouseId: string, onHand: string, totalValue: string): WacSnapshot {
  return {
    itemId,
    warehouseId,
    onHand: Qty.fromMajor(onHand),
    totalValue: Money.fromMajor(totalValue),
    averageCost: Money.zero(),
  };
}

describe("rollupStockBalance — أرصدة المخزون cross-warehouse rollup", () => {
  it("sums on-hand and value for one item across every warehouse", () => {
    const rows = rollupStockBalance([
      snap("I1", "W1", "10", "50"),
      snap("I1", "W2", "4", "20"),
      snap("I2", "W1", "6", "18"),
    ]);
    expect(rows).toHaveLength(2);
    const i1 = rows.find((r) => r.itemId === "I1");
    expect(i1?.onHand.toString()).toBe("14.000000");
    expect(i1?.totalValue.toString()).toBe("70.000000");
    expect(i1?.averageCost.toString()).toBe("5.000000");
    expect(i1?.warehouseCount).toBe(2);

    const i2 = rows.find((r) => r.itemId === "I2");
    expect(i2?.onHand.toString()).toBe("6.000000");
    expect(i2?.warehouseCount).toBe(1);
  });

  it("scopes the rollup to one warehouse when requested", () => {
    const rows = rollupStockBalance(
      [snap("I1", "W1", "10", "50"), snap("I1", "W2", "4", "20")],
      { warehouseId: "W1" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.onHand.toString()).toBe("10.000000");
    expect(rows[0]?.warehouseCount).toBe(1);
  });

  it("returns an empty list for no positions", () => {
    expect(rollupStockBalance([])).toEqual([]);
  });

  it("sorts rows by itemId", () => {
    const rows = rollupStockBalance([snap("B", "W1", "1", "1"), snap("A", "W1", "1", "1")]);
    expect(rows.map((r) => r.itemId)).toEqual(["A", "B"]);
  });
});
