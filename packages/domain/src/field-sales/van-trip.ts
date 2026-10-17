/**
 * Van trips — core entity (docs/archive/catalog/07-mfg-projects-assets.md "رحلات
 * المندوبين" / Van-Rep Trips, Field Sales). A `VanTrip` tracks a delivery/sales
 * van's lifecycle: load stock and cash with a crew, let them sell/collect in
 * the field, then settle expected-vs-counted cash and stock when the van
 * returns.
 */

import type { Money, Qty } from "../money/index.js";

export enum VanTripStatus {
  Ongoing = "ongoing",
  AwaitingApproval = "awaiting_approval",
  Settled = "settled",
  Cancelled = "cancelled",
}
export enum VanTripCrewRole {
  Driver = "driver",
  Rep = "rep",
  Assistant = "assistant",
}

export interface VanTripStatusDefinition {
  readonly code: VanTripStatus;
  readonly labelAr: string;
}

export const VAN_TRIP_STATUS_DEFINITIONS: readonly VanTripStatusDefinition[] = [
  { code: VanTripStatus.Ongoing, labelAr: "جارية" },
  { code: VanTripStatus.AwaitingApproval, labelAr: "بانتظار اعتماد التسوية" },
  { code: VanTripStatus.Settled, labelAr: "مسواة" },
  { code: VanTripStatus.Cancelled, labelAr: "ملغاة" },
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

export enum VanTripCashMovementKind {
  Sale = "sale",
  Collection = "collection",
}

export interface VanTripCashMovement {
  readonly id: string;
  readonly kind: VanTripCashMovementKind;
  readonly amount: Money;
  readonly occurredAt: string;
  readonly notes: string | null;
}

export interface VanTripStockCountLine {
  readonly itemId: string;
  /** INVARIANT: the van warehouse's ledger on-hand at settlement — what approval brings the van back to zero from. */
  readonly expectedQty: Qty;
  readonly countedQty: Qty;
  readonly varianceQty: Qty;
  readonly loadedQty: Qty;
  readonly soldQty: Qty;
  readonly returnedQty: Qty;
  /** On-hand the trip's own documents do not explain: stock left from an earlier trip, or a movement from another screen. */
  readonly otherQty: Qty;
  /** The van's weighted-average cost at settlement, or the item's cost price when the van holds none. */
  readonly unitCost: Money;
  readonly varianceValue: Money;
}

export interface VanTripCashBreakdown {
  readonly openingFloat: Money;
  readonly fieldSales: Money;
  readonly fieldCollections: Money;
  readonly voucherCollections: Money;
  readonly other: Money;
}

export enum VanReconciliationStepKind {
  CashVariance = "cash_variance",
  CashReturn = "cash_return",
  OverageAdjustment = "overage_adjustment",
  StockReturn = "stock_return",
  ShortageAdjustment = "shortage_adjustment",
}

export enum VanReconciliationStepState {
  Posted = "posted",
  Held = "held",
}

export interface VanTripReconciliationStep {
  readonly kind: VanReconciliationStepKind;
  readonly documentId: string;
  readonly state: VanReconciliationStepState;
  readonly value: Money | null;
}

export interface VanTripReconciliation {
  readonly approvedBy: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly steps: readonly VanTripReconciliationStep[];
}

export interface VanTripSettlement {
  /** INVARIANT: the van till's own book balance at settlement, so an approved trip leaves the till at zero. */
  readonly expectedCash: Money;
  readonly countedCash: Money;
  /** countedCash - expectedCash; negative is a shortage, positive is an overage. */
  readonly cashVariance: Money;
  readonly stockCounts: readonly VanTripStockCountLine[];
  readonly settledAt: string;
  readonly settledBy: string | null;
  readonly settlementDate: string | null;
  readonly cashBreakdown: VanTripCashBreakdown | null;
  readonly invoicedSales: Money;
  readonly returnsValue: Money;
  readonly reconciliation: VanTripReconciliation | null;
}

export interface VanTrip {
  readonly id: string;
  readonly tripNo: string | null;
  readonly date: string;
  readonly branchId: string;
  /** The vehicle this trip is driving (R3.13) — null on trips opened before the registry existed. */
  readonly vanId: string | null;
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
