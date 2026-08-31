/**
 * The calendar day an instant falls on.
 *
 * WHY THIS EXISTS. Dates in this product come in two shapes: a period boundary
 * is a DAY (`"2026-08-31"`), and a document's `occurredAt` is an INSTANT
 * (`"2026-08-31T03:10:33.016Z"`). Every range check compared them as strings,
 * and string order puts the instant AFTER the day it belongs to — so
 * `"2026-08-31T03:10:33.016Z" <= "2026-08-31"` is false.
 *
 * The consequence was not subtle once you look at it: on the LAST DAY of every
 * month, `findByDate` matched no fiscal period and every GL posting failed with
 * "لا توجد فترة مالية تغطي هذا التاريخ" — on the one day of the month a shop
 * posts most, because that is when it closes. It passed unnoticed because it is
 * invisible on the other thirty days, and the suite happened never to run on a
 * 31st. The VAT twin was worse: `period_to >= ?` did not match either, so a
 * period whose return had already been FILED read as uncovered and the control
 * that refuses a posting into it failed OPEN, silently, on its own last day.
 *
 * Normalising at the comparison is the fix, not widening the boundary: the
 * boundary is correct, the two values were simply not the same kind of thing.
 */

/**
 * Narrows an ISO date or date-time to its `YYYY-MM-DD` calendar day.
 *
 * Anything already day-shaped is returned unchanged, so this is safe to apply
 * to a value that may be either — which is exactly the situation at every
 * range check. A value too short to be a day is returned as-is rather than
 * padded or guessed at: a malformed date must fail its own validation, not be
 * quietly repaired here.
 */
export function calendarDay(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value;
}
