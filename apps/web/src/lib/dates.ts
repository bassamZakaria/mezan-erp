/**
 * The dates a form or a report opens on.
 *
 * These were hard-coded to a fixed day across nine screens, which is invisible
 * while the demo data sits in the same month and wrong from the first day it
 * does not: a new journal entry defaulted to a date in the past, and the
 * financial statements opened on a period that had already closed.
 *
 * ISO calendar days in LOCAL time, not UTC — `toISOString()` shifts the day
 * backwards for anyone east of Greenwich, which is everyone this product ships
 * to.
 */
function isoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return isoDay(new Date());
}

export function monthStartIso(): string {
  const now = new Date();
  return isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function monthEndIso(): string {
  const now = new Date();
  // Day 0 of the NEXT month is the last day of this one, which is how this
  // avoids a leap-year table.
  return isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

export function yearStartIso(): string {
  return isoDay(new Date(new Date().getFullYear(), 0, 1));
}

export function quarterStartIso(): string {
  const now = new Date();
  return isoDay(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
}
