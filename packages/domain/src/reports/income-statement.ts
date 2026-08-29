import { z } from "zod";
import {
  type GlReportContext,
  classifyAccount,
  moneyToNumber,
  netBalancesByAccount,
} from "./gl-shared.js";
import { COMPARISON_LABEL_AR, type ComparisonMode, comparativeRange } from "./comparative-period.js";
import { Money } from "../money/index.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";

/**
 * قائمة الدخل — Income Statement (docs/archive/catalog/08-reports.md), a period P&L.
 * Revenue is shown positive, expense sections negative, so the grand total is
 * صافي الدخل = الإيرادات − تكلفة المبيعات − المصروفات. Grouped into the three
 * sections the catalog lists (الإيرادات / تكلفة البضاعة المباعة / المصاريف
 * التشغيلية) with a per-section subtotal each.
 *
 * Comparative: every run also computes the same figures over a comparison
 * window and the signed change between them (ux-enhancement-spec §4 dose 3).
 */

export interface IncomeStatementParams {
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly compareTo: ComparisonMode;
}

export interface IncomeStatementRow {
  readonly accountId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly sectionKey: string;
  readonly sectionLabel: string;
  /** Positive for revenue, negative for expenses — sums to net income. */
  readonly amount: number;
  /** The same figure over the comparison window, on the same sign convention. */
  readonly priorAmount: number;
  /** `amount − priorAmount`. Positive always means "better for net income". */
  readonly variance: number;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");

const paramsSchema = z
  .object({
    periodFrom: DATE,
    periodTo: DATE,
    compareTo: z.enum(["previous", "lastYear"]).default("previous"),
  })
  .refine((p) => p.periodFrom <= p.periodTo, {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["periodFrom"],
  });

const SECTIONS: Record<string, string> = {
  revenue: "الإيرادات",
  cogs: "تكلفة البضاعة المباعة",
  opex: "المصاريف التشغيلية",
};

/** Sum of a section's row amounts — the report's own "net income" primitive, reused by reconciliation-free callers. */
export function incomeStatementNetIncome(rows: readonly IncomeStatementRow[]): number {
  return sumRows(rows, (row) => row.amount);
}

export function createIncomeStatementReport(
  defaultParams: Omit<IncomeStatementParams, "compareTo"> & Partial<Pick<IncomeStatementParams, "compareTo">>,
): ReportDefinition<IncomeStatementParams, IncomeStatementRow, GlReportContext> {
  return {
    id: "accounting.income-statement",
    titleAr: "قائمة الدخل",
    descriptionAr: "الإيرادات والمصروفات وصافي الدخل خلال الفترة المحددة، محسوبة من القيود المرحّلة، مقارنةً بفترة سابقة.",
    paramsSchema,
    defaultParams: { compareTo: "previous", ...defaultParams },
    paramFields: [
      { kind: "dateRange", fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" },
      {
        kind: "select",
        key: "compareTo",
        label: "المقارنة",
        options: [
          { value: "previous", label: COMPARISON_LABEL_AR.previous },
          { value: "lastYear", label: COMPARISON_LABEL_AR.lastYear },
        ],
      },
    ],
    rowKey: (row) => row.accountId,
    columns: [
      { key: "code", header: "رقم الحساب", format: "text", value: (row) => row.code },
      { key: "nameAr", header: "البند", format: "text", value: (row) => row.nameAr, entity: { kind: "account", id: (row) => row.accountId } },
      { key: "amount", header: "الفترة الحالية", format: "money", align: "end", total: true, value: (row) => row.amount },
      { key: "priorAmount", header: "فترة المقارنة", format: "money", align: "end", total: true, value: (row) => row.priorAmount },
      { key: "variance", header: "التغيّر", format: "variance", align: "end", total: true, value: (row) => row.variance },
    ],
    group: {
      key: (row) => row.sectionKey,
      label: (row) => row.sectionLabel,
    },
    kpis: [
      { key: "revenue", labelAr: "الإيرادات", format: "money", value: (rows) => sumRows(rows, (r) => (r.sectionKey === "revenue" ? r.amount : 0)) },
      { key: "expenses", labelAr: "المصروفات", format: "money", value: (rows) => -sumRows(rows, (r) => (r.sectionKey === "revenue" ? 0 : r.amount)) },
      { key: "netIncome", labelAr: "صافي الدخل", format: "money", value: (rows) => incomeStatementNetIncome(rows), tone: (value) => (value >= 0 ? "success" : "danger") },
      { key: "variance", labelAr: "التغيّر عن فترة المقارنة", format: "money", value: (rows) => sumRows(rows, (r) => r.variance), tone: (value) => (value >= 0 ? "success" : "danger") },
    ],
    chart: {
      source: "groups",
      valueColumn: "amount",
      captionAr: "الإيرادات والمصروفات في الفترة حسب القسم — المصروفات سالبة لأنها تُطرح من صافي الدخل.",
    },
    run: (params, ctx) => {
      const prior = comparativeRange({ from: params.periodFrom, to: params.periodTo }, params.compareTo);
      // Without `excludeYearEndClose` the closing entry — dated 31 December of
      // the year it closes — nets every P&L account to zero, so the annual
      // قائمة الدخل reads nil revenue and nil profit.
      const current = netBalancesByAccount(ctx.journalEntries, { from: params.periodFrom, to: params.periodTo }, { excludeYearEndClose: true });
      const previous = netBalancesByAccount(ctx.journalEntries, { from: prior.from, to: prior.to }, { excludeYearEndClose: true });
      const rows: IncomeStatementRow[] = [];
      for (const account of ctx.accounts) {
        if (account.isHeader) continue;
        const section = classifyAccount(account, ctx.cashAccountIds);
        if (section !== "revenue" && section !== "expense") continue;
        const currentNet = moneyToNumber(current.get(account.id) ?? Money.zero());
        const priorNet = moneyToNumber(previous.get(account.id) ?? Money.zero());
        // An account active in only one of the two windows still belongs in a
        // comparison — dropping it would hide exactly the change being looked for.
        if (currentNet === 0 && priorNet === 0) continue;
        // Revenue is credit-normal (net<0) → positive earned; expense is
        // debit-normal (net>0) → negative, so the grand total is net income.
        const isRevenue = section === "revenue";
        const amount = -currentNet;
        const priorAmount = -priorNet;
        const sectionKey = isRevenue ? "revenue" : account.code.startsWith("51") ? "cogs" : "opex";
        rows.push({
          accountId: account.id,
          code: account.code,
          nameAr: account.nameAr,
          nameEn: account.nameEn ?? null,
          sectionKey,
          sectionLabel: SECTIONS[sectionKey] ?? account.nameAr,
          amount,
          priorAmount,
          variance: amount - priorAmount,
        });
      }
      // Stable section order: revenue → cogs → opex.
      const order = ["revenue", "cogs", "opex"];
      rows.sort((a, b) => order.indexOf(a.sectionKey) - order.indexOf(b.sectionKey) || a.code.localeCompare(b.code));
      return rows;
    },
  };
}
