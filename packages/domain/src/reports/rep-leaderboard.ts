import { z } from "zod";
import { Money } from "../money/index.js";
import { extendLine } from "../promotions/engine.js";
import { salesInvoiceBaseTotals, salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { Opportunity } from "../crm/opportunity.js";
import { toTenantDay } from "../dates.js";
import { isoDateParamSchema } from "./iso-date.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";
import { sumRows } from "./kpi.js";
import { invoiceBaseGrandTotal } from "./sales-funnel.js";
import { UNASSIGNED_SALESPERSON_KEY } from "./sales-by-salesperson.js";
import { ReportParamKind, type ReportColumn, type ReportDefinition } from "./types.js";

export interface RepDirectoryEntry {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly employeeId: string | null;
}

export interface RepLeaderboardContext {
  readonly invoices: readonly SalesInvoice[];
  readonly opportunities: readonly Opportunity[];
  readonly reps: readonly RepDirectoryEntry[];
  readonly timeZone?: string;
}

export interface RepLeaderboardParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string;
}

export interface RepLeaderboardRow {
  readonly repId: string;
  readonly repNameAr: string;
  readonly repNameEn: string;
  readonly invoiceCount: number;
  readonly revenue: number;
  readonly grossMargin?: number;
  readonly grossMarginPercent?: number | null;
  readonly avgDealSize: number;
  readonly wonDeals: number;
  readonly lostDeals: number;
  readonly conversionRate: number | null;
  readonly collected: number;
  readonly collectionPercent: number | null;
}

export interface RepActivity {
  readonly repId: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly invoices: SalesInvoice[];
  readonly won: Opportunity[];
  readonly lost: Opportunity[];
}

export const repLeaderboardParamsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  branchId: branchIdParamSchema,
});

const UNASSIGNED_NAME_AR = "غير محدد";
const UNASSIGNED_NAME_EN = "Unassigned";
const EMPLOYEE_ONLY_PREFIX = "emp:";

function ratio(part: bigint, whole: bigint): number | null {
  if (whole <= 0n) return null;
  return Number((part * 10_000n) / whole) / 100;
}

function divideHalfUp(total: Money, count: number): Money {
  if (count <= 0) return Money.zero();
  const n = BigInt(count);
  return Money.fromScaled((total.scaled * 2n + n) / (2n * n));
}

export function invoiceCostOfGoods(invoice: SalesInvoice): Money {
  return Money.sum(invoice.lines.filter((l) => l.isStock && l.unitCost !== null).map((l) => extendLine(l.qty, l.unitCost as Money)));
}

/**
 * INVARIANT: an invoice belongs to the rep (user) whose linked employee is its
 * salesperson; one whose salesperson has no user still gets its own row, and
 * one nobody is credited with falls in «غير محدد» — so the leaderboard's total
 * revenue always equals the period's total sales.
 */
export function collectRepActivity(params: RepLeaderboardParams, ctx: RepLeaderboardContext): ReadonlyMap<string, RepActivity> {
  const dayOf = (stamp: string): string => toTenantDay(stamp, ctx.timeZone);
  const userByEmployee = new Map<string, RepDirectoryEntry>();
  for (const rep of ctx.reps) if (rep.employeeId && !userByEmployee.has(rep.employeeId)) userByEmployee.set(rep.employeeId, rep);
  const userById = new Map(ctx.reps.map((r) => [r.id, r]));
  const out = new Map<string, RepActivity>();
  const slot = (repId: string, nameAr: string, nameEn: string): RepActivity => {
    const existing = out.get(repId);
    if (existing) return existing;
    const created: RepActivity = { repId, nameAr, nameEn, invoices: [], won: [], lost: [] };
    out.set(repId, created);
    return created;
  };
  const unassigned = (): RepActivity => slot(UNASSIGNED_SALESPERSON_KEY, UNASSIGNED_NAME_AR, UNASSIGNED_NAME_EN);

  for (const invoice of ctx.invoices) {
    if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
    if (!withinDateRange(invoice.date, params.dateFrom, params.dateTo)) continue;
    if (!matchesBranch(invoice.branchId, params.branchId)) continue;
    const salespersonId = invoice.salespersonId;
    if (!salespersonId) {
      unassigned().invoices.push(invoice);
      continue;
    }
    const user = userByEmployee.get(salespersonId);
    if (user) slot(user.id, user.nameAr, user.nameEn ?? user.nameAr).invoices.push(invoice);
    else {
      const name = invoice.salespersonNameAr ?? salespersonId;
      slot(`${EMPLOYEE_ONLY_PREFIX}${salespersonId}`, name, name).invoices.push(invoice);
    }
  }

  for (const opportunity of ctx.opportunities) {
    if (opportunity.status === "open" || !opportunity.closedAt) continue;
    if (!withinDateRange(dayOf(opportunity.closedAt), params.dateFrom, params.dateTo)) continue;
    if (!matchesBranch(opportunity.branchId, params.branchId)) continue;
    const owner = opportunity.ownerUserId ? userById.get(opportunity.ownerUserId) : undefined;
    const activity = owner ? slot(owner.id, owner.nameAr, owner.nameEn ?? owner.nameAr) : unassigned();
    (opportunity.status === "won" ? activity.won : activity.lost).push(opportunity);
  }
  return out;
}

export interface RepFigures {
  readonly revenue: Money;
  readonly grandTotal: Money;
  readonly collected: Money;
  readonly cost: Money;
}

