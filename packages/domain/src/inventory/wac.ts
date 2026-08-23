/**
 * Weighted-average costing (WAC) engine — pure, integer-only, deterministic.
 *
 * The stock ledger (the ordered list of {@link StockMovement}s) is the single
 * source of truth. This module derives, by exact replay:
 *
 *   - the on-hand quantity and total inventory value of a position,
 *   - the live weighted-average unit cost,
 *   - the set of immutable {@link CostLayer}s and their drawn-down remainders,
 *   - a drift report reconciling the CACHED average against the RECOMPUTED
 *     average against the LAYER-derived average — the three figures the catalog
 *     shows on the item cost tab and the valuation report.
 *
 * Costing rules (docs/plan.md §2.3 / docs/catalog/03):
 *   - Receipt (IN): value += qty × unitCost; a new immutable layer is created
 *     at that receipt-time unit cost.
 *   - Issue (OUT): stock leaves at the CURRENT moving average; the average is
 *     unchanged by an issue. Layers are drawn down FEFO-then-FIFO
 *     (cost-layer.ts) for the remaining-qty display — an ordering that does NOT
 *     touch valuation, since the OUT unit cost is the moving average either
 *     way. Each layer keeps its own original price, so layer value and WAC
 *     value legitimately diverge over time (the documented "drift").
 *
 * No floats anywhere: a given movement sequence yields byte-identical scaled
 * integers on every engine, which the golden fixtures lock down.
 */

import { Money, Qty } from "../money/index.js";
import { CostLayer, drawDownLayer, layerRemainingValue, orderLayersForConsumption } from "./cost-layer.js";
import { StockMovement, signedQty } from "./movement.js";
import { extend, unitCostOf } from "./wac-math.js";

export interface WacPosition {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly onHand: Qty;
  readonly totalValue: Money;
  /** Live weighted-average unit cost = totalValue / onHand (0 when empty). */
  readonly averageCost: Money;
  /** Immutable layers with their current remainders, in FIFO (receipt) order. */
  readonly layers: readonly CostLayer[];
}

export function emptyPosition(itemId: string, warehouseId: string): WacPosition {
  return {
    itemId,
    warehouseId,
    onHand: Qty.zero(),
    totalValue: Money.zero(),
    averageCost: Money.zero(),
    layers: [],
  };
}

/**
 * Draw `qty` down across layers in `compareLayersForConsumption` order,
 * returning the surviving/updated layers still in RECEIPT order — the order
 * `WacPosition.layers` and the layer store both promise.
 */
function consumeLayers(layers: readonly CostLayer[], qty: Qty): CostLayer[] {
  let remaining = qty;
  const drawn = new Map<string, CostLayer | null>();
  for (const layer of orderLayersForConsumption(layers)) {
    if (remaining.isZero() || remaining.isNegative()) break;
    if (layer.remainingQty.compare(remaining) <= 0) {
      // Whole layer consumed.
      remaining = remaining.subtract(layer.remainingQty);
      drawn.set(layer.id, null);
    } else {
      drawn.set(layer.id, drawDownLayer(layer, remaining));
      remaining = Qty.zero();
    }
  }
  // If `remaining` is still positive here, the issue exceeded costed layers
  // (only reachable when negative stock is permitted). The deficit is simply
  // not represented as a layer; the drift report will surface the mismatch.
  const out: CostLayer[] = [];
  for (const layer of layers) {
    if (!drawn.has(layer.id)) {
      out.push(layer);
      continue;
    }
    const replacement = drawn.get(layer.id);
    if (replacement) out.push(replacement);
  }
  return out;
}

/**
 * Replay an ordered movement list into the authoritative position. Movements
 * MUST already be in ledger order (occurredAt, then insertion). This is the
 * function `rebuild` and the drift check both trust as ground truth.
 */
