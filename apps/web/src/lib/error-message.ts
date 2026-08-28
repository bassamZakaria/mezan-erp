import { ApiError } from "../data/hooks";

/**
 * What a screen shows when something fails.
 *
 * WHY THIS EXISTS. Thirty-six catch blocks fell back to `String(err)` or to a
 * raw `Error.message`, so a transport failure or a programming slip put English
 * — `TypeError: Failed to fetch`, `[object Object]` — into an Arabic-first UI,
 * on screens that post money.
 *
 * The rule: only an `ApiError` carries text a person should read. The server
 * writes its domain refusals in Arabic precisely so they can be shown verbatim
 * («الفترة مقفلة»، «الكمية تتجاوز المتاح»), and everything else is internal.
 * An internal failure gets the caller's own Arabic fallback instead, which
 * names the operation the screen was attempting.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message.trim() !== "") return err.message;
  return fallback;
}
