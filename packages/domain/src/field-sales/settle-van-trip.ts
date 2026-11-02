import type { ReasonInput } from "../bilingual-reasons.js";
import { Money, Qty } from "../money/index.js";
import {
  VanTripStatus,
  type VanTrip,
  type VanTripRepository,
  type VanTripSettlement,
  type VanTripStockCountLine,
} from "./van-trip.js";
import { InvalidVanTripCountError, VanTripNotFoundError, VanTripNotOngoingError, VanTripRecountLockedError } from "./errors.js";
import { buildVanTripExpectation, varianceValueOf, type VanTripActivityPort } from "./van-trip-expectation.js";

export interface SettleVanTripCommand {
  readonly tripId: string;
  readonly countedCash: Money;
  readonly stockCounts: readonly { itemId: string; countedQty: Qty }[];
  readonly actor: string;
  readonly now?: () => string;
  /** The tenant's calendar day; without it the day is `now`'s UTC day, the day before in Cairo until 02:00/03:00. */
  readonly date?: string;
}

export interface SettleVanTripDeps {
  readonly trips: VanTripRepository;
  readonly activity: VanTripActivityPort;
}

function validateCount(cmd: SettleVanTripCommand): void {
  const reasons: ReasonInput[] = [];
  if (cmd.countedCash.scaled < 0n) reasons.push({ ar: "النقدية المعدودة لا تكون سالبة", en: "The counted cash cannot be negative" });
  const seen = new Set<string>();
  for (const line of cmd.stockCounts) {
    if (line.countedQty.isNegative()) reasons.push({
        ar: `الكمية المعدودة للصنف "${line.itemId}" لا تكون سالبة`,
        en: `The counted quantity of item "${line.itemId}" cannot be negative`,
      });
    if (seen.has(line.itemId)) reasons.push({ ar: `الصنف "${line.itemId}" معدود أكثر من مرة`, en: `Item "${line.itemId}" is counted more than once` });
    seen.add(line.itemId);
  }
  if (reasons.length > 0) throw new InvalidVanTripCountError(reasons);
}

/**
 * تسوية الرحلة — records the count against what the books expect. It posts
 * nothing: the stock return, the shortage or overage adjustment and the cash
 * handover all post on approval, by someone other than the person who
 * counted. Until then the count can be entered again.
 */
export async function settleVanTrip(cmd: SettleVanTripCommand, deps: SettleVanTripDeps): Promise<VanTrip> {
  const trip = await deps.trips.findById(cmd.tripId);
  if (!trip) throw new VanTripNotFoundError(cmd.tripId);
  if (trip.status !== VanTripStatus.Ongoing && trip.status !== VanTripStatus.AwaitingApproval) {
    throw new VanTripNotOngoingError(trip.id, trip.status);
  }
  if ((trip.settlement?.reconciliation?.steps.length ?? 0) > 0) throw new VanTripRecountLockedError(trip.id);
  validateCount(cmd);

  const settledAt = cmd.now?.() ?? new Date().toISOString();
  const day = cmd.date ?? settledAt.slice(0, 10);
  const countedByItem = new Map(cmd.stockCounts.map((c) => [c.itemId, c.countedQty]));
  const activity = await deps.activity.read(trip, day, [...countedByItem.keys()]);
  const expectation = buildVanTripExpectation(trip, activity);

  const stockCounts: VanTripStockCountLine[] = expectation.lines.map((line) => {
    const countedQty = countedByItem.get(line.itemId) ?? Qty.zero();
    const varianceQty = countedQty.subtract(line.expectedQty);
    return { ...line, countedQty, varianceQty, varianceValue: varianceValueOf(varianceQty, line.unitCost) };
  });
  const expectedItems = new Set(expectation.lines.map((l) => l.itemId));
  for (const [itemId, countedQty] of countedByItem) {
    if (expectedItems.has(itemId) || countedQty.isZero()) continue;
    const unitCost = activity.stock.find((s) => s.itemId === itemId)?.unitCost ?? Money.zero();
    stockCounts.push({
      itemId,
      expectedQty: Qty.zero(),
      countedQty,
      varianceQty: countedQty,
      loadedQty: Qty.zero(),
      soldQty: Qty.zero(),
      returnedQty: Qty.zero(),
      otherQty: Qty.zero(),
      unitCost,
      varianceValue: varianceValueOf(countedQty, unitCost),
    });
  }

  const settlement: VanTripSettlement = {
    expectedCash: expectation.expectedCash,
    countedCash: cmd.countedCash,
    cashVariance: Money.fromScaled(cmd.countedCash.scaled - expectation.expectedCash.scaled),
    stockCounts,
    settledAt,
    settledBy: cmd.actor,
    settlementDate: day,
    cashBreakdown: expectation.cashBreakdown,
    invoicedSales: expectation.invoicedSales,
    returnsValue: expectation.returnsValue,
    reconciliation: null,
  };

  const settled: VanTrip = { ...trip, status: VanTripStatus.AwaitingApproval, settledAt, settlement };
  await deps.trips.update(settled);
  return settled;
}
