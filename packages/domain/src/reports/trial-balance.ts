import { z } from "zod";
import type { Account, AccountType } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";
import { isLedgerEffective } from "./gl-shared.js";
import type { ReportDefinition } from "./types.js";

/**
 * ميزان المراجعة — Trial Balance (docs/catalog/08-reports.md), the report
 * engine's one wired example (docs/plan.md §2.4). Chosen because it needs no
 * bespoke query beyond the ledger types already in this package (`Account`,
 * `JournalEntry`, `Money`), and because the catalog's own description of it —
 * "إجمالي المدين = إجمالي الدائن, shown with a literal '=' sign" — is exactly
 * this engine's `reconciliation` concept applied to the ledger itself.
 */

export interface TrialBalanceContext {
  readonly accounts: readonly Account[];
  readonly journalEntries: readonly JournalEntry[];
}

export interface TrialBalanceParams {
  readonly asOfDate: string;
}

export interface TrialBalanceRow {
  readonly accountId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly typeLabel: string;
  readonly debit: number;
  readonly credit: number;
}

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "الأصول",
  liability: "الالتزامات",
  equity: "حقوق الملكية",
  revenue: "الإيرادات",
  expense: "المصروفات",
};

const trialBalanceParamsSchema = z.object({
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD"),
});

/** Net (debit − credit) balance per account, from every posted line dated on/before `asOfDate`. */
function computeAccountBalances(journalEntries: readonly JournalEntry[], asOfDate: string): Map<string, Money> {
  const balances = new Map<string, Money>();
  for (const entry of journalEntries) {
    if (!isLedgerEffective(entry)) continue;
    if (entry.date > asOfDate) continue;
    for (const line of entry.lines) {
      const net = line.debit.add(line.credit.negate());
      balances.set(line.accountId, (balances.get(line.accountId) ?? Money.zero()).add(net));
    }
  }
  return balances;
}

export function createTrialBalanceReport(
  defaultAsOfDate: string,
): ReportDefinition<TrialBalanceParams, TrialBalanceRow, TrialBalanceContext> {
  return {
    id: "accounting.trial-balance",
    titleAr: "ميزان المراجعة",
    descriptionAr: "رصيد كل حساب تفصيلي في دليل الحسابات حتى تاريخ محدد، مجمّعاً حسب نوع الحساب.",
    paramsSchema: trialBalanceParamsSchema,
    defaultParams: { asOfDate: defaultAsOfDate },
    paramFields: [{ kind: "date", key: "asOfDate", label: "حتى تاريخ" }],
    // A full ledger dump is the catalog's canonical "heavy report" example
    // (دفتر الأستاذ العام) — this demo report follows the same on-demand
    // "عرض التقرير" pattern to prove the engine supports it.
    onDemand: true,
    rowKey: (row) => row.accountId,
    columns: [
      { key: "code", header: "رقم الحساب", format: "text", value: (row) => row.code },
      { key: "nameAr", header: "اسم الحساب", format: "text", value: (row) => row.nameAr },
      { key: "debit", header: "مدين", format: "money", align: "end", total: true, value: (row) => row.debit },
      { key: "credit", header: "دائن", format: "money", align: "end", total: true, value: (row) => row.credit },
    ],
    group: {
      key: (row) => row.typeLabel,
      label: (row) => row.typeLabel,
    },
    reconciliation: {
      labelAr: "إجمالي المدين = إجمالي الدائن",
      computeReportTotal: (rows) => rows.reduce((sum, row) => sum + row.debit, 0),
      computeReferenceTotal: (rows) => rows.reduce((sum, row) => sum + row.credit, 0),
      toleranceMoney: 0.01,
    },
    run: (params, ctx) => {
      const balances = computeAccountBalances(ctx.journalEntries, params.asOfDate);
      const rows: TrialBalanceRow[] = [];
      for (const account of ctx.accounts) {
        if (account.isHeader) continue;
        const net = Number((balances.get(account.id) ?? Money.zero()).toString());
        rows.push({
          accountId: account.id,
          code: account.code,
          nameAr: account.nameAr,
          typeLabel: ACCOUNT_TYPE_LABELS[account.type],
          debit: net > 0 ? net : 0,
          credit: net < 0 ? -net : 0,
        });
      }
      return rows;
    },
  };
}
