/**
 * Day/week/month bucketing shared by the period-trend reports (المبيعات حسب
 * الفترة, المشتريات حسب الفترة — docs/archive/catalog/08-reports.md). Dates are plain
 * ISO `YYYY-MM-DD` strings everywhere in this codebase; bucketing them only
 * needs UTC-safe integer date math, not a date library.
 */

export type PeriodGroupBy = "day" | "week" | "month";

function parseIsoDateUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function formatIsoDateUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Monday of the ISO week containing `date`. */
function isoWeekStart(date: Date): Date {
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() + diffToMonday);
  return monday;
}

/** Bucket key for `date` (ISO `YYYY-MM-DD`) — also usable as the row's sort key (lexicographically chronological). */
export function periodBucketKey(date: string, groupBy: PeriodGroupBy): string {
  if (groupBy === "day") return date;
  const parsed = parseIsoDateUtc(date);
  if (groupBy === "month") return date.slice(0, 7); // YYYY-MM
  return formatIsoDateUtc(isoWeekStart(parsed)); // week: keyed by the Monday it starts on
}

/** Whether `date` (ISO) falls within `[from, to]` inclusive, treating a blank bound as unbounded. */
export function withinDateRange(date: string, from: string | undefined, to: string | undefined): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}
