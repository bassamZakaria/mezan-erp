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
  constructor(
    readonly periodId: string,
    readonly fromStatus: string,
    readonly attemptedTransition: string,
  ) {
    super(`لا يمكن تنفيذ "${attemptedTransition}" على الفترة المحاسبية "${periodId}" وهي في حالة "${fromStatus}".`);
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
  constructor(
    readonly periodId: string,
    readonly status: string,
  ) {
    super(`الفترة المحاسبية "${periodId}" حالتها "${status}" ولا تسمح بالترحيل.`);
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