export function repFigures(activity: RepActivity, withCost: boolean): RepFigures {
  let revenue = Money.zero();
  let grandTotal = Money.zero();
  let collected = Money.zero();
  let cost = Money.zero();
  for (const invoice of activity.invoices) {
    const base = salesInvoiceBaseTotals(salesInvoiceTotals(invoice), invoice.fxRate);
    revenue = revenue.add(base.taxableTotal);
    grandTotal = grandTotal.add(invoiceBaseGrandTotal(invoice));
    collected = collected.add(invoice.amountPaid);
    if (withCost) cost = cost.add(invoiceCostOfGoods(invoice));
  }
  return { revenue, grandTotal, collected, cost };
}

export function repConversionRate(activity: RepActivity): number | null {
  const closed = activity.won.length + activity.lost.length;
  return closed === 0 ? null : (activity.won.length / closed) * 100;
}

function rowOf(activity: RepActivity, withCost: boolean): RepLeaderboardRow {
  const { revenue, grandTotal, collected, cost } = repFigures(activity, withCost);
  const margin = revenue.add(cost.negate());
  return {
    repId: activity.repId,
    repNameAr: activity.nameAr,
    repNameEn: activity.nameEn,
    invoiceCount: activity.invoices.length,
    revenue: Number(revenue.toString()),
    ...(withCost ? { grossMargin: Number(margin.toString()), grossMarginPercent: ratio(margin.scaled, revenue.scaled) } : {}),
    avgDealSize: Number(divideHalfUp(revenue, activity.invoices.length).toString()),
    wonDeals: activity.won.length,
    lostDeals: activity.lost.length,
    conversionRate: repConversionRate(activity),
    collected: Number(collected.toString()),
    collectionPercent: ratio(collected.scaled, grandTotal.scaled),
  };
}

export function createRepLeaderboardReport(
  defaultDateFrom: string,
  defaultDateTo: string,
  options: { readonly withCost: boolean },
): ReportDefinition<RepLeaderboardParams, RepLeaderboardRow, RepLeaderboardContext> {
  const { withCost } = options;
  const costColumns: readonly ReportColumn<RepLeaderboardRow>[] = withCost
    ? [
        { key: "grossMargin", header: "هامش الربح", format: "money", align: "end", total: true, value: (row) => row.grossMargin ?? 0 },
        { key: "grossMarginPercent", header: "نسبة هامش الربح", format: "percent", align: "end", value: (row) => row.grossMarginPercent ?? null },
      ]
    : [];
  return {
    id: "sales.rep-leaderboard",
    titleAr: "لوحة أداء المندوبين",
    descriptionAr:
      "ترتيب المندوبين في الفترة: إيراد فواتيرهم بدون ضريبة، متوسط الفاتورة، نسبة نجاح الفرص التي أُغلقت في الفترة، وما حُصّل من فواتيرهم. الفواتير غير المنسوبة لمندوب تظهر في صف «غير محدد» حتى يساوي إجمالي الإيراد مبيعات الفترة.",
    paramsSchema: repLeaderboardParamsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, branchId: "" },
    paramFields: [{ kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }, BRANCH_PARAM_FIELD],
    rowKey: (row) => row.repId,
    columns: [
      { key: "repNameAr", header: "المندوب", format: "text", value: (row) => row.repNameAr, entity: { kind: "rep", id: (row) => row.repId } },
      { key: "invoiceCount", header: "عدد الفواتير", format: "qty", align: "end", total: true, value: (row) => row.invoiceCount },
      { key: "revenue", header: "الإيراد", format: "money", align: "end", total: true, value: (row) => row.revenue },
      ...costColumns,
      { key: "avgDealSize", header: "متوسط الفاتورة", format: "money", align: "end", value: (row) => row.avgDealSize },
      { key: "wonDeals", header: "فرص رابحة", format: "qty", align: "end", total: true, value: (row) => row.wonDeals },
      { key: "lostDeals", header: "فرص خاسرة", format: "qty", align: "end", total: true, value: (row) => row.lostDeals },
      { key: "conversionRate", header: "نسبة نجاح الفرص", format: "percent", align: "end", value: (row) => row.conversionRate },
      { key: "collected", header: "المحصّل", format: "money", align: "end", total: true, value: (row) => row.collected },
      { key: "collectionPercent", header: "نسبة التحصيل", format: "percent", align: "end", value: (row) => row.collectionPercent },
    ],
    chart: { labelColumn: "repNameAr", valueColumn: "revenue", maxPoints: 8, captionAr: "إيراد كل مندوب في الفترة." },
    kpis: [
      { key: "revenue", labelAr: "إجمالي الإيراد", format: "money", value: (rows) => sumRows(rows, (r) => r.revenue) },
      ...(withCost ? [{ key: "grossMargin", labelAr: "إجمالي هامش الربح", format: "money" as const, value: (rows: readonly RepLeaderboardRow[]) => sumRows(rows, (r) => r.grossMargin ?? 0) }] : []),
      { key: "collected", labelAr: "المحصّل", format: "money", value: (rows) => sumRows(rows, (r) => r.collected) },
      { key: "repCount", labelAr: "عدد المندوبين", format: "qty", value: (rows) => rows.filter((r) => r.repId !== UNASSIGNED_SALESPERSON_KEY).length },
    ],
    run: (params, ctx) =>
      [...collectRepActivity(params, ctx).values()]
        .map((activity) => rowOf(activity, withCost))
        .sort((a, b) => {
          if (a.repId === UNASSIGNED_SALESPERSON_KEY) return 1;
          if (b.repId === UNASSIGNED_SALESPERSON_KEY) return -1;
          return b.revenue - a.revenue;
        }),
  };
}
