import { z } from "zod";
import {
  type AccountSection,
  type GlReportContext,
  classifyAccount,
  isCashAccount,
  moneyToNumber,
  netBalancesByAccount,
} from "./gl-shared.js";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { ReportDefinition } from "./types.js";

/**
 * التدفقات النقدية — Cash Flow Statement, indirect method
 * (docs/catalog/08-reports.md). Because every posted entry balances, the sum
 * of net (debit − credit) movements across all accounts is zero, so the net
 * change in cash equals the negation of the net change in every non-cash
 * account. Each non-cash account's period movement is assigned to an
 * activity, its cash impact being −Δnet — this makes التشغيلية + الاستثمارية +
 * التمويلية reconcile to the actual change in the cash balance by construction.
 */

export interface CashFlowParams {
  readonly periodFrom: string;
  readonly periodTo: string;
}

export type CashFlowActivity = "operating" | "investing" | "financing";

export interface CashFlowRow {
  readonly rowId: string;
  readonly activity: CashFlowActivity;
  readonly activityLabel: string;
  readonly label: string;
  readonly amount: number;
  /** Cash balance at the start of the period (same on every row — the report's opening figure). */
  readonly openingCash: number;
  /** Cash balance at the end of the period. */
  readonly closingCash: number;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");
const paramsSchema = z
  .object({ periodFrom: DATE, periodTo: DATE })
  .refine((p) => p.periodFrom <= p.periodTo, {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["periodFrom"],
  });

const ACTIVITY_LABELS: Record<CashFlowActivity, string> = {
  operating: "الأنشطة التشغيلية",
  investing: "الأنشطة الاستثمارية",
  financing: "الأنشطة التمويلية",
};

const WORKING_CAPITAL_LABELS: Record<string, string> = {
  "current-asset": "التغير في الأصول المتداولة",
  "current-liability": "التغير في الالتزامات المتداولة",
};

function activityForSection(section: AccountSection): CashFlowActivity | null {
  switch (section) {
    case "current-asset":
    case "current-liability":
    case "revenue":
    case "expense":
      return "operating";
    case "non-current-asset":
      return "investing";
    case "non-current-liability":
    case "equity":
      return "financing";
    case "cash":
      return null;
  }
}

const ACTIVITY_ORDER: CashFlowActivity[] = ["operating", "investing", "financing"];

/** Sum of every activity row — the net change in cash. */
export function cashFlowNetChange(rows: readonly CashFlowRow[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export function createCashFlowReport(
  defaultParams: CashFlowParams,
): ReportDefinition<CashFlowParams, CashFlowRow, GlReportContext> {
  return {
    id: "accounting.cash-flow",
    titleAr: "التدفقات النقدية",
    descriptionAr: "قائمة التدفقات النقدية بالطريقة غير المباشرة — الأنشطة التشغيلية والاستثمارية والتمويلية، من الرصيد الافتتاحي إلى الختامي.",
    paramsSchema,
    defaultParams,
    paramFields: [{ kind: "dateRange", fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" }],
    rowKey: (row) => row.rowId,
    columns: [
      { key: "label", header: "البيان", format: "text", value: (row) => row.label },
      { key: "amount", header: "التدفق النقدي", format: "money", align: "end", total: true, value: (row) => row.amount },
    ],
    group: {
      key: (row) => row.activity,
      label: (row) => row.activityLabel,
    },
    reconciliation: {
      labelAr: "الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي",
      computeReportTotal: (rows) => (rows[0]?.openingCash ?? 0) + cashFlowNetChange(rows),
      computeReferenceTotal: (rows) => rows[0]?.closingCash ?? 0,
      toleranceMoney: 0.01,
    },
    run: (params, ctx) => {
      const periodBalances = netBalancesByAccount(ctx.journalEntries, {
        from: params.periodFrom,
        to: params.periodTo,
      });

      const cashAccounts = ctx.accounts.filter((a) => !a.isHeader && isCashAccount(a, ctx.cashAccountIds));
      const cashIds = new Set(cashAccounts.map((a) => a.id));

      const openingBalances = netBalancesByAccount(ctx.journalEntries, { to: dayBefore(params.periodFrom) });
      const closingBalances = netBalancesByAccount(ctx.journalEntries, { to: params.periodTo });
      const openingCash = sumOver(cashAccounts, openingBalances);
      const closingCash = sumOver(cashAccounts, closingBalances);

      // Net income = −Σ Δnet(revenue+expense) — the operating section's anchor.
      let netIncome = 0;
      const workingCapital: CashFlowRow[] = [];
      const investing: CashFlowRow[] = [];
      const financing: CashFlowRow[] = [];

      for (const account of ctx.accounts) {
        if (account.isHeader || cashIds.has(account.id)) continue;
        const net = moneyToNumber(periodBalances.get(account.id) ?? Money.zero());
        const section = classifyAccount(account, ctx.cashAccountIds);
        if (section === "revenue" || section === "expense") {
          netIncome += -net;
          continue;
        }
        if (net === 0) continue;
        const activity = activityForSection(section);
        if (activity === null) continue;
        const row: CashFlowRow = {
          rowId: account.id,
          activity,
          activityLabel: ACTIVITY_LABELS[activity],
          label:
            activity === "operating"
              ? `${WORKING_CAPITAL_LABELS[section] ?? "التغير"} — ${account.nameAr}`
              : account.nameAr,
          amount: -net,
          openingCash,
          closingCash,
        };
        if (activity === "operating") workingCapital.push(row);
        else if (activity === "investing") investing.push(row);
        else financing.push(row);
      }

      const netIncomeRow: CashFlowRow = {
        rowId: "_net-income",
        activity: "operating",
        activityLabel: ACTIVITY_LABELS.operating,
        label: "صافي الدخل",
        amount: netIncome,
        openingCash,
        closingCash,
      };

      const rows = [netIncomeRow, ...workingCapital, ...investing, ...financing];
      rows.sort((a, b) => ACTIVITY_ORDER.indexOf(a.activity) - ACTIVITY_ORDER.indexOf(b.activity));
      return rows;
    },
  };
}

/** The date one day before `date` (YYYY-MM-DD), for an exclusive opening cutoff. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function sumOver(accounts: readonly Account[], balances: Map<string, Money>): number {
  let total = 0;
  for (const account of accounts) total += moneyToNumber(balances.get(account.id) ?? Money.zero());
  return total;
}
