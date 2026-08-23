import { z } from "zod";
import {
  type GlReportContext,
  classifyAccount,
  moneyToNumber,
  netBalancesByAccount,
} from "./gl-shared.js";
import { Money } from "../money/index.js";
import type { ReportDefinition } from "./types.js";

/**
 * قائمة الدخل — Income Statement (docs/catalog/08-reports.md), a period P&L.
 * Revenue is shown positive, expense sections negative, so the grand total is
 * صافي الدخل = الإيرادات − تكلفة المبيعات − المصروفات. Grouped into the three
 * sections the catalog lists (الإيرادات / تكلفة البضاعة المباعة / المصاريف
 * التشغيلية) with a per-section subtotal each.
 */

export interface IncomeStatementParams {
  readonly periodFrom: string;
  readonly periodTo: string;
}

export interface IncomeStatementRow {
  readonly accountId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly sectionKey: string;
  readonly sectionLabel: string;
  /** Positive for revenue, negative for expenses — sums to net income. */
  readonly amount: number;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");

const paramsSchema = z
  .object({ periodFrom: DATE, periodTo: DATE })
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
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export function createIncomeStatementReport(
  defaultParams: IncomeStatementParams,
): ReportDefinition<IncomeStatementParams, IncomeStatementRow, GlReportContext> {
  return {
    id: "accounting.income-statement",
    titleAr: "قائمة الدخل",
    descriptionAr: "الإيرادات والمصروفات وصافي الدخل خلال الفترة المحددة، محسوبة من القيود المرحّلة.",
    paramsSchema,
    defaultParams,
    paramFields: [{ kind: "dateRange", fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" }],
    rowKey: (row) => row.accountId,
    columns: [
      { key: "code", header: "رقم الحساب", format: "text", value: (row) => row.code },
      { key: "nameAr", header: "البند", format: "text", value: (row) => row.nameAr },
      { key: "amount", header: "المبلغ", format: "money", align: "end", total: true, value: (row) => row.amount },
    ],
    group: {
      key: (row) => row.sectionKey,
      label: (row) => row.sectionLabel,
    },
    run: (params, ctx) => {
      const balances = netBalancesByAccount(ctx.journalEntries, { from: params.periodFrom, to: params.periodTo });
      const rows: IncomeStatementRow[] = [];
      for (const account of ctx.accounts) {
        if (account.isHeader) continue;
        const section = classifyAccount(account);
        if (section !== "revenue" && section !== "expense") continue;
        const net = moneyToNumber(balances.get(account.id) ?? Money.zero());
        if (net === 0) continue;
        // Revenue is credit-normal (net<0) → positive earned; expense is
        // debit-normal (net>0) → negative, so the grand total is net income.
        const isRevenue = section === "revenue";
        const amount = -net;
        const sectionKey = isRevenue ? "revenue" : account.code.startsWith("51") ? "cogs" : "opex";
        rows.push({
          accountId: account.id,
          code: account.code,
          nameAr: account.nameAr,
          sectionKey,
          sectionLabel: SECTIONS[sectionKey] ?? account.nameAr,
          amount,
        });
      }
      // Stable section order: revenue → cogs → opex.
      const order = ["revenue", "cogs", "opex"];
      rows.sort((a, b) => order.indexOf(a.sectionKey) - order.indexOf(b.sectionKey) || a.code.localeCompare(b.code));
      return rows;
    },
  };
}
