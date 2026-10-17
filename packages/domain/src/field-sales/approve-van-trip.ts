import { Money, Qty } from "../money/index.js";
import type { AdjustmentReason } from "../inventory/reasons.js";
import type { StockMovementDirection } from "../inventory/movement.js";
import {
  VanReconciliationStepKind as StepKind,
  VanReconciliationStepState as StepState,
  VanTripStatus,
  type VanTrip,
  type VanTripReconciliation,
  type VanTripReconciliationStep,
  type VanTripRepository,
  type VanTripSettlement,
} from "./van-trip.js";
import {
  VanTripExpectationChangedError,
  VanTripNotAwaitingApprovalError,
  VanTripNotFoundError,
  VanTripSelfApprovalError,
} from "./errors.js";
import { buildVanTripExpectation, type VanTripActivityPort } from "./van-trip-expectation.js";

export interface VanPostingOutcome {
  /** True when the approval gate held the document بانتظار الموافقة instead of posting it. */
  readonly held: boolean;
  readonly value: Money | null;
}

export interface VanPostingActor {
  readonly actor: string;
  readonly actorRoles?: readonly string[];
}

export interface VanAdjustmentPosting extends VanPostingActor {
  readonly documentId: string;
  readonly date: string;
  readonly memo: string;
  readonly warehouseId: string;
  readonly reason: AdjustmentReason;
  readonly direction: StockMovementDirection;
  readonly lines: readonly { readonly itemId: string; readonly qty: Qty; readonly unitCost?: Money }[];
}

export interface VanTransferPosting extends VanPostingActor {
  readonly documentId: string;
  readonly date: string;
  readonly memo: string;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly lines: readonly { readonly itemId: string; readonly qty: Qty }[];
}

/**
 * Every call is keyed by `documentId` and must be idempotent: approval is
 * resumable, and a re-run after a held or failed step calls the ones before
 * it again only if they never recorded as posted.
 */
export interface VanReconciliationPostingPort {
  recordCashVariance(input: {
    documentId: string;
    tripId: string;
    date: string;
    branchId: string;
    vanTreasuryAccountId: string;
    variance: Money;
  }): Promise<void>;
  returnCash(input: {
    documentId: string;
    tripId: string;
    date: string;
    branchId: string;
    amount: Money;
    fromTreasuryAccountId: string;
    toTreasuryAccountId: string;
  }): Promise<void>;
  postAdjustment(input: VanAdjustmentPosting): Promise<VanPostingOutcome>;
  postTransfer(input: VanTransferPosting): Promise<VanPostingOutcome>;
}

export interface ApproveVanTripCommand {
  readonly tripId: string;
  readonly actor: string;
  readonly actorRoles?: readonly string[];
  readonly date: string;
  readonly now?: () => string;
}

export interface ApproveVanTripDeps {
  readonly trips: VanTripRepository;
  readonly activity: VanTripActivityPort;
  readonly postings: VanReconciliationPostingPort;
}

export interface ApproveVanTripResult {
  readonly trip: VanTrip;
  /** True while a generated document waits in the approvals inbox; approving again resumes. */
  readonly held: boolean;
}

export function vanReconciliationDocumentId(kind: StepKind, tripId: string): string {
  return `VANREC-${kind}-${tripId}`;
}

async function assertBooksUnchanged(trip: VanTrip, settlement: VanTripSettlement, date: string, deps: ApproveVanTripDeps): Promise<void> {
  const activity = await deps.activity.read(trip, date, settlement.stockCounts.map((l) => l.itemId));
  const now = buildVanTripExpectation(trip, activity);
  if (!now.expectedCash.equals(settlement.expectedCash)) throw new VanTripExpectationChangedError(trip.id);
  const counted = new Map(settlement.stockCounts.map((l) => [l.itemId, l.expectedQty]));
  for (const line of now.lines) {
    const before = counted.get(line.itemId) ?? Qty.zero();
    if (before.scaled !== line.expectedQty.scaled) throw new VanTripExpectationChangedError(trip.id);
  }
  for (const [itemId, before] of counted) {
    if (before.isZero() || now.lines.some((l) => l.itemId === itemId)) continue;
    throw new VanTripExpectationChangedError(trip.id);
  }
}

interface PlannedStep {
  readonly kind: StepKind;
  readonly run: (documentId: string) => Promise<VanPostingOutcome>;
}

