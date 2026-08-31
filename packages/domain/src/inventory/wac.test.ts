import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { extend, unitCostOf } from "./wac-math.js";
import { replay, runningBalance, checkDrift, emptyPosition, type WacPosition } from "./wac.js";
import type { StockMovement, StockMovementDirection } from "./movement.js";

let seq = 0;
function mv(
  direction: StockMovementDirection,
  qty: string,
  unitCost: string,
): StockMovement {
  seq += 1;
  return {
    id: `M${seq}`,
    itemId: "I1",
    warehouseId: "W1",
    direction,
    qty: Qty.fromMajor(qty),
    unitCost: Money.fromMajor(unitCost),
    sourceDocType: "ADJUSTMENT",
    sourceDocId: "D1",
    sourceDocNumber: null,
    reason: null,
    occurredAt: `2026-01-01T00:00:0${seq % 10}.000Z`,
  };
}

describe("wac-math — exact scaled-integer arithmetic (no floats)", () => {
  it("extend rounds qty × unitCost HALF_UP to scale 1e-6", () => {
    // 3 × 1.666667 = 5.000001 exactly at scale 6
    expect(extend(Qty.fromMajor("3"), Money.fromMajor("1.666667")).toString()).toBe("5.000001");
    // 2.5 × 4 = 10
    expect(extend(Qty.fromMajor("2.5"), Money.fromMajor("4")).toString()).toBe("10.000000");
    // 0.5 × 0.000001 = 0.0000005 → 0.000001 (half rounds away from zero)
    expect(extend(Qty.fromMajor("0.5"), Money.fromScaled(1)).toString()).toBe("0.000001");
  });

  it("unitCostOf divides value by qty HALF_UP, and is 0 for empty stock", () => {
    expect(unitCostOf(Money.fromMajor("5"), Qty.fromMajor("3")).toString()).toBe("1.666667");
    expect(unitCostOf(Money.fromMajor("120"), Qty.fromMajor("20")).toString()).toBe("6.000000");
    expect(unitCostOf(Money.fromMajor("100"), Qty.zero()).toString()).toBe("0.000000");
  });
});

describe("WAC engine — golden fixtures (deterministic, byte-exact)", () => {
  it("classic weighted-average across receipts and an issue", () => {
    const movements = [
      mv("IN", "10", "5"), // value 50, qty 10, avg 5
      mv("IN", "10", "7"), // value 120, qty 20, avg 6
      mv("OUT", "5", "0"), // issue at avg 6 → cogs 30, value 90, qty 15
      mv("IN", "5", "9"), // value 135, qty 20, avg 6.75
    ];
    const pos = replay("I1", "W1", movements);
    expect(pos.onHand.toString()).toBe("20.000000");
    expect(pos.totalValue.toString()).toBe("135.000000");
    expect(pos.averageCost.toString()).toBe("6.750000");
    expect(runningBalance(movements).toString()).toBe("20.000000");
  });

  it("issue does not change the moving average", () => {
    const movements = [mv("IN", "10", "5"), mv("IN", "10", "7"), mv("OUT", "8", "0")];
    const pos = replay("I1", "W1", movements);
    expect(pos.averageCost.toString()).toBe("6.000000"); // unchanged by the issue
    expect(pos.onHand.toString()).toBe("12.000000");
    expect(pos.totalValue.toString()).toBe("72.000000"); // 120 − 8×6
  });

  it("drains to exactly nothing, rather than to the documented sub-unit drift (D-S44)", () => {
    // avg = 5/3 = 1.666667 (rounded up), so issuing all three at that average
    // removes 5.000001 and used to leave −0.000001 behind. This fixture pinned
    // that residue as "documented drift" and it was a defect wearing a label:
    // once the quantity is zero the average is zero by definition, so value
    // with nothing behind it is invisible on every screen and accumulates per
    // item, per warehouse, forever.
    //
    // The last issue out of a position is now worth whatever is left in it, in
    // the live engine and in this replay alike — and the GL follows by
    // construction, because `postIssue` posts the same figure `applyMovement`
    // computes.
    const movements = [mv("IN", "1", "1"), mv("IN", "2", "2"), mv("OUT", "3", "0")];
    const pos = replay("I1", "W1", movements);
    expect(pos.onHand.toString()).toBe("0.000000");
    expect(pos.totalValue.toString()).toBe("0.000000");
  });

  it("still leaves a PARTIAL issue valued at the moving average, untouched", () => {
    // The drain-to-zero rule must not leak into ordinary issues: a partial
    // issue is still `qty × average`, which is what keeps the average stable
    // across an issue (the property directly above this one).
    const movements = [mv("IN", "1", "1"), mv("IN", "2", "2"), mv("OUT", "2", "0")];
    const pos = replay("I1", "W1", movements);
    expect(pos.onHand.toString()).toBe("1.000000");
    expect(pos.totalValue.toString()).toBe("1.666666"); // 5 − 2×1.666667
  });

  it("empty position replays to zero", () => {
    const pos = replay("I1", "W1", []);
    expect(pos).toEqual(emptyPosition("I1", "W1"));
  });
});

describe("WAC engine — immutable cost layers (FIFO draw-down)", () => {
  it("keeps each layer's receipt-time unit cost while drawing remaining qty FIFO", () => {
    const movements = [
      mv("IN", "10", "5"), // layer A: 10 @ 5
      mv("IN", "10", "7"), // layer B: 10 @ 7
      mv("OUT", "15", "0"), // consume A fully + 5 of B
    ];
    const pos = replay("I1", "W1", movements);
    expect(pos.layers).toHaveLength(1);
    const b = pos.layers[0];
    expect(b?.unitCost.toString()).toBe("7.000000"); // NOT rewritten by the WAC change
    expect(b?.remainingQty.toString()).toBe("5.000000");
    expect(b?.originalQty.toString()).toBe("10.000000");
  });
});

describe("WAC engine — drift / rebuild reconciliation", () => {
  it("reports layer drift (by design) and zero cache drift for a correct cache", () => {
    const movements = [mv("IN", "10", "5"), mv("IN", "10", "7"), mv("OUT", "15", "0")];
    const recomputed = replay("I1", "W1", movements);
    const cached: WacPosition = recomputed; // a correctly-maintained cache
    const report = checkDrift(cached, movements);
    // WAC value = 120 − 15×6 = 30; layers value = 5 remaining @ 7 = 35 → layerDrift −5
    expect(report.recomputedValue.toString()).toBe("30.000000");
    expect(report.layersValue.toString()).toBe("35.000000");
    expect(report.layerDrift.toString()).toBe("-5.000000");
    expect(report.cacheDrift.toString()).toBe("0.000000");
    expect(report.withinTolerance).toBe(true);
  });

  it("detects a corrupted cache as nonzero cache drift, outside zero tolerance", () => {
    const movements = [mv("IN", "10", "5")];
    const recomputed = replay("I1", "W1", movements);
    const corrupted: WacPosition = {
      ...recomputed,
      totalValue: Money.fromMajor("40"), // wrong (should be 50)
      averageCost: Money.fromMajor("4"),
    };
    const report = checkDrift(corrupted, movements);
    expect(report.cacheDrift.toString()).toBe("10.000000"); // recomputed 50 − cached 40
    expect(report.withinTolerance).toBe(false);
    // A tolerance of 10 accepts it.
    expect(checkDrift(corrupted, movements, Money.fromMajor("10")).withinTolerance).toBe(true);
  });
});
