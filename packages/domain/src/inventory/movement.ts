/**
 * StockMovement — one immutable line of the stock ledger (docs/catalog/03
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
}

/** Signed on-hand contribution of a movement (+qty for IN, −qty for OUT). */
export function signedQty(movement: StockMovement): Qty {
  return movement.direction === "IN" ? movement.qty : movement.qty.negate();
}

/** Signed value contribution of a movement (+value for IN, −value for OUT). */
export function signedValue(movement: StockMovement): Money {
  const value = extend(movement.qty, movement.unitCost);
  return movement.direction === "IN" ? value : value.negate();
}
