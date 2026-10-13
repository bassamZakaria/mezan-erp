// LOCAL calendar day, as apps/web/src/lib/dates.ts computes it: `toISOString()` is UTC and names yesterday between midnight and 03:00 in Cairo.
export function localTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
