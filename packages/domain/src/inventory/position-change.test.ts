import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockChangeKind, changeStockPosition } from "./position-change.js";

const holding = (onHand: string, totalValue: string) => ({ onHand: Qty.fromMajor(onHand), totalValue: Money.fromMajor(totalValue) });
const shown = (result: ReturnType<typeof changeStockPosition>) => ({
  position: [result.onHand.toString(), result.totalValue.toString()],
  valueChange: result.valueChange.toString(),
  difference: result.difference.toString(),
});

describe("a removal from a stock position", () => {
  it("leaves at the moving average and hands back what the document expected beyond it", () => {
    const result = changeStockPosition(holding("5", "25"), { kind: StockChangeKind.Removal, qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("5"), stated: Money.fromMajor("36") });
    expect(shown(result)).toEqual({ position: ["1.000000", "5.000000"], valueChange: "-20.000000", difference: "-16.000000" });
  });

  it("takes the whole value held when it drains the position, whatever the rounded average says", () => {
    const result = changeStockPosition(holding("3", "3.000002"), { kind: StockChangeKind.Removal, qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("1.000001") });
    expect(shown(result)).toEqual({ position: ["0.000000", "0.000000"], valueChange: "-3.000002", difference: "0.000000" });
  });

  it("never takes more than the value held while units remain", () => {
    const result = changeStockPosition(holding("7", "0.000004"), { kind: StockChangeKind.Removal, qty: Qty.fromMajor("6"), unitCost: Money.fromMajor("0.000001") });
    expect(shown(result).position).toEqual(["1.000000", "0.000000"]);
  });

  it("takes at least the whole value held when it leaves the position short", () => {
    const result = changeStockPosition(holding("3", "0.000001"), { kind: StockChangeKind.Removal, qty: Qty.fromMajor("4"), unitCost: Money.zero() });
    expect(shown(result).position).toEqual(["-1.000000", "0.000000"]);
  });

  it("replays the value the ledger recorded for it, whatever the position holds when it is replayed", () => {
    const recorded = changeStockPosition(holding("5", "25"), { kind: StockChangeKind.Removal, qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("5"), recorded: Money.fromMajor("9") });
    expect(shown(recorded).position).toEqual(["3.000000", "16.000000"]);
    const outOfOrder = changeStockPosition(holding("2", "9.5"), { kind: StockChangeKind.Removal, qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("5"), recorded: Money.fromMajor("9") });
    expect(shown(outOfOrder).position).toEqual(["0.000000", "0.500000"]);
  });

  it("drains a position to nothing when the ledger recorded no value for the movement", () => {
    const legacy = changeStockPosition(holding("2", "9.5"), { kind: StockChangeKind.Removal, qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("5"), recorded: null });
    expect(shown(legacy).position).toEqual(["0.000000", "0.000000"]);
  });
});

describe("an addition to a stock position", () => {
  it("enters at what the document stated when the position is not short", () => {
    const result = changeStockPosition(holding("1", "100"), { kind: StockChangeKind.Addition, qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("1.000001"), stated: Money.fromMajor("3.000002") });
    expect(shown(result)).toEqual({ position: ["4.000000", "103.000002"], valueChange: "3.000002", difference: "0.000000" });
    expect(result.layeredQty.toString()).toBe("3.000000");
  });

  it("covers the shortfall at the value it carried and layers only the excess, handing back the difference", () => {
    const result = changeStockPosition(holding("-3", "-300"), { kind: StockChangeKind.Addition, qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("90"), stated: Money.fromMajor("450") });
    expect(shown(result)).toEqual({ position: ["2.000000", "180.000000"], valueChange: "480.000000", difference: "-30.000000" });
    expect(result.layeredQty.toString()).toBe("2.000000");
  });

  it("levels a shortfall that wrongly carries positive value to nothing, and the whole of it is handed back to book", () => {
    const result = changeStockPosition(holding("-2", "5"), { kind: StockChangeKind.Addition, qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("10"), stated: Money.fromMajor("30") });
    expect(shown(result)).toEqual({ position: ["1.000000", "10.000000"], valueChange: "5.000000", difference: "25.000000" });
  });
});

describe("a value-only change to a stock position", () => {
  const revalue = (held: ReturnType<typeof holding>, delta: string, receipt: { remaining: bigint; original: bigint } | null) =>
    shown(changeStockPosition(held, { kind: StockChangeKind.Revaluation, delta: Money.fromMajor(delta), receipt }));

  it("is absorbed in full by a receipt whose goods are all still on hand", () => {
    expect(revalue(holding("10", "500"), "100", { remaining: 10_000000n, original: 10_000000n })).toEqual({ position: ["10.000000", "600.000000"], valueChange: "100.000000", difference: "0.000000" });
  });

  it("is absorbed only in the share the receipt still has on hand; the rest is handed back", () => {
    expect(revalue(holding("2", "180"), "50", { remaining: 2_000000n, original: 5_000000n })).toEqual({ position: ["2.000000", "200.000000"], valueChange: "20.000000", difference: "30.000000" });
  });

  it("is handed back whole when none of the receipt's goods are on hand", () => {
    expect(revalue(holding("0", "0"), "25", { remaining: 0n, original: 10_000000n })).toEqual({ position: ["0.000000", "0.000000"], valueChange: "0.000000", difference: "25.000000" });
    expect(revalue(holding("4", "40"), "25", { remaining: 0n, original: 10_000000n }).difference).toBe("25.000000");
  });

  it("never drives the value held below zero: a reduction beyond it is handed back", () => {
    expect(revalue(holding("1", "60"), "-100", { remaining: 1_000000n, original: 1_000000n })).toEqual({ position: ["1.000000", "0.000000"], valueChange: "-60.000000", difference: "-40.000000" });
  });

  it("lands on the position itself when no receipt is named, and on nothing when the position is empty or short", () => {
    expect(revalue(holding("3", "30"), "9", null).position).toEqual(["3.000000", "39.000000"]);
    expect(revalue(holding("0", "0"), "9", null)).toEqual({ position: ["0.000000", "0.000000"], valueChange: "0.000000", difference: "9.000000" });
    expect(revalue(holding("-2", "-20"), "9", { remaining: 1_000000n, original: 1_000000n }).difference).toBe("9.000000");
  });

  it("replays the share the ledger recorded as absorbed", () => {
    const replayed = changeStockPosition(holding("0", "0"), { kind: StockChangeKind.Revaluation, delta: Money.fromMajor("-100"), receipt: null, recorded: Money.fromMajor("-60") });
    expect(shown(replayed)).toEqual({ position: ["0.000000", "-60.000000"], valueChange: "-60.000000", difference: "-40.000000" });
  });

  it("takes back no more than the change it undoes was able to add", () => {
    const undone = changeStockPosition(holding("1", "0"), { kind: StockChangeKind.Revaluation, delta: Money.fromMajor("100"), receipt: { remaining: 1_000000n, original: 1_000000n }, undoes: Money.fromMajor("-60") });
    expect(shown(undone)).toEqual({ position: ["1.000000", "60.000000"], valueChange: "60.000000", difference: "40.000000" });
  });
});
