import { RecurringJournalFrequency, RecurringJournalTemplateStatus, type RecurringJournalTemplate } from "./types.js";

/** Calendar month index as a plain (year, month 1-12) pair — no `Date` object, so nothing touches a local timezone. */
interface YearMonth {
  readonly year: number;
  readonly month: number;
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymOfDate(dateIso: string): YearMonth {
  const [year, month] = dateIso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1 };
}

/** Months since a fixed epoch — the one place period order becomes a comparable integer. */
function ymIndex(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

function ymFromIndex(index: number): YearMonth {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month };
}

function addMonths(ym: YearMonth, delta: number): YearMonth {
  return ymFromIndex(ymIndex(ym) + delta);
}

/** Months a period spans: 1 for monthly, 3 for quarterly, 12 for yearly. */
function stepMonths(frequency: RecurringJournalFrequency): number {
  switch (frequency) {
    case RecurringJournalFrequency.Monthly:
      return 1;
    case RecurringJournalFrequency.Quarterly:
      return 3;
    case RecurringJournalFrequency.Yearly:
      return 12;
  }
}

/** The first month of the period a given calendar month falls in. */
function periodStartOf(frequency: RecurringJournalFrequency, ym: YearMonth): YearMonth {
  switch (frequency) {
    case RecurringJournalFrequency.Monthly:
      return ym;
    case RecurringJournalFrequency.Quarterly: {
      const quarterIndex = Math.floor((ym.month - 1) / 3);
      return { year: ym.year, month: quarterIndex * 3 + 1 };
    }
    case RecurringJournalFrequency.Yearly:
      return { year: ym.year, month: 1 };
  }
}

/** The period key a period's first month renders as ("YYYY-MM" / "YYYY-Qn" / "YYYY"). */
function periodKeyOfStart(frequency: RecurringJournalFrequency, periodStart: YearMonth): string {
  switch (frequency) {
    case RecurringJournalFrequency.Monthly:
      return `${pad4(periodStart.year)}-${pad2(periodStart.month)}`;
    case RecurringJournalFrequency.Quarterly:
      return `${pad4(periodStart.year)}-Q${Math.floor((periodStart.month - 1) / 3) + 1}`;
    case RecurringJournalFrequency.Yearly:
      return `${pad4(periodStart.year)}`;
  }
}

/** Parse a period key back into its first month — the inverse of `periodKeyOfStart`. */
function periodStartOfKey(frequency: RecurringJournalFrequency, periodKey: string): YearMonth {
  switch (frequency) {
    case RecurringJournalFrequency.Monthly: {
      const [year, month] = periodKey.split("-").map(Number);
      return { year: year ?? 0, month: month ?? 1 };
    }
    case RecurringJournalFrequency.Quarterly: {
      const [yearPart, quarterPart] = periodKey.split("-Q");
      const quarter = Number(quarterPart ?? "1");
      return { year: Number(yearPart ?? "0"), month: (quarter - 1) * 3 + 1 };
    }
    case RecurringJournalFrequency.Yearly:
      return { year: Number(periodKey), month: 1 };
  }
}

/** The period key the given date falls in, for this template's frequency. */
export function periodKeyForDate(frequency: RecurringJournalFrequency, dateIso: string): string {
  return periodKeyOfStart(frequency, periodStartOf(frequency, ymOfDate(dateIso)));
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Plain calendar arithmetic — no `Date` object, so no local timezone enters a pure schedule calculation. */
function daysInMonth(year: number, month: number): number {
  const DAYS = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return DAYS[month - 1] ?? 30;
}

/**
 * The calendar date a template's due entry for `periodKey` is dated —
 * `dayOfPeriod` clamped to the target month's real length, and (for a yearly
 * template) pinned to `yearlyMonth`.
 */
export function journalDateForPeriod(
  template: Pick<RecurringJournalTemplate, "frequency" | "dayOfPeriod" | "yearlyMonth">,
  periodKey: string,
): string {
  const periodStart = periodStartOfKey(template.frequency, periodKey);
  const month = template.frequency === RecurringJournalFrequency.Yearly ? (template.yearlyMonth ?? 1) : periodStart.month;
  const year = periodStart.year;
  const day = Math.min(Math.max(1, template.dayOfPeriod), daysInMonth(year, month));
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** The first calendar day of the period immediately following `periodKey` — where an accrual's auto-reversal is dated. */
export function nextPeriodFirstDate(frequency: RecurringJournalFrequency, periodKey: string): string {
  const start = periodStartOfKey(frequency, periodKey);
  const next = addMonths(start, stepMonths(frequency));
  return `${pad4(next.year)}-${pad2(next.month)}-01`;
}

/**
 * Every period a template is due for, as of `asOfDate`: from the template's
 * start through whichever is earlier of `asOfDate` and `endDate`, restricted
 * to periods whose OWN journal date has actually arrived. A paused template is
 * never due. Callers filter out periods a `RecurringJournalRun` already
 * covers — this function only answers "due", not "not yet generated".
 */
export function duePeriods(
  template: Pick<RecurringJournalTemplate, "frequency" | "dayOfPeriod" | "yearlyMonth" | "startDate" | "endDate" | "status">,
  asOfDate: string,
): string[] {
  if (template.status !== RecurringJournalTemplateStatus.Active) return [];
  if (template.startDate > asOfDate) return [];
  const boundaryDate = template.endDate && template.endDate < asOfDate ? template.endDate : asOfDate;
  const startPeriodStart = periodStartOf(template.frequency, ymOfDate(template.startDate));
  const boundaryPeriodStart = periodStartOf(template.frequency, ymOfDate(boundaryDate));
  const step = stepMonths(template.frequency);
  const periods: string[] = [];
  for (let index = ymIndex(startPeriodStart); index <= ymIndex(boundaryPeriodStart); index += step) {
    const periodStart = ymFromIndex(index);
    const periodKey = periodKeyOfStart(template.frequency, periodStart);
    const journalDate = journalDateForPeriod(template, periodKey);
    if (journalDate > asOfDate) continue;
    if (template.endDate && journalDate > template.endDate) continue;
    periods.push(periodKey);
  }
  return periods;
}
