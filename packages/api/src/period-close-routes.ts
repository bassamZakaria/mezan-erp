import { Hono, type Context } from "hono";
import {
  PERIOD_CLOSE_OVERRIDE_PERMISSION,
  PeriodCloseChecksUnavailableError,
  can,
  type AuditEvent,
  type FiscalPeriod,
  type FiscalPeriodRepository,
  type PeriodCloseAction,
  type PeriodCloseCheckCode,
  type PeriodCloseEvaluation,
  type PeriodCloseRefusal,
  type PeriodCloseSummary,
} from "@mezan/domain";
import {
  periodCloseChecklistSchema,
  periodCloseErrorSchema,
  periodCloseRefusalSchema,
  periodCloseSummarySchema,
  type PeriodCloseChecklistDTO,
  type PeriodCloseErrorDTO,
  type PeriodCloseRefusalDTO,
  type PeriodCloseSummaryDTO,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { hasModule } from "@mezan/domain";

export interface PeriodCloseAuditInput {
  readonly action: PeriodCloseAction;
  readonly period: FiscalPeriod;
  readonly previousStatus: string;
  readonly failedChecks: readonly PeriodCloseCheckCode[];
  readonly overrideReason: string | null;
  readonly sha256: string | null;
  readonly singleOperatorMode: boolean;
}

export interface PeriodCloseAttempt {
  readonly periodId: string;
  readonly action: PeriodCloseAction;
  readonly overrideReason: string | null;
  readonly canOverride: boolean;
  readonly actor: string;
  readonly wildcardAdmin: boolean;
  readonly scope: PeriodCloseScope;
  readonly buildAuditEvent: (input: PeriodCloseAuditInput) => AuditEvent;
}

export enum PeriodCloseAttemptKind {
  Done = "done",
  Refused = "refused",
}

export type PeriodCloseAttemptResult =
  | { readonly kind: PeriodCloseAttemptKind.Done; readonly period: FiscalPeriod }
  | {
      readonly kind: PeriodCloseAttemptKind.Refused;
      readonly refusal: PeriodCloseRefusal;
      readonly period: FiscalPeriod;
      readonly evaluation: PeriodCloseEvaluation;
    };

export interface SealedPeriodCloseSummary {
  readonly summary: PeriodCloseSummary;
  readonly sealValid: boolean;
}

export interface PeriodCloseScope {
  readonly payrollEntitled: boolean;
}

const PAYROLL_PART = "hr.payroll";

export function periodCloseScopeOf(c: Context): PeriodCloseScope {
  const entitlements = c.get("entitlements");
  return { payrollEntitled: entitlements ? hasModule(entitlements, PAYROLL_PART) : true };
}

export interface PeriodCloseGuard {
  evaluate(period: FiscalPeriod, scope: PeriodCloseScope): Promise<PeriodCloseEvaluation>;
  attempt(attempt: PeriodCloseAttempt): Promise<PeriodCloseAttemptResult>;
  listSummaries(periodId: string): Promise<readonly SealedPeriodCloseSummary[]>;
  lockOverrideNeedsSecondPerson(periodId: string, actor: string, wildcardAdmin: boolean): Promise<boolean>;
}

export type PeriodCloseGuardSource = () => PeriodCloseGuard | null;

export interface PeriodCloseGuardSlot {
  readonly source: PeriodCloseGuardSource;
  register(guard: PeriodCloseGuard): void;
}

export function createPeriodCloseGuardSlot(): PeriodCloseGuardSlot {
  let registered: PeriodCloseGuard | null = null;
  return {
    source: () => registered,
    register(guard) {
      registered = guard;
    },
  };
}

export const NO_PERIOD_CLOSE_GUARD: PeriodCloseGuardSource = () => null;

export function canOverridePeriodClose(c: Context): boolean {
  const ctx = getAuthContext(c);
  return ctx ? can(ctx, PERIOD_CLOSE_OVERRIDE_PERMISSION) : false;
}

export function serializePeriodCloseChecklist(
  evaluation: PeriodCloseEvaluation,
  period: Pick<FiscalPeriod, "status">,
  canOverride: boolean,
  lockOverrideNeedsSecondPerson = false,
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
    lockOverrideNeedsSecondPerson,
  });
}

export function serializePeriodCloseError(error: PeriodCloseRefusal): PeriodCloseErrorDTO {
  return periodCloseErrorSchema.parse({ error: error.code, message: error.message, messageEn: error.messageEn });
}

export function serializePeriodCloseRefusal(
  refusal: PeriodCloseRefusal,
  evaluation: PeriodCloseEvaluation,
  period: FiscalPeriod,
  canOverride: boolean,
): PeriodCloseRefusalDTO {
  return periodCloseRefusalSchema.parse({
    ...serializePeriodCloseError(refusal),
    failedChecks: evaluation.blocking,
    checklist: serializePeriodCloseChecklist(evaluation, period, canOverride),
  });
}

function serializeSummary({ summary, sealValid }: SealedPeriodCloseSummary): PeriodCloseSummaryDTO {
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
    sealValid,
  });
}

export interface PeriodCloseRoutesDeps {
  readonly periods: FiscalPeriodRepository;
  readonly guard: PeriodCloseGuardSource;
}

export function createPeriodCloseRoutes(deps: PeriodCloseRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/:periodId/checks", gate("accounting.period.view"), async (c) => {
    const period = await deps.periods.findById(c.req.param("periodId"));
    if (!period) return c.json({ error: "NOT_FOUND" }, 404);
    const guard = deps.guard();
    if (!guard) return c.json(serializePeriodCloseError(new PeriodCloseChecksUnavailableError(period)), 503);
    const evaluation = await guard.evaluate(period, periodCloseScopeOf(c));
    const auth = getAuthContext(c);
    const needsSecondPerson = period.status === "closed" && evaluation.blocking.length > 0 && auth !== undefined && (await guard.lockOverrideNeedsSecondPerson(period.id, auth.userId, auth.permissions.has("*")));
    return c.json(serializePeriodCloseChecklist(evaluation, period, canOverridePeriodClose(c), needsSecondPerson));
  });

  app.get("/:periodId/summaries", gate("accounting.period.view"), async (c) => {
    const period = await deps.periods.findById(c.req.param("periodId"));
    if (!period) return c.json({ error: "NOT_FOUND" }, 404);
    const guard = deps.guard();
    if (!guard) return c.json(serializePeriodCloseError(new PeriodCloseChecksUnavailableError(period)), 503);
    return c.json((await guard.listSummaries(period.id)).map(serializeSummary));
  });

  return app;
}
