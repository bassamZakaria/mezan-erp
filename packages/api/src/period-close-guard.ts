import { createHash } from "node:crypto";
import {
  FiscalPeriodNotFoundError,
  PeriodCloseAction,
  PeriodCloseBlockedError,
  PeriodCloseCommitOutcome,
  PeriodCloseContendedError,
  PeriodCloseDecision,
  PeriodCloseOverrideNotPermittedError,
  PeriodCloseUnauditableError,
  PeriodLockOverrideSameUserError,
  canonicalCloseSummary,
  closePeriod,
  decidePeriodClose,
  lockedUnderSingleOperatorWaiver,
  lockPeriod,
  type AuditEvent,
  type AuditSink,
  type FiscalPeriod,
  type FiscalPeriodRepository,
  type PeriodCloseCheckCode,
  type PeriodCloseDecisionInput,
  type PeriodCloseEvaluation,
  type PeriodCloseRefusal,
  type PeriodCloseSummary,
  type UnsignedPeriodCloseSummary,
} from "@mezan/domain";
import {
  PeriodCloseAttemptKind,
  type PeriodCloseAttempt,
  type PeriodCloseAttemptResult,
  type PeriodCloseGuard,
  type SealedPeriodCloseSummary,
} from "./period-close-routes.js";

const TRANSITION: Readonly<Record<PeriodCloseAction, (period: FiscalPeriod) => FiscalPeriod>> = {
  [PeriodCloseAction.Close]: closePeriod,
  [PeriodCloseAction.Lock]: lockPeriod,
};

const MAX_ATTEMPTS = 3;

export function sealPeriodCloseSummary(summary: UnsignedPeriodCloseSummary): string {
  return createHash("sha256").update(canonicalCloseSummary(summary)).digest("hex");
}

// Two things must both hold: the row still hashes to its own seal, and that seal is the one the HMAC-chained audit trail recorded at the close.
export function verifyPeriodCloseSeal(summary: PeriodCloseSummary, auditedSeals: ReadonlySet<string>): boolean {
  const { sha256, ...unsigned } = summary;
  return sealPeriodCloseSummary(unsigned) === sha256 && auditedSeals.has(sha256);
}

export interface PeriodCloseSummaryInput {
  readonly period: FiscalPeriod;
  readonly evaluation: PeriodCloseEvaluation;
  readonly closedBy: string;
  readonly overrideReason: string | null;
}

export interface PeriodCloseCommitRequest {
  readonly changeToken: number;
  readonly periodId: string;
  readonly fromStatus: string;
  readonly toStatus: string;
  readonly summary: PeriodCloseSummary | null;
  readonly auditEvent: AuditEvent;
}

export interface PeriodCloseGuardDeps {
  readonly periods: Pick<FiscalPeriodRepository, "findById">;
  readonly evaluate: (period: FiscalPeriod) => Promise<PeriodCloseEvaluation>;
  readonly buildSummary: (input: PeriodCloseSummaryInput) => Promise<PeriodCloseSummary>;
  readonly lastClosedBy: (periodId: string) => Promise<string | null>;
  readonly singleOperatorMode: () => Promise<boolean>;
  readonly listSummaries: (periodId: string) => Promise<readonly SealedPeriodCloseSummary[]>;
  readonly changeToken: () => number;
  /** Null when the audit sink cannot write inside the commit's transaction; nothing is then closed or locked. */
  readonly commit: ((request: PeriodCloseCommitRequest) => PeriodCloseCommitOutcome) | null;
}

function refusalFor(decision: PeriodCloseDecision, period: FiscalPeriod, blocking: readonly PeriodCloseCheckCode[]): PeriodCloseRefusal | null {
  switch (decision) {
    case PeriodCloseDecision.Allowed:
    case PeriodCloseDecision.Overridden:
      return null;
    case PeriodCloseDecision.Blocked:
      return new PeriodCloseBlockedError(period, blocking);
    case PeriodCloseDecision.OverrideNotPermitted:
      return new PeriodCloseOverrideNotPermittedError(period, blocking);
    case PeriodCloseDecision.LockOverrideNeedsSecondPerson:
      return new PeriodLockOverrideSameUserError(period, blocking);
  }
}

export function createPeriodCloseGuard(deps: PeriodCloseGuardDeps): PeriodCloseGuard {
  async function attemptOnce(attempt: PeriodCloseAttempt, commit: NonNullable<PeriodCloseGuardDeps["commit"]>): Promise<PeriodCloseAttemptResult | null> {
    const changeToken = deps.changeToken();
    const period = await deps.periods.findById(attempt.periodId);
    if (!period) throw new FiscalPeriodNotFoundError(attempt.periodId);
    const next = TRANSITION[attempt.action](period);

    const evaluation = await deps.evaluate(period);
    const overridable = evaluation.blocking.length > 0 && attempt.overrideReason !== null && attempt.canOverride;
    const lockOverride = overridable && attempt.action === PeriodCloseAction.Lock;
    const decisionInput: PeriodCloseDecisionInput = {
      action: attempt.action,
      blocking: evaluation.blocking,
      overrideReason: attempt.overrideReason,
      canOverride: attempt.canOverride,
      actor: attempt.actor,
      closedBy: lockOverride ? await deps.lastClosedBy(period.id) : null,
      singleOperatorMode: lockOverride ? await deps.singleOperatorMode() : false,
      wildcardAdmin: attempt.wildcardAdmin,
    };
    const decision = decidePeriodClose(decisionInput);
    const refusal = refusalFor(decision, period, evaluation.blocking);
    if (refusal) return { kind: PeriodCloseAttemptKind.Refused, refusal, period, evaluation };

    const overrideReason = decision === PeriodCloseDecision.Overridden ? attempt.overrideReason : null;
    const summary =
      attempt.action === PeriodCloseAction.Close ? await deps.buildSummary({ period: next, evaluation, closedBy: attempt.actor, overrideReason }) : null;
    const auditEvent = attempt.buildAuditEvent({
      action: attempt.action,
      period: next,
      previousStatus: period.status,
      failedChecks: overrideReason === null ? [] : evaluation.blocking,
      overrideReason,
      sha256: summary?.sha256 ?? null,
      singleOperatorMode: lockedUnderSingleOperatorWaiver(decisionInput),
    });
    const outcome = commit({ changeToken, periodId: period.id, fromStatus: period.status, toStatus: next.status, summary, auditEvent });
    return outcome === PeriodCloseCommitOutcome.Committed ? { kind: PeriodCloseAttemptKind.Done, period: next } : null;
  }

  return {
    evaluate: deps.evaluate,
    listSummaries: deps.listSummaries,
    async attempt(attempt) {
      const { commit } = deps;
      const requested = await deps.periods.findById(attempt.periodId);
      if (!requested) throw new FiscalPeriodNotFoundError(attempt.periodId);
      if (!commit) throw new PeriodCloseUnauditableError(requested);
      for (let tries = 0; tries < MAX_ATTEMPTS; tries += 1) {
        const result = await attemptOnce(attempt, commit);
        if (result) return result;
      }
      throw new PeriodCloseContendedError(requested);
    },
  };
}

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
