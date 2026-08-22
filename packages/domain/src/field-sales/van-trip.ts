/**
 * Van trips — core entity (docs/catalog/07-mfg-projects-assets.md "رحلات
 * المندوبين" / Van-Rep Trips, Field Sales). A `VanTrip` tracks a delivery/sales
 * van's lifecycle: load stock and cash with a crew, let them sell/collect in
 * the field, then settle expected-vs-counted cash and stock when the van
 * returns.
 */

import type { Money, Qty } from "../money/index.js";

export type VanTripStatus = "ongoing" | "settled" | "cancelled";
export type VanTripCrewRole = "driver" | "rep" | "assistant";

export interface VanTripStatusDefinition {
  readonly code: VanTripStatus;
  readonly labelAr: string;
}

export const VAN_TRIP_STATUS_DEFINITIONS: readonly VanTripStatusDefinition[] = [
  { code: "ongoing", labelAr: "جارية" },
  { code: "settled", labelAr: "مسواة" },
  { code: "cancelled", labelAr: "ملغاة" },
] as const;

export function getVanTripStatusLabel(status: VanTripStatus): string {
  return VAN_TRIP_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export interface VanTripCrewMember {
  readonly employeeId: string;
  readonly role: VanTripCrewRole;
}

export interface VanTripStockLine {
  readonly itemId: string;
  readonly qty: Qty;
}

export type VanTripCashMovementKind = "sale" | "collection";

export interface VanTripCashMovement {
  readonly id: string;
  readonly kind: VanTripCashMovementKind;
  readonly amount: Money;
  readonly occurredAt: string;
  readonly notes: string | null;
}

export interface VanTripStockCountLine {
  readonly itemId: string;
  readonly expectedQty: Qty;
  readonly countedQty: Qty;
  readonly varianceQty: Qty;
}

export interface VanTripSettlement {
  readonly expectedCash: Money;
  readonly countedCash: Money;
  /** countedCash - expectedCash; negative is a shortage, positive is an overage. */
  readonly cashVariance: Money;
  readonly stockCounts: readonly VanTripStockCountLine[];
  readonly settledAt: string;
}

export interface VanTrip {
  readonly id: string;
  readonly tripNo: string | null;
  readonly date: string;
  readonly branchId: string;
  readonly vanWarehouseId: string;
  readonly vanTreasuryAccountId: string;
  readonly sourceWarehouseId: string;
  readonly sourceTreasuryAccountId: string;
  readonly openingCashFloat: Money;
  readonly crew: readonly VanTripCrewMember[];
  readonly loadedStock: readonly VanTripStockLine[];
  readonly cashMovements: readonly VanTripCashMovement[];
  readonly status: VanTripStatus;
  readonly openedAt: string;
  readonly settledAt: string | null;
  readonly settlement: VanTripSettlement | null;
  readonly notes: string | null;
}

/** Persistence port for van trips. The domain depends on this interface only — no SQL, no driver. */
export interface VanTripRepository {
  findById(id: string): Promise<VanTrip | null>;
  list(): Promise<VanTrip[]>;
  create(trip: VanTrip): Promise<void>;
  update(trip: VanTrip): Promise<void>;
}
