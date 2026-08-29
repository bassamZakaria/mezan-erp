/**
 * StockMovement — one immutable line of the stock ledger (docs/archive/catalog/03
 * §"عرض سجل الحركات" / the movement log). Every quantity change in the system
 * is one of these: a receipt, an issue, or one leg of a transfer. Movements are
 * the source of truth from which balances and weighted-average valuation are
 * (re)derived — see wac.ts.
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "./wac-math.js";
import type { AdjustmentReason } from "./reasons.js";

export type StockMovementDirection = "IN" | "OUT";

/** The document types that can originate a movement (source-doc reference). */
export const STOCK_SOURCE_DOC_TYPES = [
  "ADJUSTMENT",
  "TRANSFER",
  "PURCHASE_INVOICE",
  "PURCHASE_RECEIPT",
  "PURCHASE_CANCELLATION",
  "SALES_INVOICE",
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "POS_SALE",
  "WORK_ORDER",
  "LANDED_COST",
] as const;
export type StockSourceDocType = (typeof STOCK_SOURCE_DOC_TYPES)[number];

export interface StockMovement {
  readonly id: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly direction: StockMovementDirection;
  /** Always a positive magnitude; `direction` carries the sign. */
  readonly qty: Qty;
  /**
   * Unit cost attached to this movement: the receipt-time cost for an IN, or
   * the weighted-average cost at which stock was issued for an OUT. Retained on
   * the movement so the ledger is self-describing when replayed.
   */
  readonly unitCost: Money;
  readonly sourceDocType: StockSourceDocType;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  /** Set only for movements originating from a stock adjustment. */
  readonly reason: AdjustmentReason | null;
  readonly occurredAt: string; // ISO-8601 UTC
  /**
   * Batch/expiry the goods entered under, carried on the IN movement so a
   * replay (wac.ts) rebuilds layers that consume in the SAME order the live
   * engine used. Absent on an OUT and on any non-tracked receipt.
   */
  readonly batchNo?: string | null;
  readonly expiryDate?: string | null;
  /**
   * A REVALUATION: value added to the position with no quantity moving, which
   * is what a landed cost is. Before this the landed cost mutated the cached
   * snapshot and the cost layers directly and appended nothing, so `replay()`
   * could never reproduce a position it had touched and the drift report read
   * `cacheDrift` nonzero on a healthy tenant (D36).
   *
   * `qty` and `unitCost` are zero on such a movement; `valueDelta` carries the
   * whole of it, and `revaluesSourceDocId` names the receipt whose layers
   * absorb the cost.
   */
  readonly valueDelta?: Money | null;
  readonly revaluesSourceDocId?: string | null;
}

/** True for a value-only movement — a landed cost, not a quantity movement. */
export function isRevaluation(movement: StockMovement): boolean {
  return (movement.valueDelta?.scaled ?? 0n) !== 0n;
}

/** Signed on-hand contribution of a movement (+qty for IN, −qty for OUT). */
/**
 * The ledger timestamp for a movement a DOCUMENT caused.
 *
 * Confirms used to stamp `occurredAt` with the wall clock while
 * document-dated movements (transfers, adjustments, physical counts) carried a
 * plain calendar date. A bare "2026-08-20" sorts BEFORE any timestamp on the
 * same day, so the drift report's replay consumed stock before the receipt
 * that funded it and reported a gap that was not real (D4). Every movement now
 * carries the same shape, derived from the document's own date, and same-day
 * movements fall back to insertion order — the ledger's documented tie-break.
 */
export function occurredAtFromDocumentDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : date;
}

export function signedQty(movement: StockMovement): Qty {
  if (isRevaluation(movement)) return Qty.zero();
  return movement.direction === "IN" ? movement.qty : movement.qty.negate();
}

/** Signed value contribution of a movement (+value for IN, −value for OUT). */
export function signedValue(movement: StockMovement): Money {
  if (isRevaluation(movement)) {
    const delta = movement.valueDelta as Money;
    return movement.direction === "IN" ? delta : delta.negate();
  }
  const value = extend(movement.qty, movement.unitCost);
  return movement.direction === "IN" ? value : value.negate();
}
