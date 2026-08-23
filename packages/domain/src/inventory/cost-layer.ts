/**
 * CostLayer — an immutable cost record created by every stock receipt
 * (docs/catalog/03 §"طبقات التكلفة"). A layer retains its receipt-time unit
 * cost FOR ITS ENTIRE LIFETIME ("الطبقات تحتفظ بسعرها الأصلي وقت الاستلام —
 * هذا تصميم مقصود"): the unit cost is never rewritten when a later receipt
 * moves the weighted average. Only `remainingQty` changes — issues consume it
 * FEFO where an expiry is known and FIFO otherwise (see
 * `compareLayersForConsumption`); a new immutable snapshot is stored and the
 * original cost is preserved.
 *
 * This intentional divergence between the immutable layer prices and the live
 * weighted-average is exactly what the drift report surfaces (see wac.ts).
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "./wac-math.js";
import type { StockSourceDocType } from "./movement.js";

export interface CostLayer {
  readonly id: string;
  readonly itemId: string;
  readonly warehouseId: string;
  /** Receipt-time unit cost — IMMUTABLE for the life of the layer. */
  readonly unitCost: Money;
  readonly originalQty: Qty;
  /** Uncosumed quantity still sitting in this layer (drawn down on issue). */
  readonly remainingQty: Qty;
  readonly sourceDocType: StockSourceDocType;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly createdAt: string; // ISO-8601 UTC
  /** Supplier/production lot this receipt arrived under. Absent for non-tracked goods. */
  readonly batchNo?: string | null;
  /** ISO-8601 date (YYYY-MM-DD) this layer's goods expire. Absent for non-perishables. */
  readonly expiryDate?: string | null;
}

/** Total remaining value of a layer at its own immutable unit cost. */
export function layerRemainingValue(layer: CostLayer): Money {
  return extend(layer.remainingQty, layer.unitCost);
}

/**
 * CONSUMPTION ORDER — the ONLY place it is decided, shared by the live engine
 * (stock-ledger-service.ts) and the ledger replay (wac.ts). The two must agree
 * exactly or a rebuild would silently reshuffle the surviving layers.
 *
 * FEFO: a layer that expires is consumed before one that never does, earliest
 * expiry first. Layers WITHOUT an expiry compare equal here, so a stable sort
 * leaves them in receipt (FIFO) order — a position where nothing expires keeps
 * the pre-FEFO order untouched, which is what the no-regression guarantee rests on.
 */
export function compareLayersForConsumption(a: CostLayer, b: CostLayer): number {
  const left = a.expiryDate ?? null;
  const right = b.expiryDate ?? null;
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

/** Layers in the order an issue draws them down. Input order is the FIFO tie-break. */
export function orderLayersForConsumption(layers: readonly CostLayer[]): CostLayer[] {
  return [...layers].sort(compareLayersForConsumption);
}

/**
 * Returns a NEW layer with `remainingQty` reduced by `consumed`. The unit cost
 * is carried over unchanged — the immutability guarantee. Never mutates input.
 */
export function drawDownLayer(layer: CostLayer, consumed: Qty): CostLayer {
  return { ...layer, remainingQty: layer.remainingQty.subtract(consumed) };
}
