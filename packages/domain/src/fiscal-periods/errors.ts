import type { FiscalPeriodStatus } from "./fiscal-period.js";
import { FISCAL_PERIOD_STATUS_LABEL, FISCAL_PERIOD_TRANSITION_REFUSAL, fiscalPeriodLabel, quotedFiscalPeriod, type FiscalPeriodRef, type FiscalPeriodTransition } from "./labels.js";

/** Raised when an operation references a fiscal period id that does not exist. */
export class FiscalPeriodNotFoundError extends Error {
  readonly code = "FISCAL_PERIOD_NOT_FOUND";
  constructor(readonly periodId: string) {
    super(`الفترة المحاسبية "${periodId}" غير موجودة.`);
    this.name = "FiscalPeriodNotFoundError";
  }
}

/** Raised when a (year, periodNumber) pair already has a generated period. */
export class DuplicateFiscalPeriodError extends Error {
  readonly code = "DUPLICATE_FISCAL_PERIOD";
  constructor(
    readonly year: number,
    readonly periodNumber: number,
  ) {
    super(`الفترة المحاسبية ${year}-${String(periodNumber).padStart(2, "0")} موجودة بالفعل.`);
    this.name = "DuplicateFiscalPeriodError";
  }
}

/**
 * Raised by a status transition (close/reopen/lock) attempted from a status
 * that doesn't allow it — the three-tier lifecycle (مفتوحة → مغلقة → مقفلة)
 * only permits open→closed, closed→open (reopen), and closed→locked; locked
 * is terminal.
 */
export class InvalidPeriodTransitionError extends Error {
  readonly code = "INVALID_PERIOD_TRANSITION";
  readonly periodId: string;
  readonly messageEn: string;
  constructor(
    period: FiscalPeriodRef,
    readonly fromStatus: FiscalPeriodStatus,
    readonly attemptedTransition: FiscalPeriodTransition,
  ) {
    const text = FISCAL_PERIOD_TRANSITION_REFUSAL[attemptedTransition](period, fromStatus);
    super(text.ar);
    this.messageEn = text.en;
    this.periodId = period.id;
    this.name = "InvalidPeriodTransitionError";
  }
}

/**
 * Raised by `assertOpenForPosting` when a journal line is dated into a
 * period that isn't مفتوحة (open) — the guard the GL posting engine calls
 * before writing any journal line (docs/archive/catalog/04's "الفترات المالية"
 * section: this is the period-control mechanism referenced by Journal
 * Entries).
 */
export class PeriodNotOpenForPostingError extends Error {
  readonly code = "PERIOD_NOT_OPEN_FOR_POSTING";
  readonly periodId: string;
  readonly messageEn: string;
  constructor(
    period: FiscalPeriodRef,
    readonly status: FiscalPeriodStatus,
  ) {
    super(`${quotedFiscalPeriod(period).ar} ${FISCAL_PERIOD_STATUS_LABEL[status].ar} ولا تسمح بالترحيل.`);
    this.messageEn = `Fiscal period ${fiscalPeriodLabel(period).en} is ${FISCAL_PERIOD_STATUS_LABEL[status].en} and does not accept postings.`;
    this.periodId = period.id;
    this.name = "PeriodNotOpenForPostingError";
  }
}

/** Raised when no fiscal period has been generated to cover a given posting date. */
export class NoFiscalPeriodForDateError extends Error {
  readonly code = "NO_FISCAL_PERIOD_FOR_DATE";
  constructor(readonly date: string) {
    super(`لا توجد فترة محاسبية تغطي التاريخ "${date}".`);
    this.name = "NoFiscalPeriodForDateError";
  }
}
