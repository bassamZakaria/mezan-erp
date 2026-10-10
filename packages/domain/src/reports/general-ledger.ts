import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { type GlReportContext, isLedgerEffective, lineInBranchView, moneyToNumber } from "./gl-shared.js";
import { BRANCH_STATEMENT_PARAM_FIELD, branchIdParamSchema } from "./branch-filter.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countDistinct } from "./kpi.js";

/**
 * دفتر الأستاذ العام — General Ledger (docs/archive/catalog/08-reports.md). Every
 * posted journal-entry line across all accounts for a period, grouped by
 * account. Heavy, so it is on-demand (عرض التقرير) rather than auto-run.
 * إجمالي المدين = إجمالي الدائن is the natural GL-reconciliation check.
 */

export interface GeneralLedgerParams {
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly branchId?: string;
}

export interface GeneralLedgerRow {
  readonly rowId: string;
  readonly date: string;
  readonly entryNo: string;
  readonly accountKey: string;
  readonly accountLabel: string;
  readonly memo: string;
  readonly debit: number;
  readonly credit: number;
}

const DATE = isoDateParamSchema;
const paramsSchema = z
  .object({ periodFrom: DATE, periodTo: DATE, branchId: branchIdParamSchema })
  .refine((p) => p.periodFrom <= p.periodTo, {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["periodFrom"],
  });

export function createGeneralLedgerReport(
  defaultParams: GeneralLedgerParams,
): ReportDefinition<GeneralLedgerParams, GeneralLedgerRow, GlReportContext> {
  return {
    id: "accounting.general-ledger",
    titleAr: "دفتر الأستاذ العام",
    descriptionAr: "جميع بنود القيود المرحّلة عبر كل الحسابات خلال الفترة، مجمّعة حسب الحساب.",
    paramsSchema,
    defaultParams,
    paramFields: [{ kind: "dateRange", fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" }, BRANCH_STATEMENT_PARAM_FIELD],
    onDemand: true,
    rowKey: (row) => row.rowId,
    columns: [
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "entryNo", header: "رقم القيد", format: "text", value: (row) => row.entryNo },
      { key: "memo", header: "البيان", format: "text", value: (row) => row.memo },
      { key: "debit", header: "مدين", format: "money", align: "end", total: true, value: (row) => row.debit },
      { key: "credit", header: "دائن", format: "money", align: "end", total: true, value: (row) => row.credit },
    ],
    group: {
      key: (row) => row.accountKey,
      label: (row) => row.accountLabel,
    },
    reconciliation: {
      labelAr: "إجمالي المدين = إجمالي الدائن",
      computeReportTotal: (rows) => sumRows(rows, (r) => r.debit),
      computeReferenceTotal: (rows) => sumRows(rows, (r) => r.credit),
      toleranceMoney: 0.01,
    },
    kpis: [
      { key: "debit", labelAr: "إجمالي المدين", format: "money", value: (rows) => sumRows(rows, (r) => r.debit) },
      { key: "credit", labelAr: "إجمالي الدائن", format: "money", value: (rows) => sumRows(rows, (r) => r.credit) },
      { key: "lineCount", labelAr: "عدد البنود", format: "qty", value: (rows) => rows.length },
      { key: "accountCount", labelAr: "عدد الحسابات", format: "qty", value: (rows) => countDistinct(rows, (r) => r.accountKey) },
    ],
    chart: {
      source: "groups",
      valueColumn: "debit",
      maxPoints: 8,
      captionAr: "الحسابات مرتبة حسب ما تحرك عليها مديناً في الفترة.",
    },
    run: (params, ctx) => {
      const nameById = new Map(ctx.accounts.map((a) => [a.id, a] as const));
      const rows: GeneralLedgerRow[] = [];
      let seq = 0;
      for (const entry of ctx.journalEntries) {
        if (!isLedgerEffective(entry)) continue;
        if (entry.date < params.periodFrom || entry.date > params.periodTo) continue;
        for (const line of entry.lines) {
          if (!lineInBranchView(line, { branchScope: ctx.branchScope, branchId: params.branchId })) continue;
          const account = nameById.get(line.accountId);
          const accountLabel = account ? `${account.code} — ${account.nameAr}` : line.accountId;
          seq += 1;
          rows.push({
            rowId: `${entry.id}:${seq}`,
            date: entry.date,
            entryNo: entry.entryNo ?? entry.id,
            accountKey: line.accountId,
            accountLabel,
            memo: line.memo ?? entry.memo,
            debit: moneyToNumber(line.debit),
            credit: moneyToNumber(line.credit),
          });
        }
      }
      // Group by account (code order), then chronological within each account.
      rows.sort(
        (a, b) => a.accountLabel.localeCompare(b.accountLabel) || a.date.localeCompare(b.date) || a.rowId.localeCompare(b.rowId),
      );
      return rows;
    },
  };
}
