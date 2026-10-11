import type { Money } from "../money/index.js";
import type { CostCategory } from "../contracting/cost-category.js";

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
  /** بُعد المشروع — the asset's project at the time this run was drafted. */
  readonly projectId?: string | null;
  readonly costCategory?: CostCategory | null;
}

/** A drafted line the posting left out because another posted run had already charged that asset for the period. */
export interface DepreciationRunSkippedLine {
  readonly assetId: string;
  readonly assetCode: string;
  readonly amount: Money;
}

export interface DepreciationRun {
  readonly id: string;
  /** "YYYY-MM" */
  readonly period: string;
  readonly branchId: string | null;
  readonly status: DepreciationRunStatus;
  readonly lines: readonly DepreciationRunLine[];
  readonly skippedLines?: readonly DepreciationRunSkippedLine[];
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
