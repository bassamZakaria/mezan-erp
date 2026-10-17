import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/wac-math.js";
import { VanTripCashMovementKind as MovementKind, type VanTrip, type VanTripCashBreakdown } from "./van-trip.js";

export interface VanTripStockActivity {
  readonly itemId: string;
  readonly onHand: Qty;
  /** The van's moving-average cost, or the item's cost price when the van holds none of it. */
  readonly unitCost: Money;
  readonly loadedQty: Qty;
  readonly soldQty: Qty;
  readonly returnedQty: Qty;
}

/** What the ledgers hold for a trip's van, read by the composition root. */
export interface VanTripActivity {
  readonly stock: readonly VanTripStockActivity[];
  readonly tillBalance: Money;
  readonly voucherCollections: Money;
  readonly invoicedSales: Money;
  readonly returnsValue: Money;
}

export interface VanTripActivityPort {
  read(trip: VanTrip, day: string, extraItemIds: readonly string[]): Promise<VanTripActivity>;
}

export interface VanTripExpectedLine {
  readonly itemId: string;
  readonly expectedQty: Qty;
  readonly loadedQty: Qty;
  readonly soldQty: Qty;
  readonly returnedQty: Qty;
  readonly otherQty: Qty;
  readonly unitCost: Money;
}

export interface VanTripExpectation {
  readonly expectedCash: Money;
  readonly cashBreakdown: VanTripCashBreakdown;
  readonly lines: readonly VanTripExpectedLine[];
  readonly invoicedSales: Money;
  readonly returnsValue: Money;
}

function movementTotal(trip: VanTrip, kind: MovementKind): Money {
  return Money.sum(trip.cashMovements.filter((m) => m.kind === kind).map((m) => m.amount));
}

/**
 * Expected stock is the van warehouse's ON-HAND and expected cash is the van
 * till's own BOOK balance, not the trip's loaded-minus-sold arithmetic: an
 * approval transfers the counted stock and cash out and writes the difference
 * off, so only the ledger figure leaves both at zero. The trip's own documents
 * (loaded, sold, returned, float, takings, collections) are the breakdown, and
 * whatever they do not explain is shown as «other» rather than hidden.
 */
export function buildVanTripExpectation(trip: VanTrip, activity: VanTripActivity): VanTripExpectation {
  const byItem = new Map(activity.stock.map((s) => [s.itemId, s]));
  const itemIds = [...new Set([...trip.loadedStock.map((l) => l.itemId), ...activity.stock.map((s) => s.itemId)])];

  const lines: VanTripExpectedLine[] = [];
  for (const itemId of itemIds) {
    const s = byItem.get(itemId);
    const loadedQty = s?.loadedQty ?? Qty.zero();
    const soldQty = s?.soldQty ?? Qty.zero();
    const returnedQty = s?.returnedQty ?? Qty.zero();
    const expectedQty = s?.onHand ?? Qty.zero();
    const explained = loadedQty.subtract(soldQty).add(returnedQty);
    const line: VanTripExpectedLine = {
      itemId,
      expectedQty,
      loadedQty,
      soldQty,
      returnedQty,
      otherQty: expectedQty.subtract(explained),
      unitCost: s?.unitCost ?? Money.zero(),
    };
    const silent = [line.expectedQty, line.loadedQty, line.soldQty, line.returnedQty].every((q) => q.isZero());
    if (!silent) lines.push(line);
  }

  const fieldSales = movementTotal(trip, MovementKind.Sale);
  const fieldCollections = movementTotal(trip, MovementKind.Collection);
  const explainedCash = Money.sum([trip.openingCashFloat, fieldSales, fieldCollections, activity.voucherCollections]);

  return {
    expectedCash: activity.tillBalance,
    cashBreakdown: {
      openingFloat: trip.openingCashFloat,
      fieldSales,
      fieldCollections,
      voucherCollections: activity.voucherCollections,
      other: Money.fromScaled(activity.tillBalance.scaled - explainedCash.scaled),
    },
    lines,
    invoicedSales: activity.invoicedSales,
    returnsValue: activity.returnsValue,
  };
}

export function varianceValueOf(varianceQty: Qty, unitCost: Money): Money {
  return extend(varianceQty, unitCost);
}
