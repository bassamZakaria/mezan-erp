import { Money, Qty } from "../money/index.js";
import type { VanTrip, VanTripRepository, VanTripSettlement, VanTripStockCountLine } from "./van-trip.js";
import { VanTripNotFoundError, VanTripNotOngoingError } from "./errors.js";
import type { TreasuryTransferInput } from "./open-van-trip.js";

export interface SettleVanTripCommand {
  readonly tripId: string;
  readonly countedCash: Money;
  readonly stockCounts: readonly { itemId: string; countedQty: Qty }[];
  readonly now?: () => string;
}

export interface SettleVanTripDeps {
  readonly trips: VanTripRepository;
  /** Same reuse point as openVanTrip — settlement returns any counted cash still on the van back to the source treasury. */
  readonly treasuryTransfer?: (input: TreasuryTransferInput) => Promise<void>;
  /**
   * Writes the counted-versus-expected difference off the van's treasury to
   * عجز/فائض الصندوق. Without it the shortfall stays on the van's books as cash
   * nobody holds: the transfer only moves what was counted, so the difference
   * sits there for the next trip to inherit.
   */
  readonly recordCashVariance?: (input: {
    tripId: string;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
    variance: Money;
  }) => Promise<void>;
}

export async function settleVanTrip(cmd: SettleVanTripCommand, deps: SettleVanTripDeps): Promise<VanTrip> {
  const trip = await deps.trips.findById(cmd.tripId);
  if (!trip) throw new VanTripNotFoundError(cmd.tripId);
  if (trip.status !== "ongoing") throw new VanTripNotOngoingError(trip.id, trip.status);

  const accrued = Money.sum(trip.cashMovements.map((m) => m.amount));
  const expectedCash = Money.fromScaled(trip.openingCashFloat.scaled + accrued.scaled);
  const cashVariance = Money.fromScaled(cmd.countedCash.scaled - expectedCash.scaled);

  const countedByItem = new Map(cmd.stockCounts.map((c) => [c.itemId, c.countedQty]));
  const stockCounts: VanTripStockCountLine[] = [];

  for (const line of cmd.stockCounts) {
    // MVP simplification: expectedQty uses the trip's original loadedStock line as-is —
    // there's no "van sale stock consumption" line item yet, so expected does not net out
    // implicit sales. Callers must account for this when interpreting varianceQty.
    const expectedQty = trip.loadedStock.find((l) => l.itemId === line.itemId)?.qty ?? Qty.zero();
    stockCounts.push({
      itemId: line.itemId,
      expectedQty,
      countedQty: line.countedQty,
      varianceQty: Qty.fromScaled(line.countedQty.scaled - expectedQty.scaled),
    });
  }

  for (const loaded of trip.loadedStock) {
    if (countedByItem.has(loaded.itemId)) continue;
    stockCounts.push({
      itemId: loaded.itemId,
      expectedQty: loaded.qty,
      countedQty: Qty.zero(),
      varianceQty: Qty.fromScaled(Qty.zero().scaled - loaded.qty.scaled),
    });
  }

  // Before the transfer, so the van never has to hold cash it has already
  // handed back while the write-off is still pending.
  if (deps.recordCashVariance && cashVariance.scaled !== 0n) {
    await deps.recordCashVariance({
      tripId: trip.id,
      date: (cmd.now?.() ?? new Date().toISOString()).slice(0, 10),
      branchId: trip.branchId,
      vanTreasuryAccountId: trip.vanTreasuryAccountId,
      variance: cashVariance,
    });
  }

  if (deps.treasuryTransfer && cmd.countedCash.scaled > 0n) {
    await deps.treasuryTransfer({
      id: cmd.tripId,
      // A voucher's `date` is a calendar day, not an instant — a full ISO
      // timestamp here prints as one in the vouchers list and falls outside an
      // inclusive `toDate` of the very day it was settled.
      date: (cmd.now?.() ?? new Date().toISOString()).slice(0, 10),
      amount: cmd.countedCash,
      branchId: trip.branchId,
      fromTreasuryAccountId: trip.vanTreasuryAccountId,
      toTreasuryAccountId: trip.sourceTreasuryAccountId,
    });
  }

  const settledAt = cmd.now?.() ?? new Date().toISOString();
  const settlement: VanTripSettlement = {
    expectedCash,
    countedCash: cmd.countedCash,
    cashVariance,
    stockCounts,
    settledAt,
  };

  const settled: VanTrip = {
    ...trip,
    status: "settled",
    settledAt,
    settlement,
  };

  await deps.trips.update(settled);
  return settled;
}
