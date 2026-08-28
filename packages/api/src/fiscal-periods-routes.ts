import { Hono, type Context } from "hono";
import {
  closeFiscalPeriod,
  reopenFiscalPeriod,
  lockFiscalPeriod,
  generateFiscalYear,
  DuplicateFiscalPeriodError,
  FiscalPeriodNotFoundError,
  InvalidPeriodTransitionError,
  type AuditSink,
  type FiscalPeriod,
  type FiscalPeriodRepository,
} from "@mezan/domain";
import { generateFiscalYearSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";

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
  throw err;
}

/**
 * Fiscal period routes (docs/catalog/04 "الفترات المالية"): list (optionally
 * scoped to a year), get one, generate a fiscal year's 12 periods
 * ("إنشاء السنة التالية"), and the three-tier lifecycle actions
 * close/reopen/lock.
 *
 * PERMISSION NOTE: the permission catalog only defines `accounting.period
 * .view`, `.close` [dep:view], and `.reopen` [dep:close] (docs/catalog/09
 * §permission matrix line ~415) — there is no dedicated "lock" permission.
 * Locking is the stricter half of the same "who controls period close-of-
 * books" capability as closing, so the `/lock` route reuses
 * `accounting.period.close` rather than inventing an undocumented code.
 */
export function createFiscalPeriodsRoutes(
  repo: FiscalPeriodRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
  /**
   * Who closed, reopened or locked a period. Reopening a closed period is the
   * move that lets a posted month be changed after the fact, and it left no
   * record at all.
   */
  audit?: AuditSink,
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
      return c.json(periods.map(serialize), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/close", gate("accounting.period.close"), async (c) => {
    try {
      const before = await repo.findById(c.req.param("id"));
      const period = await closeFiscalPeriod(c.req.param("id"), repo);
      await auditPeriod(c, period, "CLOSE", before?.status ?? null);
      return c.json(serialize(period));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

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

  app.post("/:id/lock", gate("accounting.period.close"), async (c) => {
    try {
      const before = await repo.findById(c.req.param("id"));
      const period = await lockFiscalPeriod(c.req.param("id"), repo);
      await auditPeriod(c, period, "LOCK", before?.status ?? null);
      return c.json(serialize(period));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
