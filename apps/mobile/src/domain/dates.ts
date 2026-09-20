/** Today as a calendar day (`YYYY-MM-DD`) — the shape `isoDateOrInstant`/`isoDay` in @mezan/contracts accept. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A calendar day offset from another one, carried through `Date`'s own UTC arithmetic (never a money value, so `Number`/`Date` math is fine here). */
export function addDaysIso(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
