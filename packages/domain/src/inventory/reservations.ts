import { Qty } from "../money/index.js";

/**
 * مخزون محجوز — stock a document has committed but not yet moved (R5.6).
 *
 * DERIVED, never stored. A reserved counter is the same shape as the bugs this
 * codebase keeps finding: something increments it, something else forgets to
 * decrement it, and nothing ever notices. Recomputing from the open documents
 * themselves cannot drift, because confirming or deleting the document removes
 * the reservation by construction.
 *
 * What reserves: a draft sales invoice's stock lines (the goods are spoken for,
 * and confirming will relieve them) and a draft stock transfer's lines (spoken
 * for at the SOURCE warehouse only — the destination gains nothing until the
 * transfer confirms). A confirmed document has already moved its stock and
 * reserves nothing.
 */
export interface ReservationLine {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly qty: Qty;
}

export interface StockReservations {
  /** Reserved quantity for one item in one warehouse; zero when nothing holds it. */
  forPosition(itemId: string, warehouseId: string): Qty;
  /** Reserved across every warehouse for one item. */
  forItem(itemId: string): Qty;
}

function key(itemId: string, warehouseId: string): string {
  return `${itemId} ${warehouseId}`;
}

export function buildStockReservations(lines: Iterable<ReservationLine>): StockReservations {
  const byPosition = new Map<string, Qty>();
  const byItem = new Map<string, Qty>();
  for (const line of lines) {
    if (line.qty.scaled <= 0n) continue;
    const positionKey = key(line.itemId, line.warehouseId);
    byPosition.set(positionKey, (byPosition.get(positionKey) ?? Qty.zero()).add(line.qty));
    byItem.set(line.itemId, (byItem.get(line.itemId) ?? Qty.zero()).add(line.qty));
  }
  return {
    forPosition: (itemId, warehouseId) => byPosition.get(key(itemId, warehouseId)) ?? Qty.zero(),
    forItem: (itemId) => byItem.get(itemId) ?? Qty.zero(),
  };
}

/**
 * On-hand minus reserved, floored at zero. A reservation can exceed stock — two
 * drafts can both claim the last unit — and reporting a negative availability
 * would read as a stock error rather than as over-commitment.
 */
export function availableQty(onHand: Qty, reserved: Qty): Qty {
  const remaining = onHand.scaled - reserved.scaled;
  return remaining > 0n ? Qty.fromScaled(remaining) : Qty.zero();
}

/** The port the API layer implements over whatever open documents it holds. */
export interface StockReservationSource {
  list(): Promise<readonly ReservationLine[]>;
}
