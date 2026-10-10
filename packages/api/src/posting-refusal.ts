import type { Context } from "hono";
import { NoFiscalPeriodForDateError, PeriodNotOpenForPostingError } from "@mezan/domain";

/**
 * The posting engine refuses a date in a shut or missing period on every route
 * that posts. One answer for all of them, so the refusal names the month in
 * both languages wherever it surfaces.
 */
export function postingRefusalResponse(c: Context, err: unknown): Response | null {
  if (err instanceof PeriodNotOpenForPostingError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, periodId: err.periodId, status: err.status }, 422);
  }
  if (err instanceof NoFiscalPeriodForDateError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, date: err.date }, 422);
  }
  return null;
}
