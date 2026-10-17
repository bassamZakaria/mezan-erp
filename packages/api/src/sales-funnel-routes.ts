import { Hono, type Context } from "hono";
import {
  DEFAULT_TIME_ZONE,
  FUNNEL_STAGE_LABELS,
  FUNNEL_STAGE_ORDER,
  FunnelStage,
  Money,
  UNASSIGNED_SALESPERSON_KEY,
  buildFunnelCohort,
  can,
  collectRepActivity,
  createRepLeaderboardReport,
  createSalesFunnelReport,
  createStageAgingReport,
  invoiceBaseGrandTotal,
  isTerminalStage,
  openDealsInStage,
  repConversionRate,
  repFigures,
  runReport,
  toTenantDay,
  type OpportunityRepository,
  type OpportunityStageHistorySource,
  type PipelineStageRepository,
  type RepDirectoryEntry,
  type RunReportOutcome,
  type SalesInvoiceRepository,
  type SalesQuoteRepository,
  type SettingsRepository,
  type UserRepository,
} from "@mezan/domain";
import { LEADERBOARD_CARD_LIMIT, leaderboardCardQuerySchema, type LeaderboardCardDTO } from "@mezan/contracts";
import { branchScopeOf, createPermissionGate, getAuthContext, callerUserId, withinScope, type AuthContextResolver } from "./permission-gate.js";
import { seesEveryOpportunity, visibleOpportunities } from "./crm-visibility.js";
import { tenantToday } from "./tenant-day.js";

export const FUNNEL_VIEW_PERMISSION = "crm.funnel.view";
const VIEW_COST_PERMISSION = "sales.invoice.view_cost";
const DRILL_DOWN_LIMIT = 25;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

enum DrillDocType {
  SalesInvoice = "SALES_INVOICE",
  SalesQuote = "SALES_QUOTE",
  Opportunity = "CRM_OPPORTUNITY",
}

interface DrillDocument {
  readonly id: string;
  readonly docNo: string;
  readonly date: string;
  readonly type: DrillDocType;
  readonly status: string;
  readonly amount: string;
}

export interface SalesFunnelRoutesDeps {
  readonly opportunities: Pick<OpportunityRepository, "list">;
  readonly stageHistory: OpportunityStageHistorySource;
  readonly pipelineStages: Pick<PipelineStageRepository, "list">;
  readonly quotes: Pick<SalesQuoteRepository, "list">;
  readonly salesInvoices: Pick<SalesInvoiceRepository, "list">;
  readonly users: Pick<UserRepository, "list" | "findById">;
  readonly settings?: Pick<SettingsRepository, "get">;
  readonly today?: () => string;
}

function respond(c: Context, outcome: RunReportOutcome<unknown, unknown>): Response {
  if (!outcome.ok) return c.json({ error: "VALIDATION_ERROR", errors: outcome.errors }, 400);
  return c.json({
    params: outcome.params,
    rows: outcome.rows,
    groups: outcome.groups,
    grandTotals: outcome.grandTotals,
    reconciliation: outcome.reconciliation,
    kpis: outcome.kpis,
  });
}

function queryParams(c: Context): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(c.req.url).searchParams) out[key] = value;
  return out;
}

function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function twoPlaces(money: Money): string {
  return money.toString();
}

/**
 * Sales funnel and rep leaderboard (ENH-E3-07), mounted under `/sales-funnel`.
 * Reads only. Which deals a caller sees is decided by `visibleOpportunities`;
 * a caller without `crm.opportunity.view` is further cut to the invoices their
 * own employee file raised. SECURITY: cost and margin leave the server only for
 * a caller holding `sales.invoice.view_cost` — the column is absent from the
 * report definition, the rows and the export, not hidden by the client.
 */
