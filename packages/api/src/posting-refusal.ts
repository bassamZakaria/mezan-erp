import type { Context, MiddlewareHandler } from "hono";
import { AllocationExceedsError, DocumentChangedError, earliestOpenDayFrom, type FiscalPeriodRepository, NoFiscalPeriodForDateError, PeriodNotOpenForPostingError, StockMovementBeforeRevaluationError, StockPlanDateRequiredError, VatPeriodAlreadyFiledError } from "@mezan/domain";

type ReversalDayEnv = { Variables: { listFiscalPeriods?: () => Promise<readonly { status: "open" | "closed" | "locked"; startDate: string; endDate: string }[]>; reversalEarliestOpenDay?: string | null } };

export function fiscalPeriodsMiddleware(periods?: Pick<FiscalPeriodRepository, "list">): MiddlewareHandler {
  return async (c, next) => {
    if (periods) (c as unknown as Context<ReversalDayEnv>).set("listFiscalPeriods", () => periods.list());
    await next();
  };
}

/** INVARIANT: called by a reversal route whose first refusal can come from the stock ledger's period gate, which does not know the original's day; the journal's own gate names the day itself (reversal-paths/registry-dates.test.ts). */
export async function noteReversalOriginalDay(c: Context, originalDay: string | null | undefined): Promise<void> {
  const env = c as unknown as Context<ReversalDayEnv>;
  const list = env.get("listFiscalPeriods");
  if (!list || !originalDay) return;
  env.set("reversalEarliestOpenDay", earliestOpenDayFrom(await list(), originalDay.slice(0, 10)));
}

const ALLOCATION_EXCEEDS_EN = "The amount is more than what is still open on the invoice or unallocated on the voucher.";

/** INVARIANT: the ONE mapping of the refusals any posting route can meet; no route maps a filed VAT month, a moved document or an over-allocation for itself, and the app's last net asks here too (`posting-refusal.structure.test.ts`). */
export function postingRefusalResponse(c: Context, err: unknown): Response | null {
  if ((err instanceof PeriodNotOpenForPostingError || err instanceof NoFiscalPeriodForDateError) && err.earliestOpenDate === null) {
    err.earliestOpenDate = (c as unknown as Context<ReversalDayEnv>).get("reversalEarliestOpenDay") ?? null;
  }
  if (err instanceof PeriodNotOpenForPostingError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, periodId: err.periodId, status: err.status, ...(err.earliestOpenDate ? { earliestOpenDate: err.earliestOpenDate } : {}) }, 422);
  }
  if (err instanceof NoFiscalPeriodForDateError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, date: err.date, ...(err.earliestOpenDate ? { earliestOpenDate: err.earliestOpenDate } : {}) }, 422);
  }
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, filingId: err.filingId, date: err.date }, 422);
  }
  if (err instanceof DocumentChangedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof AllocationExceedsError) {
    return c.json({ error: err.code, message: err.message, messageEn: ALLOCATION_EXCEEDS_EN }, 422);
  }
  if (err instanceof StockMovementBeforeRevaluationError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, earliestAllowedDate: err.earliestAllowedDate }, 422);
  }
  if (err instanceof StockPlanDateRequiredError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  return null;
}
