import type { FiscalPeriod } from "./fiscal-period.js";
import { InvalidPeriodTransitionError, PeriodNotOpenForPostingError } from "./errors.js";

/**
 * Pure state-transition functions for the three-tier fiscal-period lifecycle
 * (docs/catalog/04 "الفترات المالية"): مفتوحة (open) → مغلقة (closed) →
 * مقفلة (locked). A closed period may be reopened (مطابق لصلاحية
 * `accounting.period.reopen`); a locked period is terminal — there is no
 * unlock action, matching the permission catalog (no "unlock"/"reopen from
 * locked" permission exists).
 */

/** open → closed. */
export function closePeriod(period: FiscalPeriod): FiscalPeriod {
  if (period.status !== "open") {
    throw new InvalidPeriodTransitionError(period.id, period.status, "close");
  }
  return { ...period, status: "closed" };
}

/** closed → open. */
export function reopenPeriod(period: FiscalPeriod): FiscalPeriod {
  if (period.status !== "closed") {
    throw new InvalidPeriodTransitionError(period.id, period.status, "reopen");
  }
  return { ...period, status: "open" };
}

/**
 * closed → locked. A period must be closed before it can be locked — locking
 * an open period directly is rejected so the (reversible) close step is
 * never skipped on the way to the (irreversible) locked state.
 */
export function lockPeriod(period: FiscalPeriod): FiscalPeriod {
  if (period.status !== "closed") {
    throw new InvalidPeriodTransitionError(period.id, period.status, "lock");
  }
  return { ...period, status: "locked" };
}

/**
 * Guard the GL posting engine calls before writing any journal line dated
 * into `period` — throws {@link PeriodNotOpenForPostingError} unless the
 * period is مفتوحة (open).
 */
export function assertOpenForPosting(period: Pick<FiscalPeriod, "id" | "status">): void {
  if (period.status !== "open") {
    throw new PeriodNotOpenForPostingError(period.id, period.status);
  }
}
