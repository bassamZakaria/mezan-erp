/**
 * CostLayer — an immutable cost record created by every stock receipt
 * (docs/catalog/03 §"طبقات التكلفة"). A layer retains its receipt-time unit
 * cost FOR ITS ENTIRE LIFETIME ("الطبقات تحتفظ بسعرها الأصلي وقت الاستلام —
 * هذا تصميم مقصود"): the unit cost is never rewritten when a later receipt
 * moves the weighted average. Only `remainingQty` changes — issues consume it
 * FIFO (a new immutable snapshot is stored; the original cost is preserved).
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
  /** Uncosumed quantity still sitting in this layer (drawn down FIFO on issue). */
  readonly remainingQty: Qty;
  readonly sourceDocType: StockSourceDocType;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly createdAt: string; // ISO-8601 UTC
}

/** Total remaining value of a layer at its own immutable unit cost. */
export function layerRemainingValue(layer: CostLayer): Money {
  return extend(layer.remainingQty, layer.unitCost);
}

/**
 * Returns a NEW layer with `remainingQty` reduced by `consumed`. The unit cost
 * is carried over unchanged — the immutability guarantee. Never mutates input.
 */
export function drawDownLayer(layer: CostLayer, consumed: Qty): CostLayer {
  return { ...layer, remainingQty: layer.remainingQty.subtract(consumed) };
}
