import { Money } from "../money/index.js";
import type { Qty } from "../money/index.js";
import type { VanTrip, VanTripCrewRole, VanTripRepository } from "./van-trip.js";
import { InvalidVanTripError, SameWarehouseVanTripError } from "./errors.js";

export interface OpenVanTripCommand {
  readonly id: string;
  readonly tripNo?: string | null;
  readonly date: string;
  readonly branchId: string;
  readonly vanId?: string | null;
  readonly vanWarehouseId: string;
  readonly vanTreasuryAccountId: string;
  readonly sourceWarehouseId: string;
  readonly sourceTreasuryAccountId: string;
  readonly openingCashFloat?: Money;
  readonly crew: readonly { employeeId: string; role: VanTripCrewRole }[];
  readonly loadedStock?: readonly { itemId: string; qty: Qty }[];
  readonly notes?: string | null;
}

export interface TreasuryTransferInput {
  readonly id: string;
  readonly date: string;
  readonly amount: Money;
  readonly branchId: string;
  readonly fromTreasuryAccountId: string;
  readonly toTreasuryAccountId: string;
}

export interface OpenVanTripDeps {
  readonly trips: VanTripRepository;
  /**
   * Confirms every crew member is a real employee. The form used to take a
   * typed employee id, so a trip could name a driver who does not work here —
   * the field-binding defect this closes (R3.13).
   */
  readonly employeeExists?: (employeeId: string) => Promise<boolean>;
  /** Reuses the REAL costing/stock-ledger engine: loading stock onto the van is a valuation-neutral warehouse transfer. */
  readonly stock: Pick<import("../inventory/stock-ledger-service.js").StockLedgerService, "postTransfer">;
  /**
   * Reuses the REAL treasury voucher engine for the opening cash float: opening a trip
   * with openingCashFloat > 0 books an `inter_treasury_transfer` voucher (source treasury
   * → van treasury) via VoucherService.createVoucher + confirmVoucher. Wired by the caller
   * (API layer) with real GL/numbering/ledger deps — this port only needs the two calls
   * this command uses.
   */
  readonly treasuryTransfer?: (input: TreasuryTransferInput) => Promise<void>;
  readonly now?: () => string;
}

export async function openVanTrip(cmd: OpenVanTripCommand, deps: OpenVanTripDeps): Promise<VanTrip> {
  const reasons: string[] = [];
  if (cmd.crew.length === 0) reasons.push("يجب إضافة عضو واحد على الأقل للطاقم");
  if (deps.employeeExists) {
    for (const member of cmd.crew) {
      if (!(await deps.employeeExists(member.employeeId))) {
        reasons.push(`عضو الطاقم "${member.employeeId}" ليس موظفاً مسجلاً`);
      }
    }
  }
  if (reasons.length > 0) throw new InvalidVanTripError(reasons);

  if (cmd.sourceWarehouseId === cmd.vanWarehouseId) {
    throw new SameWarehouseVanTripError(cmd.sourceWarehouseId);
  }

  const loadedStock = cmd.loadedStock ?? [];
  if (loadedStock.length > 0) {
    await deps.stock.postTransfer({
      transferId: cmd.id,
      fromWarehouseId: cmd.sourceWarehouseId,
      toWarehouseId: cmd.vanWarehouseId,
      lines: loadedStock.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    });
  }

  const openingCashFloat = cmd.openingCashFloat ?? Money.zero();
  if (openingCashFloat.scaled > 0n && deps.treasuryTransfer) {
    await deps.treasuryTransfer({
      id: cmd.id,
      date: cmd.date,
      amount: openingCashFloat,
      branchId: cmd.branchId,
      fromTreasuryAccountId: cmd.sourceTreasuryAccountId,
      toTreasuryAccountId: cmd.vanTreasuryAccountId,
    });
  }

  const trip: VanTrip = {
    id: cmd.id,
    tripNo: cmd.tripNo ?? null,
    date: cmd.date,
    branchId: cmd.branchId,
    vanId: cmd.vanId ?? null,
    vanWarehouseId: cmd.vanWarehouseId,
    vanTreasuryAccountId: cmd.vanTreasuryAccountId,
    sourceWarehouseId: cmd.sourceWarehouseId,
    sourceTreasuryAccountId: cmd.sourceTreasuryAccountId,
    openingCashFloat,
    crew: cmd.crew.map((c) => ({ employeeId: c.employeeId, role: c.role })),
    loadedStock: loadedStock.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    cashMovements: [],
    status: "ongoing",
    openedAt: deps.now?.() ?? new Date().toISOString(),
    settledAt: null,
    settlement: null,
    notes: cmd.notes ?? null,
  };

  await deps.trips.create(trip);
  return trip;
}
