import { Money, Qty } from "../money/index.js";
import { layerRemainingValue, orderLayersForConsumption, type CostLayer } from "../inventory/cost-layer.js";

export interface ExpiredBatchSlice {
  readonly layerId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly qty: Qty;
  readonly value: Money;
}

export interface ExpiredWriteOffLine {
  readonly itemId: string;
  readonly qty: Qty;
  readonly value: Money;
  readonly batches: readonly ExpiredBatchSlice[];
}

/**
 * INVARIANT: expired layers always sit at the head of the FEFO order, so an
 * EXPIRY adjustment OUT of exactly `qty` consumes exactly these layers and no
 * good stock. Changing `compareLayersForConsumption` breaks that guarantee.
 */
export function expiredWriteOffLines(input: {
  readonly layers: readonly CostLayer[];
  readonly warehouseId: string;
  readonly asOf: string;
  readonly itemIds?: ReadonlySet<string>;
}): ExpiredWriteOffLine[] {
  const byItem = new Map<string, CostLayer[]>();
  for (const layer of input.layers) {
    if (layer.warehouseId !== input.warehouseId) continue;
    if (input.itemIds && !input.itemIds.has(layer.itemId)) continue;
    const list = byItem.get(layer.itemId) ?? [];
    list.push(layer);
    byItem.set(layer.itemId, list);
  }
  const lines: ExpiredWriteOffLine[] = [];
  for (const [itemId, layers] of byItem) {
    const batches: ExpiredBatchSlice[] = [];
    for (const layer of orderLayersForConsumption(layers)) {
      if (layer.remainingQty.scaled <= 0n) continue;
      if (!layer.expiryDate || layer.expiryDate >= input.asOf) break;
      batches.push({
        layerId: layer.id,
        batchNo: layer.batchNo ?? null,
        expiryDate: layer.expiryDate,
        qty: layer.remainingQty,
        value: layerRemainingValue(layer),
      });
    }
    if (batches.length === 0) continue;
    lines.push({
      itemId,
      qty: Qty.sum(batches.map((b) => b.qty)),
      value: Money.sum(batches.map((b) => b.value)),
      batches,
    });
  }
  return lines.sort((a, b) => a.itemId.localeCompare(b.itemId));
}

export function expiredQtyAtHead(layers: readonly CostLayer[], asOf: string): Qty {
  let qty = Qty.zero();
  for (const layer of orderLayersForConsumption(layers)) {
    if (layer.remainingQty.scaled <= 0n) continue;
    if (!layer.expiryDate || layer.expiryDate >= asOf) break;
    qty = qty.add(layer.remainingQty);
  }
  return qty;
}

export class ExpiryWriteOffExceedsExpiredError extends Error {
  readonly code = "EXPIRY_WRITE_OFF_EXCEEDS_EXPIRED";
  readonly messageEn: string;
  constructor(
    readonly itemId: string,
    readonly itemLabel: string,
    readonly requested: Qty,
    readonly expired: Qty,
  ) {
    super(
      `الصنف "${itemLabel}": كمية شطب انتهاء الصلاحية ${requested.toString()} أكبر من الرصيد المنتهي فعلاً ${expired.toString()} — ` +
        `الباقي سليم الصلاحية ولا يُشطب بهذا السبب.`,
    );
    this.messageEn =
      `Item "${itemLabel}": the expiry write-off of ${requested.toString()} exceeds the ${expired.toString()} actually expired — ` +
      `the rest is still in date and cannot be written off as expired.`;
    this.name = "ExpiryWriteOffExceedsExpiredError";
  }
}
