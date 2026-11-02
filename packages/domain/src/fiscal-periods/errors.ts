import type { FiscalPeriodStatus } from "./fiscal-period.js";
import { FISCAL_PERIOD_STATUS_LABEL, FISCAL_PERIOD_TRANSITION_REFUSAL, fiscalPeriodLabel, fiscalPeriodRefOf, quotedFiscalPeriod, type FiscalPeriodRef, type FiscalPeriodTransition } from "./labels.js";

/** Raised when an operation references a fiscal period id that does not exist. */
export class FiscalPeriodNotFoundError extends Error {
  readonly code = "FISCAL_PERIOD_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly periodId: string) {
    super(`الفترة المحاسبية "${periodId}" غير موجودة.`);
    this.messageEn = `Fiscal period "${periodId}" not found.`;
    this.name = "FiscalPeriodNotFoundError";
  }
}

/** Raised when a (year, periodNumber) pair already has a generated period. */
export class DuplicateFiscalPeriodError extends Error {
  readonly code = "DUPLICATE_FISCAL_PERIOD";
  readonly messageEn: string;
  constructor(
    readonly year: number,
    readonly periodNumber: number,
  ) {
    super(`الفترة المحاسبية ${year}-${String(periodNumber).padStart(2, "0")} موجودة بالفعل.`);
    this.messageEn = `Fiscal period ${year}-${String(periodNumber).padStart(2, "0")} already exists.`;
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
  earliestOpenDate: string | null = null;
  constructor(
    period: FiscalPeriodRef | string,
    readonly status: FiscalPeriodStatus,
  ) {
    const ref = fiscalPeriodRefOf(period);
    const id = typeof period === "string" ? period : period.id;
    const named = ref ? { ar: quotedFiscalPeriod(ref).ar, en: fiscalPeriodLabel(ref).en } : { ar: `الفترة المحاسبية «${id}»`, en: id };
    super(`${named.ar} ${FISCAL_PERIOD_STATUS_LABEL[status].ar} ولا تسمح بالترحيل.`);
    this.messageEn = `Fiscal period ${named.en} is ${FISCAL_PERIOD_STATUS_LABEL[status].en} and does not accept postings.`;
    this.periodId = id;
    this.name = "PeriodNotOpenForPostingError";
  }
}

/** Raised when no fiscal period has been generated to cover a given posting date. */
export class NoFiscalPeriodForDateError extends Error {
  readonly code = "NO_FISCAL_PERIOD_FOR_DATE";
  readonly messageEn: string;
  earliestOpenDate: string | null = null;
  constructor(readonly date: string) {
    super(`لا توجد فترة محاسبية تغطي التاريخ "${date}".`);
    this.messageEn = `No fiscal period covers the date "${date}".`;
    this.name = "NoFiscalPeriodForDateError";
  }
}

export function earliestOpenDayFrom(periods: readonly { readonly status: FiscalPeriodStatus; readonly startDate: string; readonly endDate: string }[], day: string): string | null {
  const open = periods.filter((period) => period.status === "open" && period.endDate >= day).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!open) return null;
  return open.startDate > day ? open.startDate : day;
}

export async function namingEarliestOpenDay<T>(periods: { list?: () => Promise<readonly { readonly status: FiscalPeriodStatus; readonly startDate: string; readonly endDate: string }[]> }, originalDay: string, post: () => Promise<T>): Promise<T> {
  try {
    return await post();
  } catch (err) {
    if ((err instanceof PeriodNotOpenForPostingError || err instanceof NoFiscalPeriodForDateError) && err.earliestOpenDate === null && periods.list) {
      err.earliestOpenDate = earliestOpenDayFrom(await periods.list(), originalDay.slice(0, 10));
    }
    throw err;
  }
}
