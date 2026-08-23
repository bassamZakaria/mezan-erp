import type { Money, Qty } from "../money/index.js";

/**
 * Inventory Write-down Run (docs/tasks.md Phase 4 "Aging-based inventory
 * write-down batch"): a monthly, manually-triggered, per-period-idempotent
 * batch that provisions for slow-moving stock. Mirrors
 * `fixed-assets/depreciation-run.ts`'s shape (draft batch of lines → one
 * posted balanced GL entry) but never touches an item's recorded WAC/cost
 * layers — it only posts a contra-asset provision (see document-hooks.ts's
 * INITIAL_STOCK modelling of 1190 for the account, and post-writedown-run.ts
 * for the posting itself).
 */

export type WritedownRunStatus = "draft" | "posted" | "cancelled";

export interface WritedownRunLine {
  readonly itemId: string;
  readonly warehouseId: string;
  /** On-hand qty at the time the run was drafted. */
  readonly onHandQty: Qty;
  /** The position's weighted-average unit cost at the time the run was drafted. */
  readonly unitCost: Money;
  /** Whole days since the position's last stock movement, as of the period end. */
  readonly agingDays: number;
  /** The policy rate applied (basis points). */
  readonly writedownRateBps: number;
  /** onHandQty × unitCost × writedownRateBps — the line's provision amount. */
  readonly amount: Money;
}

export interface WritedownRun {
  readonly id: string;
  /** "YYYY-MM" */
  readonly period: string;
  /** Null scopes the run to every warehouse. */
  readonly warehouseId: string | null;
  readonly status: WritedownRunStatus;
  readonly lines: readonly WritedownRunLine[];
  readonly totalAmount: Money;
  readonly journalEntryId: string | null;
  readonly createdAt: string;
  readonly postedAt: string | null;
}

/** Persistence port for write-down runs. The domain depends on this interface only — no SQL, no driver. */
export interface WritedownRunRepository {
  findById(id: string): Promise<WritedownRun | null>;
  findByPeriod(period: string, warehouseId: string | null): Promise<WritedownRun | null>;
  list(): Promise<WritedownRun[]>;
  create(run: WritedownRun): Promise<void>;
  update(run: WritedownRun): Promise<void>;
}
