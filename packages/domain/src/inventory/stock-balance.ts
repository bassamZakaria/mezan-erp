/**
 * أرصدة المخزون (Stock Balance) — the cross-warehouse rollup (docs/catalog/03
 * §"أرصدة المخزون": "cross-item stock levels list"). Pure aggregation over the
 * cached `WacSnapshot`s the stock-ledger engine already maintains
 * (`StockLedgerService.getValuation()`) — no new persistence, no new engine
 * state. Optionally scoped to one warehouse.
 */

import { Money, Qty } from "../money/index.js";
import { unitCostOf } from "./wac-math.js";
import type { WacSnapshot } from "./ports.js";

export interface StockBalanceRow {
  readonly itemId: string;
  /** Total on-hand quantity for the item, across every warehouse in scope. */
  readonly onHand: Qty;
  readonly totalValue: Money;
  /** Weighted-average unit cost across the rolled-up quantity. */
  readonly averageCost: Money;
  /** Number of distinct warehouse positions rolled into this row. */
  readonly warehouseCount: number;
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

  const byItem = new Map<string, { onHand: Qty; totalValue: Money; warehouseCount: number }>();
  for (const p of scoped) {
    const acc = byItem.get(p.itemId) ?? { onHand: Qty.zero(), totalValue: Money.zero(), warehouseCount: 0 };
    byItem.set(p.itemId, {
      onHand: acc.onHand.add(p.onHand),
      totalValue: acc.totalValue.add(p.totalValue),
      warehouseCount: acc.warehouseCount + 1,
    });
  }

  return [...byItem.entries()]
    .map(([itemId, v]) => ({
      itemId,
      onHand: v.onHand,
      totalValue: v.totalValue,
      averageCost: unitCostOf(v.totalValue, v.onHand),
      warehouseCount: v.warehouseCount,
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}
