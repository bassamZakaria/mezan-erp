import {
  FiscalPeriodNotFoundError,
  PeriodCloseAction,
  closePeriod,
  lockPeriod,
  type AuditSink,
  type FiscalPeriod,
  type FiscalPeriodRepository,
} from "@mezan/domain";
import { PeriodCloseAttemptKind, type PeriodCloseGuard } from "../period-close-routes.js";

const TRANSITION: Readonly<Record<PeriodCloseAction, (period: FiscalPeriod) => FiscalPeriod>> = {
  [PeriodCloseAction.Close]: closePeriod,
  [PeriodCloseAction.Lock]: lockPeriod,
};

/**
 * TEST-ONLY. Closes and locks with NO pre-close checks, for router tests whose
 * subject is something else (the posting gate, the audit row). `createBackend`
 * never uses it; production routers get the real guard or refuse.
 */
export function uncheckedPeriodCloseGuardForTests(repo: FiscalPeriodRepository, audit?: AuditSink): PeriodCloseGuard {
  return {
    async evaluate(period) {
      return {
        periodId: period.id,
        year: period.year,
        periodNumber: period.periodNumber,
        startDate: period.startDate,
        endDate: period.endDate,
        evaluatedAt: new Date().toISOString(),
        checks: [],
        blocking: [],
      };
    },
    async attempt(attempt) {
      const period = await repo.findById(attempt.periodId);
      if (!period) throw new FiscalPeriodNotFoundError(attempt.periodId);
      const next = TRANSITION[attempt.action](period);
      await repo.update(next);
      await audit?.append(
        attempt.buildAuditEvent({ action: attempt.action, period: next, previousStatus: period.status, failedChecks: [], overrideReason: null, sha256: null, singleOperatorMode: false }),
      );
      return { kind: PeriodCloseAttemptKind.Done, period: next };
    },
    async listSummaries() {
      return [];
    },
  };
}