function planSteps(trip: VanTrip, settlement: VanTripSettlement, cmd: ApproveVanTripCommand, deps: ApproveVanTripDeps): PlannedStep[] {
  const label = trip.tripNo ?? trip.id;
  const actor: VanPostingActor = { actor: cmd.actor, actorRoles: cmd.actorRoles };
  const overage = settlement.stockCounts.filter((l) => l.varianceQty.scaled > 0n);
  const shortage = settlement.stockCounts.filter((l) => l.varianceQty.isNegative());
  const returned = settlement.stockCounts.filter((l) => l.countedQty.scaled > 0n);
  const steps: PlannedStep[] = [];

  if (settlement.cashVariance.scaled !== 0n) {
    steps.push({
      kind: StepKind.CashVariance,
      run: async (documentId) => {
        await deps.postings.recordCashVariance({
          documentId,
          tripId: trip.id,
          date: cmd.date,
          branchId: trip.branchId,
          vanTreasuryAccountId: trip.vanTreasuryAccountId,
          variance: settlement.cashVariance,
        });
        return { held: false, value: settlement.cashVariance };
      },
    });
  }
  if (settlement.countedCash.scaled > 0n) {
    steps.push({
      kind: StepKind.CashReturn,
      run: async (documentId) => {
        await deps.postings.returnCash({
          documentId,
          tripId: trip.id,
          date: cmd.date,
          branchId: trip.branchId,
          amount: settlement.countedCash,
          fromTreasuryAccountId: trip.vanTreasuryAccountId,
          toTreasuryAccountId: trip.sourceTreasuryAccountId,
        });
        return { held: false, value: settlement.countedCash };
      },
    });
  }
  // ORDER MATTERS: the overage lands on the van before the counted stock leaves
  // it, or the transfer would draw the van below zero.
  if (overage.length > 0) {
    steps.push({
      kind: StepKind.OverageAdjustment,
      run: (documentId) =>
        deps.postings.postAdjustment({
          ...actor,
          documentId,
          date: cmd.date,
          memo: `زيادة جرد عند تسوية رحلة ${label}`,
          warehouseId: trip.vanWarehouseId,
          reason: "PHYSICAL_COUNT",
          direction: "IN",
          lines: overage.map((l) => ({ itemId: l.itemId, qty: l.varianceQty, unitCost: l.unitCost })),
        }),
    });
  }
  if (returned.length > 0) {
    steps.push({
      kind: StepKind.StockReturn,
      run: (documentId) =>
        deps.postings.postTransfer({
          ...actor,
          documentId,
          date: cmd.date,
          memo: `إرجاع بضاعة رحلة ${label} إلى المستودع`,
          fromWarehouseId: trip.vanWarehouseId,
          toWarehouseId: trip.sourceWarehouseId,
          lines: returned.map((l) => ({ itemId: l.itemId, qty: l.countedQty })),
        }),
    });
  }
  if (shortage.length > 0) {
    steps.push({
      kind: StepKind.ShortageAdjustment,
      run: (documentId) =>
        deps.postings.postAdjustment({
          ...actor,
          documentId,
          date: cmd.date,
          memo: `عجز بضاعة عند تسوية رحلة ${label}`,
          warehouseId: trip.vanWarehouseId,
          reason: "SHORTAGE",
          direction: "OUT",
          lines: shortage.map((l) => ({ itemId: l.itemId, qty: l.varianceQty.negate() })),
        }),
    });
  }
  return steps;
}

function withStep(rec: VanTripReconciliation, step: VanTripReconciliationStep): VanTripReconciliation {
  return { ...rec, steps: [...rec.steps.filter((s) => s.kind !== step.kind), step] };
}

/**
 * اعتماد التسوية — posts what the count found, in the order that keeps every
 * position non-negative: the cash variance and the cash handover, the overage
 * onto the van, the counted stock back to its source warehouse, and the
 * shortfall as a SHORTAGE adjustment on the van (DEC-19). The adjustments and
 * the transfer are real documents through their own approval gate; when one
 * is held the trip stays بانتظار الاعتماد and approving again resumes.
 */
export async function approveVanTripSettlement(cmd: ApproveVanTripCommand, deps: ApproveVanTripDeps): Promise<ApproveVanTripResult> {
  const trip = await deps.trips.findById(cmd.tripId);
  if (!trip) throw new VanTripNotFoundError(cmd.tripId);
  const settlement = trip.settlement;
  if (trip.status !== VanTripStatus.AwaitingApproval || !settlement) {
    throw new VanTripNotAwaitingApprovalError(trip.id, trip.status);
  }
  if (settlement.settledBy !== null && settlement.settledBy === cmd.actor) throw new VanTripSelfApprovalError(trip.id);

  const now = () => cmd.now?.() ?? new Date().toISOString();
  let rec: VanTripReconciliation = settlement.reconciliation ?? { approvedBy: cmd.actor, startedAt: now(), completedAt: null, steps: [] };
  if (rec.steps.length === 0) await assertBooksUnchanged(trip, settlement, cmd.date, deps);

  let current: VanTrip = trip;
  const persist = async (next: VanTripReconciliation, status: VanTripStatus) => {
    current = { ...current, status, settlement: { ...settlement, reconciliation: next } };
    await deps.trips.update(current);
  };

  for (const step of planSteps(trip, settlement, cmd, deps)) {
    if (rec.steps.some((s) => s.kind === step.kind && s.state === StepState.Posted)) continue;
    const documentId = vanReconciliationDocumentId(step.kind, trip.id);
    const outcome = await step.run(documentId);
    rec = withStep(rec, { kind: step.kind, documentId, state: outcome.held ? StepState.Held : StepState.Posted, value: outcome.value });
    if (outcome.held) {
      await persist(rec, VanTripStatus.AwaitingApproval);
      return { trip: current, held: true };
    }
    await persist(rec, VanTripStatus.AwaitingApproval);
  }

  await persist({ ...rec, completedAt: now() }, VanTripStatus.Settled);
  return { trip: current, held: false };
}