export function createSalesFunnelRoutes(deps: SalesFunnelRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  const mayViewCost = (c: Context): boolean => {
    const ctx = getAuthContext(c);
    return ctx ? can(ctx, VIEW_COST_PERMISSION) : false;
  };

  const timeZone = async (): Promise<string> => (await deps.settings?.get())?.timezone || DEFAULT_TIME_ZONE;

  const visibleDeals = async (c: Context) => visibleOpportunities(c, await deps.opportunities.list());

  const scopedQuotes = async (c: Context) => withinScope(await deps.quotes.list(), branchScopeOf(c), (q) => q.branchId);

  const scopedInvoices = async (c: Context) => withinScope(await deps.salesInvoices.list(), branchScopeOf(c), (i) => i.branchId);

  const repView = async (c: Context): Promise<{ readonly reps: readonly RepDirectoryEntry[]; readonly invoices: Awaited<ReturnType<typeof scopedInvoices>> }> => {
    const invoices = await scopedInvoices(c);
    const users = await deps.users.list();
    const directory = users.map((u) => ({ id: u.id, nameAr: u.nameAr, nameEn: u.nameEn, employeeId: u.employeeId }));
    if (seesEveryOpportunity(c)) return { reps: directory, invoices };
    const me = callerUserId(c);
    const self = directory.filter((u) => u.id === me);
    const employeeId = self[0]?.employeeId ?? null;
    return { reps: self, invoices: employeeId === null ? [] : invoices.filter((i) => i.salespersonId === employeeId) };
  };

  app.get("/funnel", gate(FUNNEL_VIEW_PERMISSION), async (c) => {
    const today = await tenantToday(c, deps.today);
    const definition = createSalesFunnelReport(firstOfMonth(today), today);
    const [opportunities, quotes, invoices, zone] = await Promise.all([visibleDeals(c), scopedQuotes(c), scopedInvoices(c), timeZone()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { opportunities, quotes, invoices, timeZone: zone }));
  });

  app.get("/stage-aging", gate(FUNNEL_VIEW_PERMISSION), async (c) => {
    const today = await tenantToday(c, deps.today);
    const definition = createStageAgingReport();
    const [opportunities, stages, entries] = await Promise.all([visibleDeals(c), deps.pipelineStages.list(), deps.stageHistory.entries()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { opportunities, stages, entries, asOf: `${today}T23:59:59.999Z` }));
  });

  app.get("/rep-leaderboard", gate(FUNNEL_VIEW_PERMISSION), async (c) => {
    const today = await tenantToday(c, deps.today);
    const definition = createRepLeaderboardReport(firstOfMonth(today), today, { withCost: mayViewCost(c) });
    const [opportunities, view, zone] = await Promise.all([visibleDeals(c), repView(c), timeZone()]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { opportunities, invoices: view.invoices, reps: view.reps, timeZone: zone }));
  });

  app.get("/leaderboard-card", gate(FUNNEL_VIEW_PERMISSION), async (c) => {
    const parsed = leaderboardCardQuerySchema.safeParse(queryParams(c));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const today = await tenantToday(c, deps.today);
    const params = { dateFrom: parsed.data.dateFrom ?? firstOfMonth(today), dateTo: parsed.data.dateTo ?? today, branchId: parsed.data.branchId ?? "" };
    const withCost = mayViewCost(c);
    const [opportunities, view, zone] = await Promise.all([visibleDeals(c), repView(c), timeZone()]);
    const activities = [...collectRepActivity(params, { opportunities, invoices: view.invoices, reps: view.reps, timeZone: zone }).values()];
    const figures = activities.map((activity) => ({ activity, ...repFigures(activity, withCost) }));
    const totalRevenue = Money.sum(figures.map((f) => f.revenue));
    const ranked = figures
      .filter((f) => f.activity.repId !== UNASSIGNED_SALESPERSON_KEY)
      .sort((a, b) => (a.revenue.scaled === b.revenue.scaled ? 0 : a.revenue.scaled > b.revenue.scaled ? -1 : 1))
      .slice(0, LEADERBOARD_CARD_LIMIT);
    const body: LeaderboardCardDTO = {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      totalRevenue: twoPlaces(totalRevenue),
      entries: ranked.map((f, index) => ({
        rank: index + 1,
        repId: f.activity.repId,
        nameAr: f.activity.nameAr,
        nameEn: f.activity.nameEn,
        invoiceCount: f.activity.invoices.length,
        revenue: twoPlaces(f.revenue),
        ...(withCost ? { grossMargin: twoPlaces(f.revenue.add(f.cost.negate())) } : {}),
        conversionRate: repConversionRate(f.activity),
        collected: twoPlaces(f.collected),
      })),
    };
    return c.json(body);
  });

  const drillWindow = async (c: Context) => {
    const today = await tenantToday(c, deps.today);
    const from = c.req.query("fromDate");
    const to = c.req.query("asOfDate");
    return {
      dateFrom: from && ISO_DAY.test(from) ? from : firstOfMonth(today),
      dateTo: to && ISO_DAY.test(to) ? to : today,
      branchId: c.req.query("branchId") ?? "",
      ownerUserId: c.req.query("ownerUserId") ?? "",
    };
  };

  const windowFacts = (window: { dateFrom: string; dateTo: string }) => [
    { key: "fromDate", labelAr: "من تاريخ", value: window.dateFrom, format: "date" as const },
    { key: "asOfDate", labelAr: "حتى تاريخ", value: window.dateTo, format: "date" as const },
  ];

  app.get("/drill-down/rep/:id", gate(FUNNEL_VIEW_PERMISSION), async (c) => {
    const id = c.req.param("id");
    const window = await drillWindow(c);
    const [opportunities, view, zone] = await Promise.all([visibleDeals(c), repView(c), timeZone()]);
    const activity = collectRepActivity(window, { opportunities, invoices: view.invoices, reps: view.reps, timeZone: zone }).get(id);
    if (!activity) return c.json({ error: "NOT_FOUND" }, 404);
    const withCost = mayViewCost(c);
    const figures = repFigures(activity, withCost);
    const invoices = [...activity.invoices].sort((a, b) => b.date.localeCompare(a.date));
    return c.json({
      kind: "rep",
      id,
      titleAr: activity.nameAr,
      subtitleAr: null,
      facts: [
        ...windowFacts(window),
        { key: "revenue", labelAr: "الإيراد", value: twoPlaces(figures.revenue), format: "money" },
        ...(withCost ? [{ key: "grossMargin", labelAr: "هامش الربح", value: twoPlaces(figures.revenue.add(figures.cost.negate())), format: "money" as const }] : []),
        { key: "collected", labelAr: "المحصّل", value: twoPlaces(figures.collected), format: "money" },
      ],
      documents: invoices.slice(0, DRILL_DOWN_LIMIT).map((invoice) => ({
        id: invoice.id,
        docNo: invoice.docNo ?? invoice.id,
        date: invoice.date,
        type: DrillDocType.SalesInvoice,
        status: invoice.status,
        amount: twoPlaces(invoiceBaseGrandTotal(invoice)),
        amountFormat: "money",
      })),
      documentCount: invoices.length,
    });
  });

  app.get("/drill-down/funnel-stage/:id", gate(FUNNEL_VIEW_PERMISSION), async (c) => {
    const stage = FUNNEL_STAGE_ORDER.find((s) => s === c.req.param("id"));
    if (stage === undefined) return c.json({ error: "NOT_FOUND" }, 404);
    const window = await drillWindow(c);
    const [opportunities, quotes, invoices, zone] = await Promise.all([visibleDeals(c), scopedQuotes(c), scopedInvoices(c), timeZone()]);
    const members = buildFunnelCohort(window, { opportunities, quotes, invoices, timeZone: zone })[stage];
    const total = Money.sum(members.map((m) => m.value));
    const documents = members.flatMap((m): DrillDocument[] => {
      if (stage === FunnelStage.Opportunity) {
        return [{ id: m.opportunity.id, docNo: m.opportunity.title, date: toTenantDay(m.opportunity.createdAt, zone), type: DrillDocType.Opportunity, status: m.opportunity.status, amount: twoPlaces(m.value) }];
      }
      if (stage === FunnelStage.Quoted || stage === FunnelStage.Accepted) {
        const q = m.quote;
        return q ? [{ id: q.id, docNo: q.docNo ?? q.id, date: q.date, type: DrillDocType.SalesQuote, status: q.status, amount: twoPlaces(m.value) }] : [];
      }
      return m.invoices.map((invoice) => ({
        id: invoice.id,
        docNo: invoice.docNo ?? invoice.id,
        date: invoice.date,
        type: DrillDocType.SalesInvoice,
        status: invoice.status,
        amount: twoPlaces(stage === FunnelStage.Collected ? invoice.amountPaid : invoiceBaseGrandTotal(invoice)),
      }));
    });
    return c.json({
      kind: "funnel-stage",
      id: stage,
      titleAr: FUNNEL_STAGE_LABELS[stage].ar,
      subtitleAr: null,
      facts: [
        ...windowFacts(window),
        { key: "count", labelAr: "عدد الفرص", value: String(members.length), format: "qty" },
        { key: "stageValue", labelAr: "القيمة", value: twoPlaces(total), format: "money" },
      ],
      documents: documents.slice(0, DRILL_DOWN_LIMIT).map((d) => ({ ...d, amountFormat: "money" })),
      documentCount: documents.length,
    });
  });

  app.get("/drill-down/pipeline-stage/:id", gate(FUNNEL_VIEW_PERMISSION), async (c) => {
    const id = c.req.param("id");
    const window = await drillWindow(c);
    const [opportunities, stages, entries] = await Promise.all([visibleDeals(c), deps.pipelineStages.list(), deps.stageHistory.entries()]);
    const stage = stages.find((s) => s.id === id);
    if (!stage || isTerminalStage(stage)) return c.json({ error: "NOT_FOUND" }, 404);
    const today = await tenantToday(c, deps.today);
    const zone = await timeZone();
    const deals = [...openDealsInStage({ branchId: window.branchId, ownerUserId: window.ownerUserId, staleAfterDays: 1 }, { opportunities, stages, entries, asOf: `${today}T23:59:59.999Z` }, id)].sort((a, b) => b.daysInStage - a.daysInStage);
    const total = Money.sum(deals.map((d) => d.opportunity.expectedValue));
    return c.json({
      kind: "pipeline-stage",
      id,
      titleAr: stage.name,
      subtitleAr: null,
      facts: [
        { key: "count", labelAr: "عدد الفرص", value: String(deals.length), format: "qty" },
        { key: "stageValue", labelAr: "القيمة", value: twoPlaces(total), format: "money" },
      ],
      documents: deals.slice(0, DRILL_DOWN_LIMIT).map((d) => ({
        id: d.opportunity.id,
        docNo: d.opportunity.title,
        date: toTenantDay(d.enteredAt, zone),
        type: DrillDocType.Opportunity,
        status: d.opportunity.status,
        amount: twoPlaces(d.opportunity.expectedValue),
        amountFormat: "money",
      })),
      documentCount: deals.length,
    });
  });

  return app;
}