export function replay(
  itemId: string,
  warehouseId: string,
  movements: readonly StockMovement[],
): WacPosition {
  let onHand = Qty.zero();
  let totalValue = Money.zero();
  let layers: CostLayer[] = [];

  for (const m of movements) {
    if (m.direction === "IN") {
      totalValue = totalValue.add(extend(m.qty, m.unitCost));
      onHand = onHand.add(m.qty);
      layers.push({
        id: m.id,
        itemId: m.itemId,
        warehouseId: m.warehouseId,
        unitCost: m.unitCost,
        originalQty: m.qty,
        remainingQty: m.qty,
        sourceDocType: m.sourceDocType,
        sourceDocId: m.sourceDocId,
        sourceDocNumber: m.sourceDocNumber,
        createdAt: m.occurredAt,
        batchNo: m.batchNo ?? null,
        expiryDate: m.expiryDate ?? null,
      });
    } else {
      const movingAvg = unitCostOf(totalValue, onHand);
      const cogs = extend(m.qty, movingAvg);
      totalValue = totalValue.add(cogs.negate());
      onHand = onHand.subtract(m.qty);
      layers = consumeLayers(layers, m.qty);
    }
  }

  return {
    itemId,
    warehouseId,
    onHand,
    totalValue,
    averageCost: unitCostOf(totalValue, onHand),
    layers,
  };
}

/** On-hand running balance for a position, from its ledger. */
export function runningBalance(movements: readonly StockMovement[]): Qty {
  return Qty.sum(movements.map(signedQty));
}

export interface DriftReport {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly onHand: Qty;
  /** Average per the cached snapshot (what the app served without a rebuild). */
  readonly cachedAverageCost: Money;
  /** Average recomputed by replaying the ledger (ground truth). */
  readonly recomputedAverageCost: Money;
  /** Average implied by the immutable layers' remaining value ÷ remaining qty. */
  readonly layersAverageCost: Money;
  readonly cachedValue: Money;
  readonly recomputedValue: Money;
  readonly layersValue: Money;
  readonly layersQty: Qty;
  /** recomputed − cached: nonzero means the cache is CORRUPTED and needs a rebuild. */
  readonly cacheDrift: Money;
  /** recomputed − layers: the EXPECTED, by-design divergence the catalog explains. */
  readonly layerDrift: Money;
  /** True when |cacheDrift| is within `tolerance` (cache is trustworthy). */
  readonly withinTolerance: boolean;
}

/**
 * Reconcile a cached snapshot against the ledger and the layers. `tolerance`
 * (a Money magnitude, default exact-zero) bounds the acceptable cache drift —
 * mirrors the tenant's `wacDriftTolerance` knob (docs/plan.md §2.3).
 */
export function checkDrift(
  cached: WacPosition,
  movements: readonly StockMovement[],
  tolerance: Money = Money.zero(),
): DriftReport {
  const recomputed = replay(cached.itemId, cached.warehouseId, movements);
  const layersValue = Money.sum(recomputed.layers.map(layerRemainingValue));
  const layersQty = Qty.sum(recomputed.layers.map((l) => l.remainingQty));
  const cacheDrift = recomputed.totalValue.add(cached.totalValue.negate());
  const layerDrift = recomputed.totalValue.add(layersValue.negate());
  const driftMagnitude =
    cacheDrift.scaled < 0n ? cacheDrift.negate().scaled : cacheDrift.scaled;

  return {
    itemId: cached.itemId,
    warehouseId: cached.warehouseId,
    onHand: recomputed.onHand,
    cachedAverageCost: cached.averageCost,
    recomputedAverageCost: recomputed.averageCost,
    layersAverageCost: unitCostOf(layersValue, layersQty),
    cachedValue: cached.totalValue,
    recomputedValue: recomputed.totalValue,
    layersValue,
    layersQty,
    cacheDrift,
    layerDrift,
    withinTolerance: driftMagnitude <= tolerance.scaled,
  };
}
