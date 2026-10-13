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
 * Costing rules (docs/archive/plan.md §2.3 / docs/archive/catalog/03):
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

import { Money, Qty, allocate } from "../money/index.js";
import { CostLayer, drawDownLayer, layerRemainingValue, orderLayersForConsumption } from "./cost-layer.js";
import { StockMovement, isRevaluation, movementValue, signedQty } from "./movement.js";
import { StockChangeKind, changeStockPosition } from "./position-change.js";
import { unitCostOf } from "./wac-math.js";

export interface WacPosition {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly onHand: Qty;
  readonly totalValue: Money;
  /** Live weighted-average unit cost = totalValue / onHand (0 when empty). */
  readonly averageCost: Money;
  /** Immutable layers with their current remainders, in FIFO (receipt) order. */
  readonly layers: readonly CostLayer[];
  /**
   * Landed cost this ledger could NOT capitalise, because the goods it
   * attaches to had already been issued by the time it was booked (D84, D135).
   * It is a period cost: the caller must post it to cost of sales (or a
   * purchase-price-variance account) instead of to inventory. Nonzero here and
   * the GL inventory control account will exceed the stock valuation by exactly
   * this amount until that posting is made.
   */
  readonly unabsorbedRevaluation: Money;
}

export function emptyPosition(itemId: string, warehouseId: string): WacPosition {
  return {
    itemId,
    warehouseId,
    onHand: Qty.zero(),
    totalValue: Money.zero(),
    averageCost: Money.zero(),
    layers: [],
    unabsorbedRevaluation: Money.zero(),
  };
}

/**
 * Draw `qty` down across layers in `compareLayersForConsumption` order,
 * returning the surviving/updated layers still in RECEIPT order — the order
 * `WacPosition.layers` and the layer store both promise.
 */
