/**
 * Weekly-off derivation — "weekend days from settings" (task brief). JS
 * `Date#getUTCDay()` convention: 0=Sunday .. 6=Saturday, matching
 * `TenantSettings.weekendDays` (settings/settings.ts), whose default `[5, 6]`
 * is Friday/Saturday (Egypt's standard weekend).
 */
export function isWeeklyOff(date: string, weekendDays: readonly number[]): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekendDays.includes(day);
}

/** All ISO dates (YYYY-MM-DD) in a given calendar month, in order. */
export function daysInMonth(year: number, month: number): string[] {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: string[] = [];
  for (let d = 1; d <= count; d++) {
    days.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return days;
}
