import { z } from "zod";

/**
 * The one posting-date-on-the-wire schema.
 *
 * A posting date is a CALENDAR DAY: `postJournalEntry` refuses anything else
 * (`assertEntryDate`), because a fiscal period's boundary is a day and every
 * report filters on a day, and a stored instant sorts after the day it belongs
 * to — so an entry dated `…T…Z` silently falls outside its own month.
 *
 * But clients legitimately send instants: `new Date().toISOString()` is the
 * obvious thing to type, and the offline sync layer carries instants. So the
 * WIRE accepts either shape and the ROUTE narrows an instant to the tenant's
 * calendar day (`toTenantDay`) before the command is built. The conversion
 * cannot live in a `.transform` here, because which day an instant falls on
 * depends on the tenant's timezone and a schema has no access to settings.
 *
 * What is refused is a value that is neither: `"31/08/2026"`, `"2026-8-3"`,
 * `"today"`. Those used to pass a bare `z.string().min(1)` and reach the
 * engine, which answered with its own message about a shape the client never
 * meant to send.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

const MESSAGE = "must be a date (YYYY-MM-DD) or a full ISO-8601 instant";

/** A posting date: a calendar day, or an instant the route resolves to one. */
export const isoDateOrInstant = z
  .string()
  .refine((v) => DAY.test(v) || INSTANT.test(v), MESSAGE)
  .refine((v) => isRealDay(v.slice(0, 10)), MESSAGE);

/** A date that must already be a calendar day — a period boundary, a report filter. */
export const isoDay = z
  .string()
  .regex(DAY, "must be a date (YYYY-MM-DD)")
  .refine(isRealDay, "must be a date (YYYY-MM-DD)");

/**
 * `new Date("2026-02-30")` is not an error in JavaScript — it is the 2nd of
 * March. A shape check alone therefore lets a nonexistent day through and
 * silently posts it into the wrong month.
 */
function isRealDay(day: string): boolean {
  const at = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day;
}

export const ISO_DATE_PATTERNS = { day: DAY, instant: INSTANT } as const;
