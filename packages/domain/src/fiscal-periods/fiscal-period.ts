/**
 * Fiscal periods — core entity (docs/archive/catalog/04-accounting-treasury.md
 * "الفترات المالية"). A `FiscalPeriod` is one calendar month within a fiscal
 * year, carrying a three-tier lifecycle: مفتوحة (open, posting allowed) →
 * مغلقة (closed, posting blocked) → مقفلة (locked, posting blocked and
 * terminal — no further transitions). Posting/GL code calls
 * `assertOpenForPosting` (./transitions.js) before writing a journal line
 * dated into a period, so this module is the single place that decides
 * whether a date is postable.
 */

import type { PeriodStatus } from "../period-close/types.js";

export type FiscalPeriodStatus = `${PeriodStatus}`;

export interface FiscalPeriod {
  readonly id: string;
  readonly year: number;
  /** 1–12, calendar month within the fiscal year. */
  readonly periodNumber: number;
  /** ISO date (YYYY-MM-DD), inclusive. */
  readonly startDate: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  readonly endDate: string;
  readonly status: FiscalPeriodStatus;
}

/** Posting is allowed only while a period is مفتوحة (open) — mirrors the mockup's "الترحيل: مسموح" column. */
export function isPostingAllowed(period: Pick<FiscalPeriod, "status">): boolean {
  return period.status === "open";
}

/** Persistence port for fiscal periods. The domain depends on this interface only — no SQL, no driver. */
export interface FiscalPeriodRepository {
  findById(id: string): Promise<FiscalPeriod | null>;
  /** Finds the period containing `date` (ISO YYYY-MM-DD), if one has been generated. */
  findByDate(date: string): Promise<FiscalPeriod | null>;
  findByYearAndNumber(year: number, periodNumber: number): Promise<FiscalPeriod | null>;
  listByYear(year: number): Promise<FiscalPeriod[]>;
  list(): Promise<FiscalPeriod[]>;
  create(period: FiscalPeriod): Promise<void>;
  update(period: FiscalPeriod): Promise<void>;
}
