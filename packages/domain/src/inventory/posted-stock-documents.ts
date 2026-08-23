/**
 * Read model for stock adjustments and stock transfers as POSTED documents,
 * folded back out of the append-only movement ledger (movement.ts).
 *
 * The engine's write path (`StockLedgerService.postAdjustment` / `.postTransfer`)
 * does not keep a document row of its own — but every movement it appends
 * carries `sourceDocType` / `sourceDocId` / `sourceDocNumber` / `reason` /
 * `occurredAt`, which is the whole posted document. So the history the
 * adjustments and transfers screens need is derived here rather than duplicated
 * into a second table that could drift from the ledger.
 *
 * This is deliberately the read model for BOTH entry points: documents created
 * through the document framework (stock-adjustment-document.ts /
 * stock-transfer-document.ts) drive the same engine on confirm, and so appear
 * here too — as does the adjustment a physical count generates.
 */

import { Money, Qty } from "../money/index.js";
import { signedValue, type StockMovement, type StockMovementDirection } from "./movement.js";
import type { AdjustmentReason } from "./reasons.js";
import { extend } from "./wac-math.js";

export interface PostedAdjustmentLine {
  readonly itemId: string;
  readonly direction: StockMovementDirection;
  readonly qty: Qty;
  readonly unitCost: Money;
  /** Signed value contribution: +qty×cost for an IN line, −qty×cost for an OUT line. */
  readonly value: Money;
}

/** One stock adjustment as it was posted to the ledger. */
export interface PostedAdjustment {
  readonly id: string;
  readonly docNo: string | null;
  readonly warehouseId: string;
  readonly reason: AdjustmentReason | null;
  readonly occurredAt: string;
  readonly lines: readonly PostedAdjustmentLine[];
  /** Net inventory value change — the magnitude the balancing GL entry carried. */
  readonly valueDelta: Money;
}

export interface PostedTransferLine {
  readonly itemId: string;
  readonly qty: Qty;
  /** The source warehouse's moving-average cost at which the quantity moved. */
  readonly unitCost: Money;
  readonly value: Money;
}

/** One stock transfer as it was posted to the ledger (valuation-neutral). */
export interface PostedTransfer {
  readonly id: string;
  readonly docNo: string | null;
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly occurredAt: string;
  readonly lines: readonly PostedTransferLine[];
  /** Value moved between the two warehouses. Total system value is unchanged. */
  readonly totalValue: Money;
}

export interface PostedAdjustmentFilter {
  /** Inclusive calendar-date lower bound, compared against `occurredAt`'s date part. */
  readonly fromDate?: string;
  /** Inclusive calendar-date upper bound. */
  readonly toDate?: string;
  readonly warehouseId?: string;
  readonly reason?: AdjustmentReason;
  /** Case-insensitive substring over document number, id and line item ids. */
  readonly search?: string;
}

export interface PostedTransferFilter {
  readonly fromDate?: string;
  readonly toDate?: string;
  /** Matches a transfer whose SOURCE or DESTINATION is this warehouse. */
  readonly warehouseId?: string;
  readonly fromWarehouseId?: string;
  readonly toWarehouseId?: string;
  readonly search?: string;
}

function dateOf(occurredAt: string): string {
  return occurredAt.slice(0, 10);
}

function groupBySourceDoc(movements: readonly StockMovement[]): Map<string, StockMovement[]> {
  const groups = new Map<string, StockMovement[]>();
  for (const movement of movements) {
    const group = groups.get(movement.sourceDocId);
    if (group) group.push(movement);
    else groups.set(movement.sourceDocId, [movement]);
  }
  return groups;
}

/** Newest first, with a stable id tie-break so equal timestamps keep a deterministic order. */
function byOccurredAtDesc(a: { occurredAt: string; id: string }, b: { occurredAt: string; id: string }): number {
  return a.occurredAt === b.occurredAt ? b.id.localeCompare(a.id) : b.occurredAt.localeCompare(a.occurredAt);
}

