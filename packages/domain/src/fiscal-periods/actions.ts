import type { FiscalPeriod, FiscalPeriodRepository } from "./fiscal-period.js";
import { FiscalPeriodNotFoundError } from "./errors.js";
import { closePeriod, lockPeriod, reopenPeriod } from "./transitions.js";

/** Fetches a period by id (or throws {@link FiscalPeriodNotFoundError}), then persists a pure transition's result. */
async function applyTransition(
  periodId: string,
  repo: FiscalPeriodRepository,
  transition: (period: FiscalPeriod) => FiscalPeriod,
): Promise<FiscalPeriod> {
  const current = await repo.findById(periodId);
  if (!current) throw new FiscalPeriodNotFoundError(periodId);
  const next = transition(current);
  await repo.update(next);
  return next;
}

/** إغلاق — closes an open fiscal period (blocks further posting into it). */
export function closeFiscalPeriod(periodId: string, repo: FiscalPeriodRepository): Promise<FiscalPeriod> {
  return applyTransition(periodId, repo, closePeriod);
}

/** إعادة فتح — reopens a closed fiscal period. */
export function reopenFiscalPeriod(periodId: string, repo: FiscalPeriodRepository): Promise<FiscalPeriod> {
  return applyTransition(periodId, repo, reopenPeriod);
}

/** قفل — locks a closed fiscal period. Terminal: a locked period cannot be unlocked. */
export function lockFiscalPeriod(periodId: string, repo: FiscalPeriodRepository): Promise<FiscalPeriod> {
  return applyTransition(periodId, repo, lockPeriod);
}
