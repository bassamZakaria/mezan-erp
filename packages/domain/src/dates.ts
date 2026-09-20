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

/**
 * The default tenant timezone. Egypt is the product's home market, and Cairo
 * observes DST again since 2023, so the offset is +02:00 or +03:00 depending
 * on the date — which is exactly why the conversion below goes through `Intl`
 * rather than a fixed offset.
 */
export const DEFAULT_TIME_ZONE = "Africa/Cairo";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * The calendar day an ISO value falls on IN THE TENANT'S OWN TIMEZONE.
 *
 * A day-shaped value is already a day and is returned untouched. An instant is
 * resolved through the tenant zone, so `2026-09-30T23:59:59Z` is the 1st of
 * October for an Egyptian shop — because it is. `calendarDay` slices in UTC
 * and is therefore the wrong tool at a wire boundary; use it only where the
 * two sides of a comparison are already known to share a zone.
 *
 * A value that is neither shape, or a timezone the platform does not know, is
 * returned narrowed in UTC rather than thrown on: the caller's own validation
 * owns the rejection, and a typo in one settings field must not make every
 * posting in the system impossible.
 */
export function toTenantDay(value: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  if (DAY.test(value)) return value;
  if (!INSTANT.test(value)) return calendarDay(value);
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return calendarDay(value);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return calendarDay(value);
  }
}

/**
 * The tenant's calendar day RIGHT NOW — the only honest default for "today".
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day, so between midnight
 * and 02:00/03:00 Cairo it answers yesterday: a certificate measured today
 * would be refused as dated in the future, a payroll run would take the wrong
 * as-of day, a promotion would still read as scheduled (D285, D287, D288).
 *
 * A route that can reach the request should read the tenant's OWN configured
 * zone (`tenantToday` in the API package); this is what a service constructed
 * once, outside any request, can honestly know.
 */
export function tenantTodayIso(timeZone: string = DEFAULT_TIME_ZONE): string {
  return toTenantDay(new Date().toISOString(), timeZone);
}
