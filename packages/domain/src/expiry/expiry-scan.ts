import type { CostLayer } from "../inventory/cost-layer.js";
import { ExpiryAlertKind } from "./types.js";
import { expiryDaysBetween } from "./dates.js";

export interface DueExpiryAlert {
  readonly layer: CostLayer;
  readonly kind: ExpiryAlertKind;
  readonly daysToExpiry: number;
}

export function dueExpiryAlerts(layers: readonly CostLayer[], today: string, nearExpiryDays: number): DueExpiryAlert[] {
  const due: DueExpiryAlert[] = [];
  for (const layer of layers) {
    if (!layer.expiryDate || layer.remainingQty.scaled <= 0n) continue;
    const daysToExpiry = expiryDaysBetween(today, layer.expiryDate);
    if (daysToExpiry < 0) due.push({ layer, kind: ExpiryAlertKind.Expired, daysToExpiry });
    else if (daysToExpiry <= nearExpiryDays) due.push({ layer, kind: ExpiryAlertKind.NearExpiry, daysToExpiry });
  }
  return due.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}
