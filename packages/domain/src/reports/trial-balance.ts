import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import type { Account, AccountType } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { netBalancesByAccount } from "./gl-shared.js";
import {
  BRANCH_STATEMENT_NOTE_AR,
  BRANCH_STATEMENT_PARAM_FIELD,
  UNATTRIBUTED_BRANCH_ID,
  UNATTRIBUTED_BRANCH_LABEL,
  branchIdParamSchema,
} from "./branch-filter.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";

/**
 * ميزان المراجعة — Trial Balance (docs/archive/catalog/08-reports.md), the report
 * engine's one wired example (docs/archive/plan.md §2.4). Chosen because it needs no
 * bespoke query beyond the ledger types already in this package (`Account`,
 * `JournalEntry`, `Money`), and because the catalog's own description of it —
 * "إجمالي المدين = إجمالي الدائن, shown with a literal '=' sign" — is exactly
 * this engine's `reconciliation` concept applied to the ledger itself.
 */

export interface TrialBalanceContext {
  readonly accounts: readonly Account[];
  readonly journalEntries: readonly JournalEntry[];
  /** The branches this caller may see (DEC-20). Undefined = every branch. */
  readonly branchScope?: readonly string[];
}

export interface TrialBalanceParams {
  readonly asOfDate: string;
  /** الفرع — "" for every branch, a branch id, or {@link UNATTRIBUTED_BRANCH_ID}. */
  readonly branchId: string;
}

export interface TrialBalanceRow {
  readonly accountId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly typeLabel: string;
  readonly debit: number;
  readonly credit: number;
  /**
   * «غير مخصص» — this account's net movement carrying no branch at all, over
   * the same window. Unchanged by the branch parameter, so a reader comparing
   * one branch against the entity can always see the reconciling item.
   */
  readonly unattributed: number;
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "الأصول",
  liability: "الالتزامات",
  equity: "حقوق الملكية",
  revenue: "الإيرادات",
  expense: "المصروفات",
  memorandum: "حسابات نظامية",
};

const trialBalanceParamsSchema = z.object({
  asOfDate: isoDateParamSchema,
  branchId: branchIdParamSchema,
});

/**
 * Net (debit − credit) balance per account, from every posted line dated
 * on/before `asOfDate` that the caller may see and the reader asked for.
 *
 * INVARIANT (DEC-20): filtering cuts at the LINE. A document-driven entry
 * stamps one branch on every leg, so a branch run of it still balances; a
 * manual journal split across branches does not, and that is real — the
 * «غير مخصص» column and the report's own note are what keep it visible rather
 * than letting «إجمالي المدين = إجمالي الدائن» go red with no explanation.
 *
 * The account drill-down (`/reports/drill-down/account/:id`) counts the same
 * lines through `accountActivity` with this window and these options; change
 * one and the panel stops reconciling to the row it was opened from (D281).
 */
function computeAccountBalances(
  journalEntries: readonly JournalEntry[],
  asOfDate: string,
  branchId: string,
  branchScope: readonly string[] | undefined,
): Map<string, Money> {
  return netBalancesByAccount(journalEntries, { to: asOfDate }, { branchId, branchScope });
}

export function createTrialBalanceReport(
  defaultAsOfDate: string,
): ReportDefinition<TrialBalanceParams, TrialBalanceRow, TrialBalanceContext> {
  return {
    id: "accounting.trial-balance",
    titleAr: "ميزان المراجعة",
    descriptionAr:
      "رصيد كل حساب تفصيلي في دليل الحسابات حتى تاريخ محدد، مجمّعاً حسب نوع الحساب. الحسابات النظامية خارج الميزان — تُقرأ من سجل خطابات الضمان. " +
      BRANCH_STATEMENT_NOTE_AR,
    paramsSchema: trialBalanceParamsSchema,
    defaultParams: { asOfDate: defaultAsOfDate, branchId: "" },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }, BRANCH_STATEMENT_PARAM_FIELD],
    // A full ledger dump is the catalog's canonical "heavy report" example
    // (دفتر الأستاذ العام) — this demo report follows the same on-demand
    // "عرض التقرير" pattern to prove the engine supports it.
    onDemand: true,
    rowKey: (row) => row.accountId,
    columns: [
      { key: "code", header: "رقم الحساب", format: "text", value: (row) => row.code },
      { key: "nameAr", header: "اسم الحساب", format: "text", value: (row) => row.nameAr, entity: { kind: "account", id: (row) => row.accountId } },
      { key: "debit", header: "مدين", format: "money", align: "end", total: true, value: (row) => row.debit },
      { key: "credit", header: "دائن", format: "money", align: "end", total: true, value: (row) => row.credit },
      { key: "unattributed", header: UNATTRIBUTED_BRANCH_LABEL, format: "money", align: "end", total: true, value: (row) => row.unattributed },
    ],
    group: {
      key: (row) => row.typeLabel,
      label: (row) => row.typeLabel,
    },
    reconciliation: {
      labelAr: "إجمالي المدين = إجمالي الدائن",
      computeReportTotal: (rows) => sumRows(rows, (row) => row.debit),
      computeReferenceTotal: (rows) => sumRows(rows, (row) => row.credit),
      toleranceMoney: 0.01,
    },
    kpis: [
      { key: "debit", labelAr: "إجمالي المدين", format: "money", value: (rows) => sumRows(rows, (r) => r.debit) },
      { key: "credit", labelAr: "إجمالي الدائن", format: "money", value: (rows) => sumRows(rows, (r) => r.credit) },
      { key: "difference", labelAr: "الفرق", hintAr: "المدين − الدائن، ويجب أن يكون صفراً", format: "money", value: (rows) => sumRows(rows, (r) => r.debit - r.credit), tone: (value) => (value === 0 ? "success" : "danger") },
      { key: "accountCount", labelAr: "عدد الحسابات", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      source: "groups",
      valueColumn: "debit",
      captionAr: "إجمالي الأرصدة المدينة في كل نوع حساب — نفس المجاميع الفرعية المطبوعة في الجدول.",
    },
    run: (params, ctx) => {
      const balances = computeAccountBalances(ctx.journalEntries, params.asOfDate, params.branchId, ctx.branchScope);
      const unattributed = computeAccountBalances(ctx.journalEntries, params.asOfDate, UNATTRIBUTED_BRANCH_ID, ctx.branchScope);
      const rows: TrialBalanceRow[] = [];
      for (const account of ctx.accounts) {
        if (account.isHeader) continue;
        // حسابات نظامية are off balance sheet. This report's totals ARE its
        // rows (the engine sums the columns marked `total`), so a memorandum
        // row would land inside «إجمالي المدين = إجمالي الدائن» and report a
        // contingent obligation as if it were a ledger balance. The guarantee
        // register (/contracting/guarantees/summary) is where those figures are read.
        if (account.type === "memorandum") continue;
        const net = Number((balances.get(account.id) ?? Money.zero()).toString());
        rows.push({
          accountId: account.id,
          code: account.code,
          nameAr: account.nameAr,
          nameEn: account.nameEn ?? null,
          typeLabel: ACCOUNT_TYPE_LABELS[account.type],
          debit: net > 0 ? net : 0,
          credit: net < 0 ? -net : 0,
          unattributed: Number((unattributed.get(account.id) ?? Money.zero()).toString()),
        });
      }
      return rows;
    },
  };
}
