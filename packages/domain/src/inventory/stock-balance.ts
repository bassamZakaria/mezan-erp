/**
 * أرصدة المخزون (Stock Balance) — the cross-warehouse rollup (docs/archive/catalog/03
 * §"أرصدة المخزون": "cross-item stock levels list"). Pure aggregation over the
 * cached `WacSnapshot`s the stock-ledger engine already maintains
 * (`StockLedgerService.getValuation()`) — no new persistence, no new engine
 * state. Optionally scoped to one warehouse.
 */

import { Money, Qty } from "../money/index.js";
import { unitCostOf } from "./wac-math.js";
import type { WacSnapshot } from "./ports.js";

/** One warehouse's share of a rolled-up row (R5.7's expandable breakdown). */
export interface StockBalanceWarehouseRow {
  readonly warehouseId: string;
  readonly onHand: Qty;
  readonly totalValue: Money;
  readonly averageCost: Money;
}

export interface StockBalanceRow {
  readonly itemId: string;
  /** Total on-hand quantity for the item, across every warehouse in scope. */
  readonly onHand: Qty;
  readonly totalValue: Money;
  /** Weighted-average unit cost across the rolled-up quantity. */
  readonly averageCost: Money;
  /** Number of distinct warehouse positions rolled into this row. */
  readonly warehouseCount: number;
  /**
   * The positions the row rolled up. Carried so the screen can expand a row
   * without a second round trip per item, and so the breakdown always sums to
   * the total beside it (R5.7).
   */
  readonly warehouses: readonly StockBalanceWarehouseRow[];
}

export interface StockBalanceRollupOptions {
  /** Restrict the rollup to one warehouse (still rolled up — one row per item). */
  readonly warehouseId?: string;
}

/** Roll cached per-(item, warehouse) snapshots up into one row per item. */
export function rollupStockBalance(
  positions: readonly WacSnapshot[],
  options: StockBalanceRollupOptions = {},
): readonly StockBalanceRow[] {
  const scoped = options.warehouseId
    ? positions.filter((p) => p.warehouseId === options.warehouseId)
    : positions;

  const byItem = new Map<
    string,
    { onHand: Qty; totalValue: Money; warehouses: StockBalanceWarehouseRow[] }
  >();
  for (const p of scoped) {
    const acc = byItem.get(p.itemId) ?? { onHand: Qty.zero(), totalValue: Money.zero(), warehouses: [] };
    acc.warehouses.push({
      warehouseId: p.warehouseId,
      onHand: p.onHand,
      totalValue: p.totalValue,
      averageCost: p.averageCost,
    });
    byItem.set(p.itemId, {
      onHand: acc.onHand.add(p.onHand),
      totalValue: acc.totalValue.add(p.totalValue),
      warehouses: acc.warehouses,
    });
  }

  return [...byItem.entries()]
    .map(([itemId, v]) => ({
      itemId,
      onHand: v.onHand,
      totalValue: v.totalValue,
      averageCost: unitCostOf(v.totalValue, v.onHand),
      warehouseCount: v.warehouses.length,
      warehouses: [...v.warehouses].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId)),
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}
