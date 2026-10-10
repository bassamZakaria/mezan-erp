import { Hono, type Context } from "hono";
import {
  PeriodCloseAction,
  PeriodCloseChecksUnavailableError,
  PeriodCloseErrorCode,
  PeriodCloseRefusal,
  PeriodCloseUnauditableError,
  reopenFiscalPeriod,
  generateFiscalYear,
  DuplicateFiscalPeriodError,
  FiscalPeriodNotFoundError,
  InvalidPeriodTransitionError,
  type AuditSink,
  type FiscalPeriod,
  type FiscalPeriodRepository,
} from "@mezan/domain";
import { generateFiscalYearSchema, periodCloseRequestSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { buildAdminEvent, recordAdminEvent } from "./admin-audit.js";
import { callerUserId } from "./permission-gate.js";
import {
  PeriodCloseAttemptKind,
  canOverridePeriodClose,
  serializePeriodCloseError,
  serializePeriodCloseRefusal,
  type PeriodCloseGuardSource,
} from "./period-close-routes.js";

enum PeriodAudit {
  Module = "accounting",
  EntityType = "FISCAL_PERIOD",
  Severity = "WARNING",
}

const AUDIT_ACTION: Readonly<Record<PeriodCloseAction, string>> = {
  [PeriodCloseAction.Close]: "CLOSE",
  [PeriodCloseAction.Lock]: "LOCK",
};

const REFUSAL_STATUS: Readonly<Record<PeriodCloseErrorCode, 403 | 409 | 503>> = {
  [PeriodCloseErrorCode.Blocked]: 409,
  [PeriodCloseErrorCode.Contended]: 409,
  [PeriodCloseErrorCode.OverrideNotPermitted]: 403,
  [PeriodCloseErrorCode.LockOverrideSameUser]: 403,
  [PeriodCloseErrorCode.ChecksUnavailable]: 503,
  [PeriodCloseErrorCode.Unauditable]: 503,
};

async function readOptionalJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function serialize(period: FiscalPeriod) {
  return {
    id: period.id,
    year: period.year,
    periodNumber: period.periodNumber,
    startDate: period.startDate,
    endDate: period.endDate,
    status: period.status,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof FiscalPeriodNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateFiscalPeriodError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidPeriodTransitionError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof PeriodCloseRefusal) {
    return c.json(serializePeriodCloseError(err), REFUSAL_STATUS[err.code]);
  }
  throw err;
}

/**
 * Fiscal period routes (docs/archive/catalog/04 "الفترات المالية"): list (optionally
 * scoped to a year), get one, generate a fiscal year's 12 periods
 * ("إنشاء السنة التالية"), and the three-tier lifecycle actions
 * close/reopen/lock.
 *
 * PERMISSION NOTE: the permission catalog only defines `accounting.period
 * .view`, `.close` [dep:view], and `.reopen` [dep:close] (docs/archive/catalog/09
 * §permission matrix line ~415) — there is no dedicated "lock" permission.
 * Locking is the stricter half of the same "who controls period close-of-
 * books" capability as closing, so the `/lock` route reuses
 * `accounting.period.close` rather than inventing an undocumented code.
 */
export function createFiscalPeriodsRoutes(
  repo: FiscalPeriodRepository,
  resolveAuthContext: AuthContextResolver,
  audit: AuditSink | undefined,
  periodCloseGuard: PeriodCloseGuardSource,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  function auditPeriod(c: Context, period: FiscalPeriod, action: string, previousStatus: string | null) {
    return recordAdminEvent(audit, c, {
      module: "accounting",
      entityType: "FISCAL_PERIOD",
      entityId: period.id,
      action,
      details: {
        year: period.year,
        periodNumber: period.periodNumber,
        status: period.status,
        ...(previousStatus ? { previousStatus } : {}),
      },
    });
  }

  app.get("/", gate("accounting.period.view"), async (c) => {
    const year = c.req.query("year");
    const periods = year ? await repo.listByYear(Number(year)) : await repo.list();
    return c.json(periods.map(serialize));
  });

  app.get("/:id", gate("accounting.period.view"), async (c) => {
    const period = await repo.findById(c.req.param("id"));
    if (!period) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(period));
  });

  app.post("/generate-year", gate("accounting.period.close"), async (c) => {
    const parsed = generateFiscalYearSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const periods = await generateFiscalYear(parsed.data.year, repo);
      // The year's twelve periods are what every posting gate reads; creating
      // them was the one lifecycle act here that wrote nothing.
      await recordAdminEvent(audit, c, {
        module: "accounting",
        entityType: "FISCAL_YEAR",
        entityId: String(parsed.data.year),
        action: "GENERATE",
        details: { year: parsed.data.year, periodCount: periods.length },
      });
      return c.json(periods.map(serialize), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  // Close and lock share one guard: a lock is terminal, so it must not be a way around the checks a close refused.
  async function guardedTransition(c: Context, action: PeriodCloseAction) {
    const periodId = c.req.param("id") ?? "";
    try {
      const parsed = periodCloseRequestSchema.safeParse(await readOptionalJson(c));
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      const guard = periodCloseGuard();
      if (!guard) throw new PeriodCloseChecksUnavailableError(periodId);
      if (!audit) throw new PeriodCloseUnauditableError(periodId);

      const canOverride = canOverridePeriodClose(c);
      const result = await guard.attempt({
        periodId,
        action,
        overrideReason: parsed.data.overrideReason ?? null,
        canOverride,
        actor: callerUserId(c) ?? "system",
        buildAuditEvent: (input) =>
          buildAdminEvent(c, {
            module: PeriodAudit.Module,
            entityType: PeriodAudit.EntityType,
            entityId: input.period.id,
            action: AUDIT_ACTION[input.action],
            severity: PeriodAudit.Severity,
            details: {
              year: input.period.year,
              periodNumber: input.period.periodNumber,
              status: input.period.status,
              previousStatus: input.previousStatus,
              overridden: input.overrideReason !== null,
              failedChecks: input.failedChecks,
              reason: input.overrideReason,
              sha256: input.sha256,
            },
          }),
      });
      if (result.kind === PeriodCloseAttemptKind.Refused) {
        return c.json(
          serializePeriodCloseRefusal(result.refusal, result.evaluation, result.period, canOverride),
          REFUSAL_STATUS[result.refusal.code],
        );
      }
      return c.json(serialize(result.period));
    } catch (err) {
      return handleDomainError(c, err);
    }
  }

  app.post("/:id/close", gate("accounting.period.close"), (c) => guardedTransition(c, PeriodCloseAction.Close));

  app.post("/:id/reopen", gate("accounting.period.reopen"), async (c) => {
    try {
      const before = await repo.findById(c.req.param("id"));
      const period = await reopenFiscalPeriod(c.req.param("id"), repo);
      await auditPeriod(c, period, "REOPEN", before?.status ?? null);
      return c.json(serialize(period));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/lock", gate("accounting.period.close"), (c) => guardedTransition(c, PeriodCloseAction.Lock));

  return app;
}
