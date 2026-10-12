import type { Context } from "hono";
import { NoFiscalPeriodForDateError, PeriodNotOpenForPostingError, StockMovementBeforeLandedCostError, StockPlanDateRequiredError, VatPeriodAlreadyFiledError } from "@mezan/domain";

export function postingRefusalResponse(c: Context, err: unknown): Response | null {
  if (err instanceof PeriodNotOpenForPostingError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, periodId: err.periodId, status: err.status }, 422);
  }
  if (err instanceof NoFiscalPeriodForDateError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, date: err.date }, 422);
  }
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, filingId: err.filingId, date: err.date }, 422);
  }
  if (err instanceof StockMovementBeforeLandedCostError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, earliestAllowedDate: err.earliestAllowedDate }, 422);
  }
  if (err instanceof StockPlanDateRequiredError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  return null;
}
