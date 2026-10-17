import { Money, Qty } from "../money/index.js";
import type { StockMovement } from "../inventory/movement.js";
import { replay } from "../inventory/wac.js";
import { unitCostOf } from "../inventory/wac-math.js";

export function movementsThrough(movements: readonly StockMovement[], date: string): StockMovement[] {
  return movements.filter((movement) => movement.occurredAt.slice(0, 10) <= date);
}

export function pooledUnitCostAsOf(positions: readonly { readonly itemId: string; readonly warehouseId: string; readonly movements: readonly StockMovement[] }[], date: string): Money | null {
  let onHand = 0n;
  let value = 0n;
  for (const position of positions) {
    const through = movementsThrough(position.movements, date);
    if (through.length === 0) continue;
    const replayed = replay(position.itemId, position.warehouseId, through);
    if (replayed.onHand.scaled <= 0n) continue;
    onHand += replayed.onHand.scaled;
    value += replayed.totalValue.scaled;
  }
  if (onHand <= 0n) return null;
  return unitCostOf(Money.fromScaled(value), Qty.fromScaled(onHand));
}
