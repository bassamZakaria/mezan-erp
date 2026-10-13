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
  return positions.flatMap((position) => {
    const { itemId, warehouseId, onHand, totalValue } = position;
    if (onHand.isZero() && totalValue.scaled !== 0n) return [{ itemId, warehouseId, onHand, totalValue, fault: StockPositionFault.ValueWithoutQuantity }];
    if (!onHand.isZero() && !onHand.isNegative() && totalValue.scaled < 0n) return [{ itemId, warehouseId, onHand, totalValue, fault: StockPositionFault.NegativeValue }];
    return [];
  });
}