function consumeLayers(layers: readonly CostLayer[], qty: Qty, takenBackFrom: string | null = null): CostLayer[] {
  let remaining = qty;
  const drawn = new Map<string, CostLayer | null>();
  for (const layer of takeBackOrder(orderLayersForConsumption(layers), takenBackFrom)) {
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

export function recordedAbsorption(movement: StockMovement): Money | null {
  if (!movement.value) return null;
  return movement.direction === "IN" ? movement.value : movement.value.negate();
}

export function takeBackOrder<T extends { readonly sourceDocId: string }>(ordered: readonly T[], takenBackFrom: string | null | undefined): readonly T[] {
  if (!takenBackFrom) return ordered;
  return [...ordered.filter((layer) => layer.sourceDocId === takenBackFrom), ...ordered.filter((layer) => layer.sourceDocId !== takenBackFrom)];
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
  let unabsorbedRevaluation = Money.zero();
  // Original vs still-on-hand quantity per RECEIPT document, kept beside the
  // layers because a fully-consumed layer is dropped from `layers` — and a
  // receipt that is gone must be distinguishable from a receipt this ledger
  // never recorded. The two need opposite treatment when a landed cost names
  // one (see the revaluation branch).
  const receipts = new Map<string, { original: bigint; remaining: bigint }>();
  const recountRemaining = (): void => {
    for (const r of receipts.values()) r.remaining = 0n;
    for (const l of layers) {
      const r = receipts.get(l.sourceDocId);
      if (r) r.remaining += l.remainingQty.scaled;
    }
  };

  const standing: { receipt: string; amount: bigint; direction: StockMovement["direction"]; absorbed: Money }[] = [];

  for (const m of movements) {
    if (isRevaluation(m)) {
      const delta = m.valueDelta as Money;
      const receipt = m.revaluesSourceDocId ?? m.sourceDocId;
      const undone = standing.findIndex((entry) => entry.receipt === receipt && entry.amount === delta.scaled && entry.direction !== m.direction);
      const change = changeStockPosition(
        { onHand, totalValue },
        {
          kind: StockChangeKind.Revaluation,
          delta: m.direction === "IN" ? delta : delta.negate(),
          receipt: (m.revaluesSourceDocId ? receipts.get(m.revaluesSourceDocId) : undefined) ?? null,
          undoes: undone === -1 ? undefined : (standing[undone] as (typeof standing)[number]).absorbed,
          recorded: recordedAbsorption(m),
        },
      );
      if (undone === -1) standing.push({ receipt, amount: delta.scaled, direction: m.direction, absorbed: change.valueChange });
      else standing.splice(undone, 1);
      const absorbed = change.valueChange;
      totalValue = change.totalValue;
      unabsorbedRevaluation = unabsorbedRevaluation.add(change.difference);
      const targets = layers.filter((l) => l.sourceDocId === m.revaluesSourceDocId);
      const weights = targets.map((l) => l.remainingQty.scaled);
      if (absorbed.scaled !== 0n && weights.some((wgt) => wgt > 0n)) {
        const shares = allocate(absorbed, weights);
        const bumped = new Map(
          targets.map((l, i) => {
            const share = shares[i] as Money;
            if (l.remainingQty.isZero() || share.scaled === 0n) return [l.id, l] as const;
            return [l.id, { ...l, unitCost: l.unitCost.add(unitCostOf(share, l.remainingQty)) }] as const;
          }),
        );
        layers = layers.map((l) => bumped.get(l.id) ?? l);
      }
      continue;
    }
    if (m.direction === "IN") {
      const recorded = movementValue(m);
      const change = changeStockPosition({ onHand, totalValue }, { kind: StockChangeKind.Addition, qty: m.qty, unitCost: m.unitCost, stated: recorded, recorded });
      const layered = change.layeredQty;
      totalValue = change.totalValue;
      onHand = change.onHand;
      if (!layered.isZero()) layers.push({
        id: m.id,
        itemId: m.itemId,
        warehouseId: m.warehouseId,
        unitCost: m.unitCost,
        originalQty: layered,
        remainingQty: layered,
        sourceDocType: m.sourceDocType,
        sourceDocId: m.sourceDocId,
        sourceDocNumber: m.sourceDocNumber,
        createdAt: m.occurredAt,
        batchNo: m.batchNo ?? null,
        expiryDate: m.expiryDate ?? null,
      });
      const seen = receipts.get(m.sourceDocId) ?? { original: 0n, remaining: 0n };
      seen.original += m.qty.scaled;
      seen.remaining += layered.scaled;
      receipts.set(m.sourceDocId, seen);
    } else {
      // INVARIANT: an issue replays at the unit cost the ledger recorded for
      // it, never at an average recomputed here — a document entered out of
      // date order would otherwise make the replay disagree with the engine
      // that wrote it, and `cacheDrift` would report entry order as corruption.
      const issuedAt = m.unitCost.scaled === 0n ? unitCostOf(totalValue, onHand) : m.unitCost;
      const change = changeStockPosition({ onHand, totalValue }, { kind: StockChangeKind.Removal, qty: m.qty, unitCost: issuedAt, recorded: m.value });
      totalValue = change.totalValue;
      onHand = change.onHand;
      layers = consumeLayers(layers, m.qty, m.revaluesSourceDocId ?? null);
      recountRemaining();
    }
  }

  return {
    itemId,
    warehouseId,
    onHand,
    totalValue,
    averageCost: unitCostOf(totalValue, onHand),
    layers,
    unabsorbedRevaluation,
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
  /**
   * Landed cost the ledger could not capitalise because the goods had already
   * been issued (D84, D135). This is the amount the GL inventory control
   * account holds that the stock valuation does not, until it is posted to
   * cost of sales. Not part of `cacheDrift`: the cache is not wrong, the
   * posting is missing.
   */
  readonly unabsorbedRevaluation: Money;
}

/**
 * Reconcile a cached snapshot against the ledger and the layers. `tolerance`
 * (a Money magnitude, default exact-zero) bounds the acceptable cache drift —
 * mirrors the tenant's `wacDriftTolerance` knob (docs/archive/plan.md §2.3).
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
    unabsorbedRevaluation: recomputed.unabsorbedRevaluation,
  };
}
