import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import {
  ACCOUNT_SECTION_LABELS,
  type AccountSection,
  type GlReportContext,
  classifyAccount,
  moneyToNumber,
  netBalancesByAccount,
  unattributedNetBalancesByAccount,
} from "./gl-shared.js";
import {
  BRANCH_STATEMENT_NOTE_AR,
  BRANCH_STATEMENT_PARAM_FIELD,
  UNATTRIBUTED_BRANCH_LABEL,
  branchIdParamSchema,
} from "./branch-filter.js";
import { Money } from "../money/index.js";
import type { ReportDefinition } from "./types.js";
import { diffOf, sumRows } from "./kpi.js";

/**
 * الميزانية العمومية — Balance Sheet (docs/archive/catalog/08-reports.md), point in
 * time. Assets, liabilities and equity as of a date, verifying الأصول =
 * الالتزامات + حقوق الملكية (the catalog's explicit balance check → this
 * report's `reconciliation`). Net income for the period-to-date is folded into
 * equity as أرباح محتجزة so the identity holds without the P&L accounts.
 */

export interface BalanceSheetParams {
  readonly asOfDate: string;
  /** الفرع — "" for every branch, a branch id, or the «غير مخصص» bucket (DEC-20). */
  readonly branchId: string;
}

export interface BalanceSheetRow {
  readonly rowId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly sectionKey: string;
  readonly sectionLabel: string;
  /** Natural-balance amount (assets, liabilities and equity all shown positive). */
  readonly amount: number;
  /** Which side of A = L + E the row belongs to. */
  readonly side: "asset" | "liability-equity";
  /**
   * «غير مخصص» — the part of this row's balance carrying no branch, on the
   * same natural-balance sign convention. Unchanged by the branch parameter
   * (DEC-20), so a branch position can always be read against the entity's.
   */
  readonly unattributed: number;
}

const paramsSchema = z.object({
  asOfDate: isoDateParamSchema,
  branchId: branchIdParamSchema,
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
    descriptionAr:
      "الأصول والالتزامات وحقوق الملكية حتى تاريخ محدد — تتحقق من معادلة الأصول = الالتزامات + حقوق الملكية. " + BRANCH_STATEMENT_NOTE_AR,
    paramsSchema,
    defaultParams: { asOfDate: defaultAsOfDate, branchId: "" },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }, BRANCH_STATEMENT_PARAM_FIELD],
    showGrandTotal: false,
    rowKey: (row) => row.rowId,
    columns: [
      { key: "code", header: "رقم الحساب", format: "text", value: (row) => row.code },
      { key: "nameAr", header: "الحساب", format: "text", value: (row) => row.nameAr },
      { key: "amount", header: "الرصيد", format: "money", align: "end", total: true, value: (row) => row.amount },
      { key: "unattributed", header: UNATTRIBUTED_BRANCH_LABEL, format: "money", align: "end", total: true, value: (row) => row.unattributed },
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
      { key: "difference", labelAr: "الفرق", hintAr: "الأصول ناقص الالتزامات وحقوق الملكية، ويجب أن يكون صفراً", format: "money", value: (rows) => diffOf(balanceSheetTotalAssets(rows), balanceSheetTotalLiabilitiesEquity(rows)), tone: (value) => (value === 0 ? "success" : "danger") },
      { key: "rowCount", labelAr: "عدد البنود", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      source: "groups",
      valueColumn: "amount",
      captionAr: "أقسام الميزانية بمجاميعها — نفس المجاميع الفرعية المطبوعة في الجدول.",
    },
    run: (params, ctx) => {
      const window = { to: params.asOfDate };
      const balances = netBalancesByAccount(ctx.journalEntries, window, {
        branchScope: ctx.branchScope,
        branchId: params.branchId,
      });
      const unattributedBalances = unattributedNetBalancesByAccount(ctx.journalEntries, window, {
        branchScope: ctx.branchScope,
      });
      const rows: BalanceSheetRow[] = [];
      // Retained earnings accumulates across every P&L account in the chart, so
      // it is the figure most exposed to float drift — kept in `Money` (C-10).
      let retainedEarnings = Money.zero();
      let unattributedRetainedEarnings = Money.zero();

      for (const account of ctx.accounts) {
        if (account.isHeader) continue;
        const section = classifyAccount(account, ctx.cashAccountIds);
        const net = balances.get(account.id) ?? Money.zero();
        const unattributedNet = unattributedBalances.get(account.id) ?? Money.zero();

        // حسابات نظامية are off balance sheet by definition: the pair is
        // self-balancing, so including it would add the same contingent face
        // value to BOTH sides and restate the statement (D-05).
        if (section === "memorandum") continue;
        // Revenue/expense don't appear on the balance sheet — they accumulate
        // into retained earnings (net income to date), added under equity below.
        if (section === "revenue" || section === "expense") {
          retainedEarnings = retainedEarnings.add(net.negate());
          unattributedRetainedEarnings = unattributedRetainedEarnings.add(unattributedNet.negate());
          continue;
        }
        if (net.scaled === 0n && unattributedNet.scaled === 0n) continue;

        const isAsset = ASSET_SECTIONS.includes(section);
        // Assets are debit-normal (net>0); liabilities/equity credit-normal
        // (net<0) — present every section as a positive natural balance.
        const amount = moneyToNumber(isAsset ? net : net.negate());
        rows.push({
          rowId: account.id,
          code: account.code,
          nameAr: account.nameAr,
          nameEn: account.nameEn ?? null,
          sectionKey: section,
          sectionLabel: ACCOUNT_SECTION_LABELS[section],
          amount,
          side: isAsset ? "asset" : "liability-equity",
          unattributed: moneyToNumber(isAsset ? unattributedNet : unattributedNet.negate()),
        });
      }

      if (retainedEarnings.scaled !== 0n || unattributedRetainedEarnings.scaled !== 0n) {
        rows.push({
          rowId: "_retained-earnings",
          code: "",
          nameAr: "الأرباح المحتجزة (صافي دخل الفترة)",
          nameEn: "Retained earnings (net income for the period)",
          sectionKey: "equity",
          sectionLabel: ACCOUNT_SECTION_LABELS.equity,
          amount: moneyToNumber(retainedEarnings),
          side: "liability-equity",
          unattributed: moneyToNumber(unattributedRetainedEarnings),
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
