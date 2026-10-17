import { z } from "zod";
import { Money } from "../money/index.js";
import { computeQuoteTotals } from "../sales-quotes/totals.js";
import type { SalesQuote } from "../sales-quotes/sales-quote.js";
import { salesInvoiceBaseTotals, salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { Opportunity } from "../crm/opportunity.js";
import type { PipelineStage } from "../crm/pipeline-stage.js";
import { dwellSegments, isTerminalStage, wholeDaysBetween, type OpportunityStageEntry } from "../crm/stage-history.js";
import { toTenantDay } from "../dates.js";
import { isoDateParamSchema } from "./iso-date.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";
import { sumRows } from "./kpi.js";
import { ReportParamKind, type ReportDefinition } from "./types.js";

export enum FunnelStage {
  Opportunity = "opportunity",
  Quoted = "quoted",
  Accepted = "accepted",
  Invoiced = "invoiced",
  Collected = "collected",
}

export const FUNNEL_STAGE_ORDER: readonly FunnelStage[] = [
  FunnelStage.Opportunity,
  FunnelStage.Quoted,
  FunnelStage.Accepted,
  FunnelStage.Invoiced,
  FunnelStage.Collected,
];

export const FUNNEL_STAGE_LABELS: Readonly<Record<FunnelStage, { readonly ar: string; readonly en: string }>> = {
  [FunnelStage.Opportunity]: { ar: "فرصة بيع", en: "Opportunity" },
  [FunnelStage.Quoted]: { ar: "عرض سعر مُرسل", en: "Quote sent" },
  [FunnelStage.Accepted]: { ar: "عرض مقبول", en: "Quote accepted" },
  [FunnelStage.Invoiced]: { ar: "فاتورة مبيعات", en: "Invoiced" },
  [FunnelStage.Collected]: { ar: "تحصيل", en: "Collected" },
};

const QUOTED_STATUSES: ReadonlySet<SalesQuote["status"]> = new Set(["sent", "accepted", "rejected", "converted"]);
const ACCEPTED_STATUSES: ReadonlySet<SalesQuote["status"]> = new Set(["accepted", "converted"]);

export interface SalesFunnelContext {
  readonly opportunities: readonly Opportunity[];
  readonly quotes: readonly SalesQuote[];
  readonly invoices: readonly SalesInvoice[];
  readonly timeZone?: string;
}

export interface SalesFunnelParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string;
  readonly ownerUserId: string;
}

export interface FunnelMember {
  readonly opportunity: Opportunity;
  readonly quote: SalesQuote | null;
  readonly invoices: readonly SalesInvoice[];
  readonly value: Money;
  readonly daysFromPrevious: number | null;
}

export type FunnelCohort = Readonly<Record<FunnelStage, readonly FunnelMember[]>>;

export interface SalesFunnelRow {
  readonly stageKey: FunnelStage;
  readonly stageNameAr: string;
  readonly stageNameEn: string;
  readonly count: number;
  readonly value: number;
  readonly conversionFromPrevious: number | null;
  readonly conversionFromTop: number | null;
  readonly avgDaysFromPrevious: number | null;
}

export const salesFunnelParamsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  branchId: branchIdParamSchema,
  ownerUserId: z.string().default(""),
});

function latest(quotes: readonly SalesQuote[]): SalesQuote | null {
  let pick: SalesQuote | null = null;
  for (const q of quotes) {
    if (pick === null || (q.sentAt ?? q.createdAt) > (pick.sentAt ?? pick.createdAt)) pick = q;
  }
  return pick;
}

function quoteGrandTotal(quote: SalesQuote): Money {
  return computeQuoteTotals(quote.lines, quote.discount, { taxExempt: quote.customerTaxExempt }).grandTotal;
}

export function invoiceBaseGrandTotal(invoice: SalesInvoice): Money {
  return salesInvoiceBaseTotals(salesInvoiceTotals(invoice), invoice.fxRate).grandTotal;
}

function daysBetweenStamps(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  return wholeDaysBetween(from, to);
}

