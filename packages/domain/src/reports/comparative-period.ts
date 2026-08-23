/**
 * The comparison window for a period report. Dates are plain ISO `YYYY-MM-DD`
 * strings everywhere in this codebase, so this is UTC-safe integer date math
 * rather than a date library.
 */

export type ComparisonMode = "previous" | "lastYear";

export interface ClosedDateRange {
  readonly from: string;
  readonly to: string;
}

function parseUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function formatUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDays(date: string, days: number): string {
  const d = parseUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUtc(d);
}

const DAY_MS = 86_400_000;

function inclusiveDayCount(from: string, to: string): number {
  return Math.round((parseUtc(to).getTime() - parseUtc(from).getTime()) / DAY_MS) + 1;
}

function sameDatesLastYear(date: string): string {
  const d = parseUtc(date);
  const year = d.getUTCFullYear() - 1;
  const month = d.getUTCMonth();
  // 29 Feb has no counterpart in a common year; clamp to that month's last day
  // rather than rolling into March, which would silently widen the window.
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatUtc(new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDayOfMonth))));
}

export const COMPARISON_LABEL_AR: Record<ComparisonMode, string> = {
  previous: "الفترة السابقة",
  lastYear: "نفس الفترة من العام الماضي",
};

/**
 * `previous` is the equal-length window ending the day before the current one,
 * so a 30-day period compares against the 30 days before it — not against the
 * previous calendar month, which would be a different length.
 */
export function comparativeRange(current: ClosedDateRange, mode: ComparisonMode): ClosedDateRange {
  if (mode === "lastYear") {
    return { from: sameDatesLastYear(current.from), to: sameDatesLastYear(current.to) };
  }
  const to = shiftDays(current.from, -1);
  return { from: shiftDays(to, -(inclusiveDayCount(current.from, current.to) - 1)), to };
}
