import type { FiscalPeriod, FiscalPeriodRepository } from "./fiscal-period.js";
import { FiscalPeriodNotFoundError } from "./errors.js";
import { reopenPeriod } from "./transitions.js";

/**
 * Closing and locking are NOT here: both must pass the period-close checklist,
 * its override rule and its audit row, which only the close guard applies. A
 * bare `closeFiscalPeriod(id, repo)` moved the status with none of the three.
 */

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

/** إعادة فتح — reopens a closed fiscal period. */
export function reopenFiscalPeriod(periodId: string, repo: FiscalPeriodRepository): Promise<FiscalPeriod> {
  return applyTransition(periodId, repo, reopenPeriod);
}
