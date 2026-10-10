import { Hono, type Context } from "hono";
import {
  PERIOD_CLOSE_OVERRIDE_PERMISSION,
  PeriodCloseBlockedError,
  PeriodCloseDecision,
  PeriodCloseOverrideNotPermittedError,
  can,
  decidePeriodClose,
  type FiscalPeriod,
  type FiscalPeriodRepository,
  type PeriodCloseCheckCode,
  type PeriodCloseEvaluation,
  type PeriodCloseSummary,
} from "@mezan/domain";
import {
  periodCloseChecklistSchema,
  periodCloseRefusalSchema,
  periodCloseRequestSchema,
  periodCloseSummarySchema,
  type PeriodCloseChecklistDTO,
  type PeriodCloseRefusalDTO,
  type PeriodCloseSummaryDTO,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

export interface PeriodCloseRecord {
  readonly period: FiscalPeriod;
  readonly evaluation: PeriodCloseEvaluation;
  readonly closedBy: string;
  readonly overrideReason: string | null;
}

export interface PeriodCloseGuard {
  evaluate(period: FiscalPeriod): Promise<PeriodCloseEvaluation>;
  recordClose(record: PeriodCloseRecord): Promise<void>;
  listSummaries(periodId: string): Promise<readonly PeriodCloseSummary[]>;
}

// Keyed by the repository the fiscal-period routes were built on, so the guard an area registers after `createApp` reaches the core close/lock routes without a second mount.
const guards = new WeakMap<FiscalPeriodRepository, PeriodCloseGuard>();

export function registerPeriodCloseGuard(repo: FiscalPeriodRepository, guard: PeriodCloseGuard): void {
  guards.set(repo, guard);
}

export function periodCloseGuardFor(repo: FiscalPeriodRepository): PeriodCloseGuard | undefined {
  return guards.get(repo);
}

export function canOverridePeriodClose(c: Context): boolean {
  const ctx = getAuthContext(c);
  return ctx ? can(ctx, PERIOD_CLOSE_OVERRIDE_PERMISSION) : false;
}

export function serializePeriodCloseChecklist(
  evaluation: PeriodCloseEvaluation,
  period: Pick<FiscalPeriod, "status">,
  canOverride: boolean,
): PeriodCloseChecklistDTO {
  return periodCloseChecklistSchema.parse({
    periodId: evaluation.periodId,
    year: evaluation.year,
    periodNumber: evaluation.periodNumber,
    startDate: evaluation.startDate,
    endDate: evaluation.endDate,
    periodStatus: period.status,
    evaluatedAt: evaluation.evaluatedAt,
    checks: evaluation.checks.map((check) => ({
      code: check.code,
      status: check.status,
      fix: check.fix,
      findings: check.findings.map((f) => ({ ...f, amount: f.amount?.toString() ?? null })),
    })),
    blocking: evaluation.blocking,
    canOverride,
  });
}

function serializeSummary(summary: PeriodCloseSummary): PeriodCloseSummaryDTO {
  return periodCloseSummarySchema.parse({
    id: summary.id,
    periodId: summary.periodId,
    closedBy: summary.closedBy,
    closedAt: summary.closedAt,
    overrideReason: summary.overrideReason,
    failedChecks: summary.failedChecks,
    closingDebit: summary.totals.closingDebit.toString(),
    closingCredit: summary.totals.closingCredit.toString(),
    accountCount: summary.trialBalance.length,
    sha256: summary.sha256,
  });
}

export enum PeriodCloseVerdictKind {
  Proceed = "proceed",
  Refuse = "refuse",
  InvalidRequest = "invalid_request",
}

export type PeriodCloseVerdict =
  | { readonly kind: PeriodCloseVerdictKind.Proceed; readonly evaluation: PeriodCloseEvaluation | null; readonly overriddenChecks: readonly PeriodCloseCheckCode[]; readonly overrideReason: string | null }
  | { readonly kind: PeriodCloseVerdictKind.Refuse; readonly status: 403 | 409; readonly body: PeriodCloseRefusalDTO }
  | { readonly kind: PeriodCloseVerdictKind.InvalidRequest; readonly details: unknown };

async function readOptionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function refusal(
  error: PeriodCloseBlockedError | PeriodCloseOverrideNotPermittedError,
  evaluation: PeriodCloseEvaluation,
  period: FiscalPeriod,
  canOverride: boolean,
): PeriodCloseRefusalDTO {
  return periodCloseRefusalSchema.parse({
    error: error.code,
    message: error.message,
    messageEn: error.messageEn,
    failedChecks: evaluation.blocking,
    checklist: serializePeriodCloseChecklist(evaluation, period, canOverride),
  });
}

/**
 * Decides whether a close or a lock may go ahead. The request contributes one
 * thing only — an optional override reason; the failed checks are recomputed
 * here from posted data on every call.
 *
 * With no guard registered (a bare `createApp` in a unit test) the transition
 * proceeds unchecked; `createBackend` always registers one, and
 * `create-backend.test.ts` pins that it does.
 */
export async function judgePeriodClose(c: Context, repo: FiscalPeriodRepository, period: FiscalPeriod): Promise<PeriodCloseVerdict> {
  const parsed = periodCloseRequestSchema.safeParse(await readOptionalJson(c));
  if (!parsed.success) return { kind: PeriodCloseVerdictKind.InvalidRequest, details: parsed.error.flatten() };
  const guard = periodCloseGuardFor(repo);
  if (!guard) return { kind: PeriodCloseVerdictKind.Proceed, evaluation: null, overriddenChecks: [], overrideReason: null };

  const evaluation = await guard.evaluate(period);
  const overrideReason = parsed.data.overrideReason ?? null;
  const canOverride = canOverridePeriodClose(c);
  const decision = decidePeriodClose({ blocking: evaluation.blocking, overrideReason, canOverride });
  switch (decision) {
    case PeriodCloseDecision.Allowed:
      return { kind: PeriodCloseVerdictKind.Proceed, evaluation, overriddenChecks: [], overrideReason: null };
    case PeriodCloseDecision.Overridden:
      return { kind: PeriodCloseVerdictKind.Proceed, evaluation, overriddenChecks: evaluation.blocking, overrideReason };
    case PeriodCloseDecision.Blocked:
      return {
        kind: PeriodCloseVerdictKind.Refuse,
        status: 409,
        body: refusal(new PeriodCloseBlockedError(period.id, evaluation.blocking), evaluation, period, canOverride),
      };
    case PeriodCloseDecision.OverrideNotPermitted:
      return {
        kind: PeriodCloseVerdictKind.Refuse,
        status: 403,
        body: refusal(new PeriodCloseOverrideNotPermittedError(period.id, evaluation.blocking), evaluation, period, canOverride),
      };
  }
}

export interface PeriodCloseRoutesDeps {
  readonly periods: FiscalPeriodRepository;
  readonly guard: PeriodCloseGuard;
}

export function createPeriodCloseRoutes(deps: PeriodCloseRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/:periodId/checks", gate("accounting.period.view"), async (c) => {
    const period = await deps.periods.findById(c.req.param("periodId"));
    if (!period) return c.json({ error: "NOT_FOUND" }, 404);
    const evaluation = await deps.guard.evaluate(period);
    return c.json(serializePeriodCloseChecklist(evaluation, period, canOverridePeriodClose(c)));
  });

  app.get("/:periodId/summaries", gate("accounting.period.view"), async (c) => {
    const period = await deps.periods.findById(c.req.param("periodId"));
    if (!period) return c.json({ error: "NOT_FOUND" }, 404);
    const summaries = await deps.guard.listSummaries(period.id);
    return c.json(summaries.map(serializeSummary));
  });

  return app;
}