export function buildFunnelCohort(params: SalesFunnelParams, ctx: SalesFunnelContext): FunnelCohort {
  const zone = ctx.timeZone;
  const dayOf = (stamp: string): string => toTenantDay(stamp, zone);
  const invoiceById = new Map(ctx.invoices.filter((i) => SALES_INVOICE_ACTIVE_STATUSES.has(i.status)).map((i) => [i.id, i]));
  const quotesByOpportunity = new Map<string, SalesQuote[]>();
  for (const quote of ctx.quotes) {
    if (!quote.opportunityId) continue;
    const list = quotesByOpportunity.get(quote.opportunityId) ?? [];
    list.push(quote);
    quotesByOpportunity.set(quote.opportunityId, list);
  }

  const cohort: Record<FunnelStage, FunnelMember[]> = {
    [FunnelStage.Opportunity]: [],
    [FunnelStage.Quoted]: [],
    [FunnelStage.Accepted]: [],
    [FunnelStage.Invoiced]: [],
    [FunnelStage.Collected]: [],
  };

  for (const opportunity of ctx.opportunities) {
    if (!withinDateRange(dayOf(opportunity.createdAt), params.dateFrom, params.dateTo)) continue;
    if (!matchesBranch(opportunity.branchId, params.branchId)) continue;
    if (params.ownerUserId !== "" && opportunity.ownerUserId !== params.ownerUserId) continue;

    cohort[FunnelStage.Opportunity].push({ opportunity, quote: null, invoices: [], value: opportunity.expectedValue, daysFromPrevious: null });

    const own = quotesByOpportunity.get(opportunity.id) ?? [];
    const quoted = latest(own.filter((q) => QUOTED_STATUSES.has(q.status)));
    if (!quoted) continue;
    cohort[FunnelStage.Quoted].push({
      opportunity,
      quote: quoted,
      invoices: [],
      value: quoteGrandTotal(quoted),
      daysFromPrevious: daysBetweenStamps(opportunity.createdAt, quoted.sentAt ?? quoted.createdAt),
    });

    const accepted = latest(own.filter((q) => ACCEPTED_STATUSES.has(q.status)));
    if (!accepted) continue;
    cohort[FunnelStage.Accepted].push({
      opportunity,
      quote: accepted,
      invoices: [],
      value: quoteGrandTotal(accepted),
      daysFromPrevious: daysBetweenStamps(accepted.sentAt ?? accepted.createdAt, accepted.respondedAt),
    });

    const seen = new Set<string>();
    const invoices: SalesInvoice[] = [];
    let converted: SalesQuote | null = null;
    for (const q of own) {
      if (q.status !== "converted" || !q.convertedInvoiceId || seen.has(q.convertedInvoiceId)) continue;
      const invoice = invoiceById.get(q.convertedInvoiceId);
      if (!invoice) continue;
      seen.add(invoice.id);
      invoices.push(invoice);
      converted = q;
    }
    if (invoices.length === 0 || converted === null) continue;
    cohort[FunnelStage.Invoiced].push({
      opportunity,
      quote: converted,
      invoices,
      value: Money.sum(invoices.map(invoiceBaseGrandTotal)),
      daysFromPrevious: daysBetweenStamps(converted.respondedAt, converted.convertedAt),
    });

    const collected = Money.sum(invoices.map((i) => i.amountPaid));
    if (collected.scaled <= 0n) continue;
    cohort[FunnelStage.Collected].push({ opportunity, quote: converted, invoices, value: collected, daysFromPrevious: null });
  }
  return cohort;
}

