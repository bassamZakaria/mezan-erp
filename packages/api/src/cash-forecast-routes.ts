import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  AuditChangeAction,
  BASE_CURRENCY,
  CashForecastHorizon,
  Money,
  OverdueTreatment,
  buildCashForecast,
  chequeForecastItems,
  commitmentForecastItems,
  evaluateCashAlert,
  payableForecastItems,
  receivableForecastItems,
  toTenantDay,
  addDaysIso,
  horizonDays,
  CASH_FORECAST_MAX_HORIZON,
  type AuditSink,
  type CashForecast,
  type CashForecastAlertRecord,
  type CashForecastItem,
  type CashForecastStore,
  type Cheque,
  type CommitmentSource,
  type ScheduledCashItem,
  type TreasuryAccount,
} from "@mezan/domain";
import {
  cashForecastQuerySchema,
  updateCashForecastThresholdSchema,
  type CashForecastAlertDTO,
  type CashForecastDTO,
  type CashForecastItemDTO,
  type CashForecastOpeningAccountDTO,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { recordFieldChanges } from "./admin-audit.js";
import { openPartyAgingInputs, type ReportsRoutesDeps } from "./reports-routes.js";
import { tenantToday } from "./tenant-day.js";

export interface CashForecastRoutesDeps {
  readonly reports: ReportsRoutesDeps;
  readonly treasuryAccounts: { list(): Promise<readonly TreasuryAccount[]> };
  readonly store: CashForecastStore;
  readonly commitmentSources: () => readonly CommitmentSource[];
  readonly notify: (alert: CashForecastAlertRecord) => Promise<number>;
  readonly audit?: AuditSink;
  readonly today?: () => string;
  readonly now?: () => string;
  readonly idGen?: () => string;
}

const ALERT_HISTORY = 10;

function itemDTO(item: ScheduledCashItem): CashForecastItemDTO {
  return {
    id: item.id,
    kind: item.kind as unknown as CashForecastItemDTO["kind"],
    direction: item.direction as unknown as CashForecastItemDTO["direction"],
    dueDate: item.dueDate,
    expectedDate: item.expectedDate,
    overdue: item.overdue,
    amount: item.amount.toString(),
    partyId: item.partyId,
    partyName: item.partyName,
    partyNameEn: item.partyNameEn,
    reference: item.reference,
    documentId: item.documentId,
    currency: item.currency,
    detail: item.detail,
  };
}

function alertDTO(alert: CashForecastAlertRecord): CashForecastAlertDTO {
  return {
    id: alert.id,
    crossingDate: alert.crossingDate,
    threshold: alert.threshold.toString(),
    lowestDate: alert.lowestDate,
    lowestBalance: alert.lowestBalance.toString(),
    detectedAt: alert.detectedAt,
    clearedAt: alert.clearedAt,
    notifiedCount: alert.notifiedCount,
  };
}

interface OpeningCash {
  readonly total: Money;
  readonly accounts: CashForecastOpeningAccountDTO[];
}

async function openingCash(deps: CashForecastRoutesDeps, today: string, chequeAccountIds: ReadonlySet<string>): Promise<OpeningCash> {
  const accounts = [...(await deps.treasuryAccounts.list())].sort((a, b) => a.code.localeCompare(b.code));
  const seen = new Set<string>(chequeAccountIds);
  const rows: CashForecastOpeningAccountDTO[] = [];
  let total = 0n;
  for (const account of accounts) {
    const glAccountId = account.glAccountId;
    let balance: string | null = null;
    if (glAccountId && !seen.has(glAccountId)) {
      seen.add(glAccountId);
      const { balance: held } = await deps.reports.ledger.accountBalance(glAccountId, today);
      total += held.scaled;
      balance = held.toString();
    }
    if (account.status !== "active" && balance === null) continue;
    rows.push({ treasuryAccountId: account.id, name: account.name, nameEn: account.nameEn, type: account.type, glAccountId, balance });
  }
  return { total: Money.fromScaled(total), accounts: rows };
}

async function chequeItems(deps: CashForecastRoutesDeps, all: readonly Cheque[]): Promise<CashForecastItem[]> {
  const cheques = all.filter((c) => c.status === "pending" || c.status === "deposited");
  if (cheques.length === 0) return [];
  const accountIds = [...new Set(cheques.map((c) => c.controlAccounts.underCollectionAccountId))];
  const lines = (await deps.reports.ledger.listLines?.({ accountIds })) ?? [];
  const booked = new Map<string, bigint>();
  for (const line of lines) {
    const key = `${line.entryId} ${line.accountId}`;
    const net = line.debit.scaled - line.credit.scaled;
    booked.set(key, (booked.get(key) ?? 0n) + net);
  }
  const [customers, suppliers] = await Promise.all([deps.reports.customers.findAll(), deps.reports.suppliers.findAll()]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const baseOf = (cheque: Cheque): Money | null => {
    const key = cheque.creationJournalEntryId ? `${cheque.creationJournalEntryId} ${cheque.controlAccounts.underCollectionAccountId}` : null;
    const net = key ? booked.get(key) : undefined;
    if (net !== undefined && net !== 0n) return Money.fromScaled(net < 0n ? -net : net);
    return cheque.currency === BASE_CURRENCY ? cheque.amount : null;
  };
  const sources = [];
  for (const cheque of cheques) {
    const baseAmount = baseOf(cheque);
    if (!baseAmount) continue;
    const party = cheque.direction === "incoming" ? customerById.get(cheque.partyId) : supplierById.get(cheque.partyId);
    sources.push({ cheque, baseAmount, partyName: party?.nameAr ?? null, partyNameEn: party?.nameEn ?? null });
  }
  return chequeForecastItems(sources);
}

async function commitmentItems(deps: CashForecastRoutesDeps, today: string): Promise<CashForecastItem[]> {
  const window = { from: today, to: addDaysIso(today, horizonDays(CASH_FORECAST_MAX_HORIZON) - 1) };
  const out: CashForecastItem[] = [];
  for (const source of deps.commitmentSources()) {
    out.push(...commitmentForecastItems(source.id, await source.commitments(window)));
  }
  return out;
}

async function forecastItems(deps: CashForecastRoutesDeps, today: string, allCheques: readonly Cheque[]): Promise<CashForecastItem[]> {
  const [aging, plans, cheques, commitments] = await Promise.all([
    openPartyAgingInputs(deps.reports, today),
    deps.reports.installmentPlans.list(),
    chequeItems(deps, allCheques),
    commitmentItems(deps, today),
  ]);
  return [
    ...receivableForecastItems({ asOfDate: today, aging: aging.customers, installmentPlans: plans }),
    ...payableForecastItems({ asOfDate: today, aging: aging.suppliers }),
    ...cheques,
    ...commitments,
  ];
}

async function reconcileAlert(
  deps: CashForecastRoutesDeps,
  full: CashForecast,
  nowIso: string,
): Promise<CashForecastAlertRecord | null> {
  const evaluation = evaluateCashAlert(full);
  const open = await deps.store.openAlert();
  if (!evaluation.breached || !evaluation.crossingDate) {
    if (open) await deps.store.clearOpen(nowIso);
    return null;
  }
  if (open) return open;
  const record: CashForecastAlertRecord = {
    id: (deps.idGen ?? randomUUID)(),
    crossingDate: evaluation.crossingDate,
    threshold: full.threshold,
    lowestDate: evaluation.lowestDate,
    lowestBalance: evaluation.lowestBalance,
    detectedAt: nowIso,
    clearedAt: null,
    notifiedCount: 0,
  };
  if (!(await deps.store.openCrossing(record))) return deps.store.openAlert();
  const notified = await deps.notify(record);
  await deps.store.markNotified(record.id, notified);
  return { ...record, notifiedCount: notified };
}

export function createCashForecastRoutes(deps: CashForecastRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const today = (c: Context) => tenantToday(c, deps.today);
  const now = () => (deps.now ? deps.now() : new Date().toISOString());

  app.get("/", gate("treasury.cash_forecast.view"), async (c) => {
    const parsed = cashForecastQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "INVALID_QUERY", message: "معايير التوقع غير صالحة.", messageEn: "Invalid forecast parameters.", issues: parsed.error.issues }, 400);
    }
    const day = await today(c);
    const horizon = parsed.data.horizon as unknown as CashForecastHorizon;
    const overdue = parsed.data.overdue as unknown as OverdueTreatment;
    const allCheques = (await deps.reports.cheques?.list()) ?? [];
    const chequeAccountIds = new Set(allCheques.map((cheque) => cheque.controlAccounts.underCollectionAccountId));
    const [opening, items, thresholdRecord] = await Promise.all([
      openingCash(deps, day, chequeAccountIds),
      forecastItems(deps, day, allCheques),
      deps.store.getThreshold(),
    ]);
    const threshold = thresholdRecord?.amount ?? Money.zero();
    const base = { today: day, openingCash: opening.total, threshold, items };
    const forecast = buildCashForecast({ ...base, horizon, overdueReceivables: overdue });
    const full =
      horizon === CASH_FORECAST_MAX_HORIZON && overdue === OverdueTreatment.Today
        ? forecast
        : buildCashForecast({ ...base, horizon: CASH_FORECAST_MAX_HORIZON, overdueReceivables: OverdueTreatment.Today });
    const alert = await reconcileAlert(deps, full, now());
    const history = await deps.store.listAlerts(ALERT_HISTORY);

    const body: CashForecastDTO = {
      today: forecast.today,
      horizon: parsed.data.horizon,
      endDate: forecast.endDate,
      overdue: parsed.data.overdue,
      openingCash: forecast.openingCash.toString(),
      openingAccounts: opening.accounts,
      threshold: {
        amount: threshold.toString(),
        updatedAt: thresholdRecord?.updatedAt ?? null,
        updatedBy: thresholdRecord?.updatedBy ?? null,
      },
      days: forecast.days.map((d) => ({
        date: d.date,
        opening: d.opening.toString(),
        inflows: d.inflows.toString(),
        outflows: d.outflows.toString(),
        closing: d.closing.toString(),
        itemCount: d.itemCount,
      })),
      items: forecast.items.map(itemDTO),
      totals: {
        inflows: forecast.totals.inflows.toString(),
        outflows: forecast.totals.outflows.toString(),
        closing: forecast.totals.closing.toString(),
      },
      byKind: Object.fromEntries(Object.entries(forecast.byKind).map(([kind, money]) => [kind, money.toString()])) as CashForecastDTO["byKind"],
      overdueSummary: {
        receivables: forecast.overdue.receivables.toString(),
        receivablesCount: forecast.overdue.receivablesCount,
        payables: forecast.overdue.payables.toString(),
        payablesCount: forecast.overdue.payablesCount,
      },
      excludedOverdueReceivables: forecast.excludedOverdueReceivables.toString(),
      beyondHorizon: { inflows: forecast.beyondHorizon.inflows.toString(), outflows: forecast.beyondHorizon.outflows.toString() },
      firstBelowZero: forecast.firstBelowZero,
      firstBelowThreshold: forecast.firstBelowThreshold,
      lowest: { date: forecast.lowest.date, balance: forecast.lowest.balance.toString() },
      runwayDays: forecast.runwayDays,
      dips: forecast.dips.map((dip) => ({
        startDate: dip.startDate,
        endDate: dip.endDate,
        lowestDate: dip.lowestDate,
        lowestBalance: dip.lowestBalance.toString(),
        drivers: dip.drivers.map(itemDTO),
      })),
      alert: alert ? alertDTO(alert) : null,
      alerts: history.map(alertDTO),
      commitmentSources: deps.commitmentSources().length,
    };
    return c.json(body);
  });

  app.put("/threshold", gate("treasury.cash_forecast.manage"), async (c) => {
    const parsed = updateCashForecastThresholdSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { error: "INVALID_THRESHOLD", message: "حد التنبيه يجب أن يكون مبلغاً صحيحاً.", messageEn: "The alert threshold must be a valid amount.", issues: parsed.error.issues },
        400,
      );
    }
    const amount = Money.fromMajor(parsed.data.amount);
    const previous = await deps.store.getThreshold();
    const at = now();
    const actor = getAuthContext(c)?.userId ?? null;
    await deps.store.setThreshold({ amount, updatedAt: at, updatedBy: actor });
    if (!previous || previous.amount.scaled !== amount.scaled) await deps.store.clearOpen(at);
    await recordFieldChanges(deps.audit, c, {
      entity: { module: "treasury", entityType: "cash_forecast_threshold", entityId: "default" },
      action: AuditChangeAction.Update,
      before: previous ? { threshold: previous.amount } : null,
      after: { threshold: amount },
      fields: ["threshold"],
    });
    return c.json({ amount: amount.toString(), updatedAt: at, updatedBy: actor });
  });

  return app;
}