/** Fold ADJUSTMENT movements into one posted adjustment per source document. */
export function foldPostedAdjustments(movements: readonly StockMovement[]): readonly PostedAdjustment[] {
  const adjustments: PostedAdjustment[] = [];
  for (const [sourceDocId, group] of groupBySourceDoc(
    movements.filter((m) => m.sourceDocType === "ADJUSTMENT"),
  )) {
    const first = group[0] as StockMovement;
    const lines = group.map((m) => ({
      itemId: m.itemId,
      direction: m.direction,
      qty: m.qty,
      unitCost: m.unitCost,
      value: signedValue(m),
    }));
    adjustments.push({
      id: sourceDocId,
      docNo: first.sourceDocNumber,
      warehouseId: first.warehouseId,
      reason: first.reason,
      occurredAt: first.occurredAt,
      lines,
      valueDelta: Money.sum(lines.map((l) => l.value)),
    });
  }
  return adjustments.sort(byOccurredAtDesc);
}

/**
 * Fold TRANSFER movements into one posted transfer per source document. A
 * transfer appends two movements per line — an OUT leg from the source
 * warehouse and an IN leg into the destination at that same unit cost — so the
 * OUT legs carry the lines and the IN legs identify the destination.
 */
export function foldPostedTransfers(movements: readonly StockMovement[]): readonly PostedTransfer[] {
  const transfers: PostedTransfer[] = [];
  for (const [sourceDocId, group] of groupBySourceDoc(
    movements.filter((m) => m.sourceDocType === "TRANSFER"),
  )) {
    const outLegs = group.filter((m) => m.direction === "OUT");
    const inLegs = group.filter((m) => m.direction === "IN");
    const first = (outLegs[0] ?? group[0]) as StockMovement;
    const lines = (outLegs.length > 0 ? outLegs : inLegs).map((m) => ({
      itemId: m.itemId,
      qty: m.qty,
      unitCost: m.unitCost,
      value: extend(m.qty, m.unitCost),
    }));
    transfers.push({
      id: sourceDocId,
      docNo: first.sourceDocNumber,
      fromWarehouseId: first.warehouseId,
      toWarehouseId: inLegs[0]?.warehouseId ?? first.warehouseId,
      occurredAt: first.occurredAt,
      lines,
      totalValue: Money.sum(lines.map((l) => l.value)),
    });
  }
  return transfers.sort(byOccurredAtDesc);
}

function matchesSearch(needle: string, haystack: readonly (string | null)[]): boolean {
  const q = needle.trim().toLowerCase();
  if (q === "") return true;
  return haystack.some((value) => value !== null && value.toLowerCase().includes(q));
}

function withinDates(occurredAt: string, fromDate?: string, toDate?: string): boolean {
  const date = dateOf(occurredAt);
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

export function filterPostedAdjustments(
  adjustments: readonly PostedAdjustment[],
  filter: PostedAdjustmentFilter = {},
): readonly PostedAdjustment[] {
  return adjustments.filter((a) => {
    if (!withinDates(a.occurredAt, filter.fromDate, filter.toDate)) return false;
    if (filter.warehouseId && a.warehouseId !== filter.warehouseId) return false;
    if (filter.reason && a.reason !== filter.reason) return false;
    if (filter.search !== undefined && !matchesSearch(filter.search, [a.docNo, a.id, ...a.lines.map((l) => l.itemId)])) {
      return false;
    }
    return true;
  });
}

export function filterPostedTransfers(
  transfers: readonly PostedTransfer[],
  filter: PostedTransferFilter = {},
): readonly PostedTransfer[] {
  return transfers.filter((t) => {
    if (!withinDates(t.occurredAt, filter.fromDate, filter.toDate)) return false;
    if (filter.fromWarehouseId && t.fromWarehouseId !== filter.fromWarehouseId) return false;
    if (filter.toWarehouseId && t.toWarehouseId !== filter.toWarehouseId) return false;
    if (
      filter.warehouseId &&
      t.fromWarehouseId !== filter.warehouseId &&
      t.toWarehouseId !== filter.warehouseId
    ) {
      return false;
    }
    if (filter.search !== undefined && !matchesSearch(filter.search, [t.docNo, t.id, ...t.lines.map((l) => l.itemId)])) {
      return false;
    }
    return true;
  });
}
