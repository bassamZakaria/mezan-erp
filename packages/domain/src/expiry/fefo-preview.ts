import { Qty } from "../money/index.js";
import { orderLayersForConsumption, type CostLayer } from "../inventory/cost-layer.js";
import { expiryDaysBetween } from "./dates.js";

export interface FefoPreviewSlice {
  readonly layerId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly daysToExpiry: number | null;
  readonly expired: boolean;
  readonly available: Qty;
  readonly take: Qty;
}

export interface FefoPreview {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly asOf: string;
  readonly requested: Qty;
  readonly onHandInLayers: Qty;
  readonly covered: Qty;
  readonly shortfall: Qty;
  readonly blockedByExpired: boolean;
  readonly expiredQty: Qty;
  readonly slices: readonly FefoPreviewSlice[];
}

export function previewFefo(input: {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly layers: readonly CostLayer[];
  readonly requested: Qty | null;
  readonly asOf: string;
}): FefoPreview {
  const ordered = orderLayersForConsumption(input.layers.filter((l) => l.remainingQty.scaled > 0n));
  const onHandInLayers = Qty.sum(ordered.map((l) => l.remainingQty));
  const requested = input.requested ?? onHandInLayers;
  const slices: FefoPreviewSlice[] = [];
  let remaining = requested;
  let expiredQty = Qty.zero();
  for (const layer of ordered) {
    const expired = layer.expiryDate ? layer.expiryDate < input.asOf : false;
    if (expired) expiredQty = expiredQty.add(layer.remainingQty);
    let take = Qty.zero();
    if (remaining.scaled > 0n) take = layer.remainingQty.compare(remaining) <= 0 ? layer.remainingQty : remaining;
    remaining = remaining.subtract(take);
    slices.push({
      layerId: layer.id,
      batchNo: layer.batchNo ?? null,
      expiryDate: layer.expiryDate ?? null,
      daysToExpiry: layer.expiryDate ? expiryDaysBetween(input.asOf, layer.expiryDate) : null,
      expired,
      available: layer.remainingQty,
      take,
    });
  }
  const shortfall = remaining.scaled > 0n ? remaining : Qty.zero();
  const firstTaken = slices.find((s) => s.take.scaled > 0n) ?? slices[0];
  return {
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    asOf: input.asOf,
    requested,
    onHandInLayers,
    covered: requested.subtract(shortfall),
    shortfall,
    blockedByExpired: firstTaken?.expired ?? false,
    expiredQty,
    slices,
  };
}
