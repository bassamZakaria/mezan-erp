import type { FiscalPeriod, FiscalPeriodRepository } from "./fiscal-period.js";
import { FiscalPeriodNotFoundError } from "./errors.js";
import { reopenPeriod } from "./transitions.js";

// SECURITY: closing and locking are not here — only the close guard applies the checklist, the override rule and the audit row; a bare close moves the status with none of the three (no-bare-close.test.ts).

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
