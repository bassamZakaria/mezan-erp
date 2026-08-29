import type { Money } from "../money/index.js";

/**
 * Fixed Assets — Depreciation Runs (docs/archive/catalog/07-mfg-projects-assets.md
 * "تشغيل الإهلاك"). A run is a draft batch of per-asset depreciation lines for
 * one period (+ optional branch scope); posting it produces one REAL balanced
 * GL journal entry (see post-depreciation-run.ts).
 */

export type DepreciationRunStatus = "draft" | "posted" | "cancelled";

export interface DepreciationRunLine {
  readonly assetId: string;
  readonly amount: Money;
}

export interface DepreciationRun {
  readonly id: string;
  /** "YYYY-MM" */
  readonly period: string;
  readonly branchId: string | null;
  readonly status: DepreciationRunStatus;
  readonly lines: readonly DepreciationRunLine[];
  readonly totalAmount: Money;
  readonly journalEntryId: string | null;
  readonly createdAt: string;
  readonly postedAt: string | null;
}

/** Persistence port for depreciation runs. The domain depends on this interface only — no SQL, no driver. */
export interface DepreciationRunRepository {
  findById(id: string): Promise<DepreciationRun | null>;
  findByPeriod(period: string, branchId: string | null): Promise<DepreciationRun | null>;
  list(): Promise<DepreciationRun[]>;
  create(run: DepreciationRun): Promise<void>;
  update(run: DepreciationRun): Promise<void>;
}
