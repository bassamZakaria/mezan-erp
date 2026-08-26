import { z } from "zod";
import {
  ACCOUNT_SECTION_LABELS,
  type AccountSection,
  type GlReportContext,
  classifyAccount,
  moneyToNumber,
  netBalancesByAccount,
} from "./gl-shared.js";
import { Money } from "../money/index.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";

/**
 * الميزانية العمومية — Balance Sheet (docs/catalog/08-reports.md), point in
 * time. Assets, liabilities and equity as of a date, verifying الأصول =
 * الالتزامات + حقوق الملكية (the catalog's explicit balance check → this
 * report's `reconciliation`). Net income for the period-to-date is folded into
 * equity as أرباح محتجزة so the identity holds without the P&L accounts.
 */

export interface BalanceSheetParams {
  readonly asOfDate: string;
}

export interface BalanceSheetRow {
  readonly rowId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly sectionKey: string;
  readonly sectionLabel: string;
  /** Natural-balance amount (assets, liabilities and equity all shown positive). */
  readonly amount: number;
  /** Which side of A = L + E the row belongs to. */
  readonly side: "asset" | "liability-equity";
}

const paramsSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD"),
});

const ASSET_SECTIONS: AccountSection[] = ["cash", "current-asset", "non-current-asset"];
const SECTION_ORDER: string[] = [
  "cash",
  "current-asset",
  "non-current-asset",
  "current-liability",
  "non-current-liability",
  "equity",
];

/** Total of the asset rows. */
export function balanceSheetTotalAssets(rows: readonly BalanceSheetRow[]): number {
  return sumRows(rows, (r) => (r.side === "asset" ? r.amount : 0));
}

/** Total of the liability + equity rows (incl. retained earnings). */
export function balanceSheetTotalLiabilitiesEquity(rows: readonly BalanceSheetRow[]): number {
  return sumRows(rows, (r) => (r.side === "liability-equity" ? r.amount : 0));
}

export function createBalanceSheetReport(
  defaultAsOfDate: string,
): ReportDefinition<BalanceSheetParams, BalanceSheetRow, GlReportContext> {
  return {
    id: "accounting.balance-sheet",
    titleAr: "الميزانية العمومية",
    descriptionAr: "الأصول والالتزامات وحقوق الملكية حتى تاريخ محدد — تتحقق من معادلة الأصول = الالتزامات + حقوق الملكية.",
    paramsSchema,
    defaultParams: { asOfDate: defaultAsOfDate },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }],
    showGrandTotal: false,
    rowKey: (row) => row.rowId,
    columns: [
      { key: "code", header: "رقم الحساب", format: "text", value: (row) => row.code },
      { key: "nameAr", header: "الحساب", format: "text", value: (row) => row.nameAr },
      { key: "amount", header: "الرصيد", format: "money", align: "end", total: true, value: (row) => row.amount },
    ],
    group: {
      key: (row) => row.sectionKey,
      label: (row) => row.sectionLabel,
    },
    reconciliation: {
      labelAr: "الأصول = الالتزامات + حقوق الملكية",
      computeReportTotal: (rows) => balanceSheetTotalAssets(rows),
      computeReferenceTotal: (rows) => balanceSheetTotalLiabilitiesEquity(rows),
      toleranceMoney: 0.01,
    },
    kpis: [
      { key: "totalAssets", labelAr: "إجمالي الأصول", format: "money", value: (rows) => balanceSheetTotalAssets(rows) },
      { key: "totalLiabilitiesEquity", labelAr: "الالتزامات وحقوق الملكية", format: "money", value: (rows) => balanceSheetTotalLiabilitiesEquity(rows) },
      { key: "difference", labelAr: "الفرق", hintAr: "الأصول ناقص الالتزامات وحقوق الملكية، ويجب أن يكون صفراً", format: "money", value: (rows) => balanceSheetTotalAssets(rows) - balanceSheetTotalLiabilitiesEquity(rows), tone: (value) => (value === 0 ? "success" : "danger") },
      { key: "rowCount", labelAr: "عدد البنود", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      source: "groups",
      labelColumn: "sectionLabel",
      valueColumn: "amount",
      captionAr: "أقسام الميزانية بمجاميعها — نفس المجاميع الفرعية المطبوعة في الجدول.",
    },
    run: (params, ctx) => {
      const balances = netBalancesByAccount(ctx.journalEntries, { to: params.asOfDate });
      const rows: BalanceSheetRow[] = [];
      let retainedEarnings = 0;

      for (const account of ctx.accounts) {
        if (account.isHeader) continue;
        const section = classifyAccount(account, ctx.cashAccountIds);
        const net = moneyToNumber(balances.get(account.id) ?? Money.zero());

        // Revenue/expense don't appear on the balance sheet — they accumulate
        // into retained earnings (net income to date), added under equity below.
        if (section === "revenue" || section === "expense") {
          retainedEarnings += -net;
          continue;
        }
        if (net === 0) continue;

        const isAsset = ASSET_SECTIONS.includes(section);
        // Assets are debit-normal (net>0); liabilities/equity credit-normal
        // (net<0) — present every section as a positive natural balance.
        const amount = isAsset ? net : -net;
        rows.push({
          rowId: account.id,
          code: account.code,
          nameAr: account.nameAr,
          sectionKey: section,
          sectionLabel: ACCOUNT_SECTION_LABELS[section],
          amount,
          side: isAsset ? "asset" : "liability-equity",
        });
      }

      if (retainedEarnings !== 0) {
        rows.push({
          rowId: "_retained-earnings",
          code: "",
          nameAr: "الأرباح المحتجزة (صافي دخل الفترة)",
          sectionKey: "equity",
          sectionLabel: ACCOUNT_SECTION_LABELS.equity,
          amount: retainedEarnings,
          side: "liability-equity",
        });
      }

      rows.sort(
        (a, b) =>
          SECTION_ORDER.indexOf(a.sectionKey) - SECTION_ORDER.indexOf(b.sectionKey) || a.code.localeCompare(b.code),
      );
      return rows;
    },
  };
}
