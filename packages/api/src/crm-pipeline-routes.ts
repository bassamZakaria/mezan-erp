import { Hono } from "hono";
import {
  OPPORTUNITY_LOST_REASON_DEFINITIONS,
  buildWeightedForecast,
  computeQuoteTotals,
  type ForecastFigures,
  type ForecastOwnerRow,
  type OpportunityRepository,
  type SalesQuoteRepository,
} from "@mezan/domain";
import { crmForecastQuerySchema } from "@mezan/contracts";
import {
  callerUserId,
  createAnyPermissionGate,
  createPermissionGate,
  branchScopeOf,
  withinScope,
  type AuthContextResolver,
} from "./permission-gate.js";
import {
  mayAssignOpportunities,
  OPPORTUNITY_VIEW_ALL,
  OPPORTUNITY_VIEW_OWN,
  seesEveryOpportunity,
  visibleOpportunities,
  type CrmOwnerDirectory,
} from "./crm-visibility.js";

export enum ForecastScope {
  All = "all",
  Own = "own",
}

export interface CrmReminderRunner {
  run(): Promise<{ readonly today: string; readonly notified: number }>;
}

export interface CrmPipelineRoutesDeps {
  readonly opportunities: Pick<OpportunityRepository, "list" | "findById">;
  readonly quotes: Pick<SalesQuoteRepository, "list">;
  readonly owners: CrmOwnerDirectory;
  readonly reminders: CrmReminderRunner;
}

function serializeFigures(figures: ForecastFigures) {
  return { count: figures.count, amount: figures.amount.toString(), weighted: figures.weighted.toString() };
}

function serializeOwnerRow(row: ForecastOwnerRow) {
  return { ownerUserId: row.ownerUserId, ...serializeFigures(row) };
}

/**
 * CRM pipeline insight routes (ENH-E3-06), mounted under `/crm-pipeline`: the
 * lost-reason list, the weighted forecast, the people a deal may be assigned
 * to, the quotes raised for a deal, and the activity-due reminder run. Every
 * read narrows through {@link visibleOpportunities}, so a rep's forecast is
 * built from exactly the deals their board shows.
 */
export function createCrmPipelineRoutes(deps: CrmPipelineRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);

  app.get("/lost-reasons", gateAny(OPPORTUNITY_VIEW_ALL, OPPORTUNITY_VIEW_OWN), (c) =>
    c.json(OPPORTUNITY_LOST_REASON_DEFINITIONS.map((d) => ({ code: d.code, labelAr: d.labelAr, labelEn: d.labelEn }))),
  );

  app.get("/owners", gateAny(OPPORTUNITY_VIEW_ALL, OPPORTUNITY_VIEW_OWN), async (c) => {
    const everyone = await deps.owners.list();
    if (mayAssignOpportunities(c) || seesEveryOpportunity(c)) return c.json(everyone);
    const me = callerUserId(c);
    return c.json(everyone.filter((owner) => owner.id === me));
  });

  app.get("/forecast", gateAny(OPPORTUNITY_VIEW_ALL, OPPORTUNITY_VIEW_OWN), async (c) => {
    const parsed = crmForecastQuerySchema.safeParse({
      branchId: c.req.query("branchId") || undefined,
      ownerUserId: c.req.query("ownerUserId") || undefined,
    });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    let rows = visibleOpportunities(c, await deps.opportunities.list());
    if (parsed.data.branchId) rows = rows.filter((o) => o.branchId === parsed.data.branchId);
    if (parsed.data.ownerUserId) rows = rows.filter((o) => o.ownerUserId === parsed.data.ownerUserId);
    const forecast = buildWeightedForecast(rows);
    return c.json({
      months: forecast.months.map((m) => ({ month: m.month, ...serializeFigures(m), owners: m.owners.map(serializeOwnerRow) })),
      owners: forecast.owners.map(serializeOwnerRow),
      total: serializeFigures(forecast.total),
      scope: seesEveryOpportunity(c) ? ForecastScope.All : ForecastScope.Own,
    });
  });

  app.get("/opportunities/:id/quotes", gateAny("sales.quote.view", "sales.quote.view_own"), async (c) => {
    const opportunity = await deps.opportunities.findById(c.req.param("id"));
    if (!opportunity || visibleOpportunities(c, [opportunity]).length === 0) return c.json({ error: "OPPORTUNITY_NOT_FOUND" }, 404);
    const quotes = withinScope(await deps.quotes.list({ opportunityId: opportunity.id }), branchScopeOf(c), (q) => q.branchId);
    return c.json(
      quotes.map((q) => ({
        id: q.id,
        docNo: q.docNo,
        status: q.status,
        date: q.date,
        expiryDate: q.expiryDate,
        total: computeQuoteTotals(q.lines, q.discount, { taxExempt: q.customerTaxExempt }).grandTotal.toString(),
      })),
    );
  });

  app.post("/reminders/run", gate("crm.activity.edit"), async (c) => c.json(await deps.reminders.run()));

  return app;
}
