import type { Money, Qty } from "../money/index.js";

export enum StockPositionFault {
  ValueWithoutQuantity = "value_without_quantity",
  NegativeValue = "negative_value",
}

export interface StockPositionFaultRow {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly onHand: Qty;
  readonly totalValue: Money;
  readonly fault: StockPositionFault;
}

export function stockPositionFaults(
  positions: readonly { readonly itemId: string; readonly warehouseId: string; readonly onHand: Qty; readonly totalValue: Money }[],
): StockPositionFaultRow[] {
  const found: StockPositionFaultRow[] = [];
  for (const { itemId, warehouseId, onHand, totalValue } of positions) {
    if (onHand.isZero() && totalValue.scaled !== 0n) found.push({ itemId, warehouseId, onHand, totalValue, fault: StockPositionFault.ValueWithoutQuantity });
    else if (!onHand.isZero() && !onHand.isNegative() && totalValue.scaled < 0n) found.push({ itemId, warehouseId, onHand, totalValue, fault: StockPositionFault.NegativeValue });
  }
  return found;
}
