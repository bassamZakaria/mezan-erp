import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockPositionFault, stockPositionFaults } from "./stock-position-faults.js";

const position = (itemId: string, onHand: string, totalValue: string) => ({ itemId, warehouseId: "WH1", onHand: Qty.fromMajor(onHand), totalValue: Money.fromMajor(totalValue) });

describe("stock positions the books cannot stand behind", () => {
  it("names a position holding value with no quantity, and one holding quantity below zero value, and nothing else", () => {
    const found = stockPositionFaults([
      position("ok", "3", "18"),
      position("empty", "0", "0"),
      position("free", "2", "0"),
      position("stranded", "0", "-30"),
      position("negative", "1", "-2"),
      position("short", "-3", "-300"),
    ]);
    expect(found.map((row) => [row.itemId, row.fault])).toEqual([
      ["stranded", StockPositionFault.ValueWithoutQuantity],
      ["negative", StockPositionFault.NegativeValue],
    ]);
  });
});
