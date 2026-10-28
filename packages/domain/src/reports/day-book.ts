import { z } from "zod";
import { Money } from "../money/index.js";
import { isoDateParamSchema } from "./iso-date.js";
import { type GlReportContext, isLedgerEffective, lineInBranchView } from "./gl-shared.js";
import { BRANCH_STATEMENT_PARAM_FIELD, branchIdParamSchema } from "./branch-filter.js";
import type { ReportDefinition } from "./types.js";
import { countDistinct, sumMoneyStrings } from "./kpi.js";
import { ReportParamKind } from "./types.js";

/**
 * دفتر اليومية — Day Book (#126). Every posted journal entry in the period in
 * the order it was booked (date, then entry number), each with its lines.
 * Grouped by entry, so every group's debit and credit subtotals must agree.
 */

export interface DayBookParams {
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly branchId?: string;
}

export interface DayBookRow {
  readonly rowId: string;
  readonly entryId: string;
  readonly date: string;
  readonly entryNo: string;
  readonly entryLabel: string;
  readonly accountCode: string;
  readonly accountNameAr: string;
  readonly accountNameEn: string | null;
  readonly memo: string;
  readonly sourceRef: string;
  readonly debit: string;
  readonly credit: string;
}

const DATE = isoDateParamSchema;
const paramsSchema = z
  .object({ periodFrom: DATE, periodTo: DATE, branchId: branchIdParamSchema })
  .refine((p) => p.periodFrom <= p.periodTo, {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["periodFrom"],
  });

const sumDebit = (rows: readonly DayBookRow[]) => sumMoneyStrings(rows, (r) => [r.debit]);
const sumCredit = (rows: readonly DayBookRow[]) => sumMoneyStrings(rows, (r) => [r.credit]);

export function createDayBookReport(defaultParams: DayBookParams): ReportDefinition<DayBookParams, DayBookRow, GlReportContext> {
  return {
    id: "accounting.day-book",
    titleAr: "دفتر اليومية",
    descriptionAr: "كل القيود المرحّلة في الفترة بترتيب التاريخ ثم رقم القيد، ببنودها.",
    paramsSchema,
    defaultParams,
    paramFields: [{ kind: ReportParamKind.DateRange, fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" }, BRANCH_STATEMENT_PARAM_FIELD],
    onDemand: true,
    rowKey: (row) => row.rowId,
    columns: [
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "entryNo", header: "رقم القيد", format: "text", value: (row) => row.entryNo },
      { key: "accountCode", header: "كود الحساب", format: "text", value: (row) => row.accountCode },
      { key: "accountNameAr", header: "اسم الحساب", format: "text", value: (row) => row.accountNameAr },
      { key: "memo", header: "البيان", format: "text", value: (row) => row.memo },
      { key: "sourceRef", header: "المستند المصدر", format: "text", value: (row) => row.sourceRef },
      { key: "debit", header: "مدين", format: "money", align: "end", total: true, value: (row) => row.debit },
      { key: "credit", header: "دائن", format: "money", align: "end", total: true, value: (row) => row.credit },
    ],
    group: {
      key: (row) => row.entryId,
      label: (row) => row.entryLabel,
    },
    reconciliation: {
      labelAr: "إجمالي المدين = إجمالي الدائن",
      computeExactTotals: (rows) => ({ report: Money.fromMajor(sumDebit(rows)), reference: Money.fromMajor(sumCredit(rows)) }),
      toleranceMoney: 0,
    },
    kpis: [
      { key: "debit", labelAr: "إجمالي المدين", format: "money", value: sumDebit },
      { key: "credit", labelAr: "إجمالي الدائن", format: "money", value: sumCredit },
      { key: "entryCount", labelAr: "عدد القيود", format: "qty", value: (rows) => countDistinct(rows, (r) => r.entryId) },
      { key: "lineCount", labelAr: "عدد البنود", format: "qty", value: (rows) => rows.length },
    ],
    run: (params, ctx) => {
      const accountById = new Map(ctx.accounts.map((a) => [a.id, a] as const));
      const entries = ctx.journalEntries
        .filter((entry) => isLedgerEffective(entry) && entry.date >= params.periodFrom && entry.date <= params.periodTo)
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            (a.entryNo ?? a.id).localeCompare(b.entryNo ?? b.id, "en", { numeric: true }) ||
            a.id.localeCompare(b.id),
        );
      const rows: DayBookRow[] = [];
      for (const entry of entries) {
        const entryNo = entry.entryNo ?? entry.id;
        const entryLabel = `${entryNo} — ${entry.date}${entry.memo ? ` — ${entry.memo}` : ""}`;
        const sourceRef = entry.sourceDocNumber ?? entry.sourceDocId ?? "";
        entry.lines.forEach((line, index) => {
          if (!lineInBranchView(line, { branchScope: ctx.branchScope, branchId: params.branchId })) return;
          const account = accountById.get(line.accountId);
          rows.push({
            rowId: `${entry.id}:${index}`,
            entryId: entry.id,
            date: entry.date,
            entryNo,
            entryLabel,
            accountCode: account?.code ?? line.accountId,
            accountNameAr: account?.nameAr ?? line.accountId,
            accountNameEn: account?.nameEn ?? null,
            memo: line.memo || entry.memo,
            sourceRef,
            debit: line.debit.toString(),
            credit: line.credit.toString(),
          });
        });
      }
      return rows;
    },
  };
}
