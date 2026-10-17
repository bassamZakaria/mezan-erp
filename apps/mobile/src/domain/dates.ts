/** Today as a calendar day (`YYYY-MM-DD`) — the shape `isoDateOrInstant`/`isoDay` in @mezan/contracts accept. */
export function todayIso(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** A calendar day offset from another one, carried through `Date`'s own UTC arithmetic (never a money value, so `Number`/`Date` math is fine here). */
export function addDaysIso(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** A server timestamp as the device's own local `YYYY-MM-DD HH:MM`, so "as of" reads in the user's time, not UTC. */
export function formatAsOf(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return instant;
  const two = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}
