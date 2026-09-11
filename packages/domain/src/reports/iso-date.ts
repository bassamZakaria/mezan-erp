import { z } from "zod";

/**
 * A report date parameter, validated as a REAL CALENDAR DATE (D98).
 *
 * Every report declared its dates as `/^\d{4}-\d{2}-\d{2}$/`, which is a shape
 * and not a date: `2026-13-45` passed, matched nothing, and rendered as "no
 * sales in that range" rather than "that is not a date". A reader cannot tell
 * those two answers apart, and the wrong one is the one that gets believed.
 *
 * The check is done on the string's own digits rather than through `Date`,
 * because `new Date("2026-02-30")` silently rolls forward to 2 March and would
 * accept exactly the input this exists to refuse.
 */
const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** True when `value` is a real day on the Gregorian calendar. */
export function isRealIsoDate(value: string): boolean {
  const match = SHAPE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1]!;
  return day >= 1 && day <= maxDay;
}

/** The one date schema every report parameter uses. */
export const isoDateParamSchema = z.string().refine(isRealIsoDate, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");
