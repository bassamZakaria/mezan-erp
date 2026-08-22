import type { Money } from "../money/index.js";
import type { VanTrip, VanTripCashMovementKind } from "./van-trip.js";
import { VanTripNotOngoingError } from "./errors.js";

export interface RecordVanCashMovementInput {
  readonly id: string;
  readonly kind: VanTripCashMovementKind;
  readonly amount: Money;
  readonly occurredAt: string;
  readonly notes?: string | null;
}

/**
 * Pure function: how "in-field sales/collections accrue" is modeled — each
 * POS/collection event during the trip appends here; the caller (API layer)
 * persists the returned trip via `repo.update`.
 */
export function recordVanCashMovement(trip: VanTrip, movement: RecordVanCashMovementInput): VanTrip {
  if (trip.status !== "ongoing") {
    throw new VanTripNotOngoingError(trip.id, trip.status);
  }
  return {
    ...trip,
    cashMovements: [
      ...trip.cashMovements,
      {
        id: movement.id,
        kind: movement.kind,
        amount: movement.amount,
        occurredAt: movement.occurredAt,
        notes: movement.notes ?? null,
      },
    ],
  };
}
