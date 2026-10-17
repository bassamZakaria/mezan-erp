import { Money, Qty } from "../money/index.js";
import { layerRemainingValue, orderLayersForConsumption, type CostLayer } from "../inventory/cost-layer.js";
import { ExpiryStatus } from "./types.js";
import { expiryDaysBetween } from "./dates.js";

export interface BatchStockRow {
  readonly key: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly daysToExpiry: number | null;
  readonly status: ExpiryStatus;
  readonly qty: Qty;
  readonly value: Money;
  readonly firstReceivedOn: string;
  readonly layerIds: readonly string[];
  readonly fefoRank: number;
}

export function expiryStatusOf(expiryDate: string | null, today: string, nearExpiryDays: number): ExpiryStatus {
  if (!expiryDate) return ExpiryStatus.NoExpiry;
  const days = expiryDaysBetween(today, expiryDate);
  if (days < 0) return ExpiryStatus.Expired;
  if (days <= nearExpiryDays) return ExpiryStatus.NearExpiry;
  return ExpiryStatus.Ok;
}

export interface BatchStockOptions {
  readonly today: string;
  readonly nearExpiryDays: number;
  readonly trackedItemIds?: ReadonlySet<string>;
}

export function summarizeBatchStock(layers: readonly CostLayer[], options: BatchStockOptions): BatchStockRow[] {
  const byPosition = new Map<string, CostLayer[]>();
  for (const layer of layers) {
    if (layer.remainingQty.scaled <= 0n) continue;
    const tracked = options.trackedItemIds?.has(layer.itemId) ?? false;
    if (!tracked && !layer.batchNo && !layer.expiryDate) continue;
    const key = JSON.stringify([layer.itemId, layer.warehouseId]);
    const list = byPosition.get(key) ?? [];
    list.push(layer);
    byPosition.set(key, list);
  }

  const rows: BatchStockRow[] = [];
  for (const positionLayers of byPosition.values()) {
    const ordered = orderLayersForConsumption(positionLayers);
    const groups = new Map<string, { layers: CostLayer[]; rank: number }>();
    ordered.forEach((layer, index) => {
      const key = JSON.stringify([layer.batchNo ?? "", layer.expiryDate ?? ""]);
      const group = groups.get(key) ?? { layers: [], rank: index };
      group.layers.push(layer);
      groups.set(key, group);
    });
    let rank = 0;
    for (const group of [...groups.values()].sort((a, b) => a.rank - b.rank)) {
      rank += 1;
      const head = group.layers[0] as CostLayer;
      const expiryDate = head.expiryDate ?? null;
      rows.push({
        key: `${head.itemId}|${head.warehouseId}|${head.batchNo ?? ""}|${expiryDate ?? ""}`,
        itemId: head.itemId,
        warehouseId: head.warehouseId,
        batchNo: head.batchNo ?? null,
        expiryDate,
        daysToExpiry: expiryDate ? expiryDaysBetween(options.today, expiryDate) : null,
        status: expiryStatusOf(expiryDate, options.today, options.nearExpiryDays),
        qty: Qty.sum(group.layers.map((l) => l.remainingQty)),
        value: Money.sum(group.layers.map(layerRemainingValue)),
        firstReceivedOn: group.layers.map((l) => l.createdAt.slice(0, 10)).sort()[0] as string,
        layerIds: group.layers.map((l) => l.id),
        fefoRank: rank,
      });
    }
  }
  return rows.sort((a, b) => {
    if (a.itemId !== b.itemId) return a.itemId.localeCompare(b.itemId);
    if (a.warehouseId !== b.warehouseId) return a.warehouseId.localeCompare(b.warehouseId);
    return a.fefoRank - b.fefoRank;
  });
}