function averageDays(members: readonly FunnelMember[]): number | null {
  const known = members.map((m) => m.daysFromPrevious).filter((d): d is number => d !== null);
  if (known.length === 0) return null;
  return Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

export function createSalesFunnelReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<SalesFunnelParams, SalesFunnelRow, SalesFunnelContext> {
  return {
    id: "sales.funnel",
    titleAr: "قمع المبيعات",
    descriptionAr:
      "الفرص التي فُتحت في الفترة وما آلت إليه: عرض سعر مُرسل، مقبول، محوّل إلى فاتورة، ثم محصّل. التحويل محسوب على عدد الفرص، والقيم من العروض والفواتير نفسها. عروض الأسعار غير المرتبطة بفرصة لا تدخل في القمع.",
    paramsSchema: salesFunnelParamsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, branchId: "", ownerUserId: "" },
    paramFields: [
      { kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "فترة فتح الفرصة" },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.stageKey,
    columns: [
      { key: "stageNameAr", header: "المرحلة", format: "text", value: (row) => row.stageNameAr, entity: { kind: "funnel-stage", id: (row) => row.stageKey } },
      { key: "count", header: "العدد", format: "qty", align: "end", value: (row) => row.count },
      { key: "value", header: "القيمة", format: "money", align: "end", value: (row) => row.value },
      { key: "conversionFromPrevious", header: "التحويل من المرحلة السابقة", format: "percent", align: "end", value: (row) => row.conversionFromPrevious },
      { key: "conversionFromTop", header: "التحويل من الفرص", format: "percent", align: "end", value: (row) => row.conversionFromTop },
      { key: "avgDaysFromPrevious", header: "متوسط الأيام من المرحلة السابقة", format: "qty", align: "end", value: (row) => row.avgDaysFromPrevious },
    ],
    showGrandTotal: false,
    chart: { labelColumn: "stageNameAr", valueColumn: "count", maxPoints: 5, captionAr: "عدد الفرص في كل مرحلة من القمع." },
    kpis: [
      { key: "opportunities", labelAr: "فرص الفترة", format: "qty", value: (rows) => rows[0]?.count ?? 0 },
      { key: "invoiced", labelAr: "فرص تحوّلت إلى فاتورة", format: "qty", value: (rows) => rows.find((r) => r.stageKey === FunnelStage.Invoiced)?.count ?? 0 },
      { key: "invoicedValue", labelAr: "قيمة الفواتير", format: "money", value: (rows) => rows.find((r) => r.stageKey === FunnelStage.Invoiced)?.value ?? 0 },
      { key: "collectedValue", labelAr: "المحصّل", format: "money", value: (rows) => rows.find((r) => r.stageKey === FunnelStage.Collected)?.value ?? 0 },
      { key: "overallConversion", labelAr: "التحويل من فرصة إلى فاتورة", format: "percent", value: (rows) => rows.find((r) => r.stageKey === FunnelStage.Invoiced)?.conversionFromTop ?? 0 },
    ],
    run: (params, ctx) => {
      const cohort = buildFunnelCohort(params, ctx);
      const top = cohort[FunnelStage.Opportunity].length;
      return FUNNEL_STAGE_ORDER.map((stage, index) => {
        const members = cohort[stage];
        const previous = index === 0 ? null : cohort[FUNNEL_STAGE_ORDER[index - 1] as FunnelStage].length;
        return {
          stageKey: stage,
          stageNameAr: FUNNEL_STAGE_LABELS[stage].ar,
          stageNameEn: FUNNEL_STAGE_LABELS[stage].en,
          count: members.length,
          value: Number(Money.sum(members.map((m) => m.value)).toString()),
          conversionFromPrevious: previous === null ? null : ratio(members.length, previous),
          conversionFromTop: index === 0 ? null : ratio(members.length, top),
          avgDaysFromPrevious: index === 0 ? null : averageDays(members),
        };
      });
    },
  };
}

export interface StageAgingContext {
  readonly opportunities: readonly Opportunity[];
  readonly stages: readonly PipelineStage[];
  readonly entries: readonly OpportunityStageEntry[];
  readonly asOf: string;
}

export interface StageAgingParams {
  readonly branchId: string;
  readonly ownerUserId: string;
  readonly staleAfterDays: number;
}

export interface StageAgingRow {
  readonly stageId: string;
  readonly stageName: string;
  readonly openCount: number;
  readonly openValue: number;
  readonly avgDaysInStageNow: number | null;
  readonly daysSinceLastChange: number | null;
  readonly staleCount: number;
  readonly avgDaysSpent: number | null;
}

export const DEFAULT_STALE_AFTER_DAYS = 14;

export const stageAgingParamsSchema = z.object({
  branchId: branchIdParamSchema,
  ownerUserId: z.string().default(""),
  staleAfterDays: z.coerce.number().int().min(1).max(365).default(DEFAULT_STALE_AFTER_DAYS),
});

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function openDealsInStage(params: StageAgingParams, ctx: StageAgingContext, stageId: string): readonly { readonly opportunity: Opportunity; readonly enteredAt: string; readonly daysInStage: number }[] {
  const out: { opportunity: Opportunity; enteredAt: string; daysInStage: number }[] = [];
  for (const opportunity of ctx.opportunities) {
    if (opportunity.status !== "open" || opportunity.stageId !== stageId) continue;
    if (!matchesBranch(opportunity.branchId, params.branchId)) continue;
    if (params.ownerUserId !== "" && opportunity.ownerUserId !== params.ownerUserId) continue;
    const current = dwellSegments(opportunity, ctx.entries).filter((s) => s.leftAt === null && s.stageId === stageId).at(-1);
    const enteredAt = current?.enteredAt ?? opportunity.createdAt;
    out.push({ opportunity, enteredAt, daysInStage: wholeDaysBetween(enteredAt, ctx.asOf) });
  }
  return out;
}

export function createStageAgingReport(): ReportDefinition<StageAgingParams, StageAgingRow, StageAgingContext> {
  return {
    id: "sales.funnel-aging",
    titleAr: "أعمار مراحل المبيعات",
    descriptionAr:
      "لكل مرحلة من مراحل خط المبيعات: الفرص المفتوحة فيها الآن، ومتوسط ما قضته فيها، وأقدم فرصة لم تتحرك، والفرص الراكدة، ومتوسط الزمن الذي قضته الفرص التي غادرت المرحلة. الفرص المسجلة قبل تتبع المراحل تُحسب من تاريخ إنشائها.",
    paramsSchema: stageAgingParamsSchema,
    defaultParams: { branchId: "", ownerUserId: "", staleAfterDays: DEFAULT_STALE_AFTER_DAYS },
    paramFields: [
      BRANCH_PARAM_FIELD,
      { kind: ReportParamKind.Text, key: "staleAfterDays", label: "تُعدّ الفرصة راكدة بعد (يوم)", placeholder: "14" },
    ],
    rowKey: (row) => row.stageId,
    columns: [
      { key: "stageName", header: "المرحلة", format: "text", value: (row) => row.stageName, entity: { kind: "pipeline-stage", id: (row) => row.stageId } },
      { key: "openCount", header: "فرص مفتوحة", format: "qty", align: "end", total: true, value: (row) => row.openCount },
      { key: "openValue", header: "قيمتها", format: "money", align: "end", total: true, value: (row) => row.openValue },
      { key: "avgDaysInStageNow", header: "متوسط الأيام في المرحلة", format: "qty", align: "end", value: (row) => row.avgDaysInStageNow },
      { key: "daysSinceLastChange", header: "أيام منذ آخر تغيير (الأقدم)", format: "qty", align: "end", value: (row) => row.daysSinceLastChange },
      { key: "staleCount", header: "راكدة", format: "qty", align: "end", total: true, value: (row) => row.staleCount },
      { key: "avgDaysSpent", header: "متوسط الأيام قبل مغادرة المرحلة", format: "qty", align: "end", value: (row) => row.avgDaysSpent },
    ],
    kpis: [
      { key: "open", labelAr: "فرص مفتوحة", format: "qty", value: (rows) => sumRows(rows, (r) => r.openCount) },
      { key: "stale", labelAr: "فرص راكدة", format: "qty", value: (rows) => sumRows(rows, (r) => r.staleCount), tone: (v) => (v > 0 ? "danger" : "default") },
      { key: "openValue", labelAr: "قيمة الفرص المفتوحة", format: "money", value: (rows) => sumRows(rows, (r) => r.openValue) },
    ],
    run: (params, ctx) => {
      const ordered = [...ctx.stages].filter((s) => s.active && !isTerminalStage(s)).sort((a, b) => a.order - b.order);
      const stageById = new Map(ctx.stages.map((s) => [s.id, s]));
      const spent = new Map<string, number[]>();
      for (const opportunity of ctx.opportunities) {
        if (!matchesBranch(opportunity.branchId, params.branchId)) continue;
        if (params.ownerUserId !== "" && opportunity.ownerUserId !== params.ownerUserId) continue;
        for (const segment of dwellSegments(opportunity, ctx.entries)) {
          if (segment.leftAt === null || isTerminalStage(stageById.get(segment.stageId))) continue;
          const list = spent.get(segment.stageId) ?? [];
          list.push(wholeDaysBetween(segment.enteredAt, segment.leftAt));
          spent.set(segment.stageId, list);
        }
      }
      return ordered.map((stage) => {
        const deals = openDealsInStage(params, ctx, stage.id);
        const ages = deals.map((d) => d.daysInStage);
        const history = spent.get(stage.id) ?? [];
        return {
          stageId: stage.id,
          stageName: stage.name,
          openCount: deals.length,
          openValue: Number(Money.sum(deals.map((d) => d.opportunity.expectedValue)).toString()),
          avgDaysInStageNow: ages.length === 0 ? null : roundOne(ages.reduce((a, b) => a + b, 0) / ages.length),
          daysSinceLastChange: ages.length === 0 ? null : Math.max(...ages),
          staleCount: ages.filter((a) => a >= params.staleAfterDays).length,
          avgDaysSpent: history.length === 0 ? null : roundOne(history.reduce((a, b) => a + b, 0) / history.length),
        };
      });
    },
  };
}
