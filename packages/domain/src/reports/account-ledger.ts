import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { type GlReportContext, accountNet, isLedgerEffective, lineInBranchView, moneyToNumber, netBalancesByAccount } from "./gl-shared.js";
import { BRANCH_STATEMENT_PARAM_FIELD, branchIdParamSchema } from "./branch-filter.js";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";

/**
 * دفتر حساب — Account Ledger / statement (docs/archive/catalog/08-reports.md). All
 * transactions and a running balance for one selected account over a period,
 * like a bank statement for any GL account. On-demand, and the account picker
 * is required. The running balance is debit-normal (debit − credit
 * cumulative); the closing running balance must equal the account's net
 * movement as of period end — the report's reconciliation check.
 */

export interface AccountLedgerParams {
  readonly accountId: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly branchId?: string;
}

export interface AccountLedgerRow {
  readonly rowId: string;
  readonly date: string;
  readonly entryNo: string;
  readonly memo: string;
  readonly debit: number;
  readonly credit: number;
  /** Debit-normal cumulative balance up to and including this row. */
  readonly balance: number;
  readonly isOpening: boolean;
  /** The account + period-end this statement was run for — used to cross-check the running balance. */
  readonly accountId: string;
  readonly periodTo: string;
  readonly branchId?: string;
}

const DATE = isoDateParamSchema;

function buildParamsSchema(accountIds: readonly string[]): z.ZodType<AccountLedgerParams> {
  return z
    .object({
      accountId: z.string().refine((id) => accountIds.includes(id), { message: "اختر حساباً" }),
      periodFrom: DATE,
      periodTo: DATE,
      branchId: branchIdParamSchema,
    })
    .refine((p) => p.periodFrom <= p.periodTo, {
      message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
      path: ["periodFrom"],
    });
}

/** The day before `date` (YYYY-MM-DD), for the exclusive opening-balance cutoff. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function createAccountLedgerReport(
  accounts: readonly Account[],
  defaultParams: AccountLedgerParams,
): ReportDefinition<AccountLedgerParams, AccountLedgerRow, GlReportContext> {
  const postable = accounts.filter((a) => !a.isHeader);
  const options = postable.map((a) => ({ value: a.id, label: `${a.code} — ${a.nameAr}` }));

  return {
    id: "accounting.account-ledger",
    titleAr: "دفتر حساب",
    descriptionAr: "كشف حركة حساب واحد خلال فترة مع الرصيد الجاري — كشف حساب لأي حساب في دليل الحسابات.",
    paramsSchema: buildParamsSchema(postable.map((a) => a.id)),
    defaultParams,
    paramFields: [
      { kind: "select", key: "accountId", label: "الحساب", options },
      { kind: "dateRange", fromKey: "periodFrom", toKey: "periodTo", label: "الفترة" },
      BRANCH_STATEMENT_PARAM_FIELD,
    ],
    onDemand: true,
    rowKey: (row) => row.rowId,
    columns: [
      { key: "date", header: "التاريخ", format: "date", value: (row) => (row.isOpening ? null : row.date) },
      { key: "entryNo", header: "رقم القيد", format: "text", value: (row) => row.entryNo },
      { key: "memo", header: "البيان", format: "text", value: (row) => row.memo },
      { key: "debit", header: "مدين", format: "money", align: "end", total: true, value: (row) => row.debit },
      { key: "credit", header: "دائن", format: "money", align: "end", total: true, value: (row) => row.credit },
      { key: "balance", header: "الرصيد الجاري", format: "money", align: "end", value: (row) => row.balance },
    ],
    reconciliation: {
      labelAr: "الرصيد الختامي = رصيد الحساب من دفتر الأستاذ",
      // Cross-check the row-by-row running total against a fresh as-of aggregate
      // query straight off the ledger — they must agree.
      computeReportTotal: (rows) => rows[rows.length - 1]?.balance ?? 0,
      computeReferenceTotal: (rows, ctx) => {
        const first = rows[0];
        if (!first) return 0;
        return accountNet(ctx.journalEntries, first.accountId, { to: first.periodTo }, { branchScope: ctx.branchScope, branchId: first.branchId });
      },
      toleranceMoney: 0.01,
    },
    kpis: [
      { key: "openingBalance", labelAr: "الرصيد الافتتاحي", format: "money", value: (rows) => rows.find((r) => r.isOpening)?.balance ?? 0 },
      { key: "debit", labelAr: "إجمالي المدين", format: "money", value: (rows) => sumRows(rows, (r) => r.debit) },
      { key: "credit", labelAr: "إجمالي الدائن", format: "money", value: (rows) => sumRows(rows, (r) => r.credit) },
      { key: "closingBalance", labelAr: "الرصيد الختامي", hintAr: "الرصيد بعد آخر حركة في الفترة", format: "money", value: (rows) => rows[rows.length - 1]?.balance ?? 0 },
    ],
    chart: {
      labelColumn: "date",
      valueColumn: "balance",
      slice: "last",
      maxPoints: 12,
      captionAr: "الرصيد الجاري بعد كل حركة من آخر اثنتي عشرة حركة في الفترة.",
    },
    run: (params, ctx) => {
      const branchView = { branchScope: ctx.branchScope, branchId: params.branchId };
      // The running balance is carried in `Money` and converted once per row
      // (C-10): a float running total drifts down a long account ledger, and
      // the closing balance is the figure a reconciliation is judged on.
      const openingMoney =
        netBalancesByAccount(ctx.journalEntries, { to: dayBefore(params.periodFrom) }, branchView).get(params.accountId) ??
        Money.zero();
      const opening = moneyToNumber(openingMoney);
      const rows: AccountLedgerRow[] = [
        {
          rowId: "_opening",
          date: params.periodFrom,
          entryNo: "",
          memo: "الرصيد الافتتاحي",
          debit: 0,
          credit: 0,
          balance: opening,
          isOpening: true,
          accountId: params.accountId,
          periodTo: params.periodTo,
          branchId: params.branchId,
        },
      ];

      let running = openingMoney;
      let seq = 0;
      const inPeriod = ctx.journalEntries
        .filter(
          (e) => isLedgerEffective(e) && e.date >= params.periodFrom && e.date <= params.periodTo && e.lines.some((l) => l.accountId === params.accountId && lineInBranchView(l, branchView)),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || (a.entryNo ?? a.id).localeCompare(b.entryNo ?? b.id));

      for (const entry of inPeriod) {
        for (const line of entry.lines) {
          if (line.accountId !== params.accountId || !lineInBranchView(line, branchView)) continue;
          running = running.add(line.debit).add(line.credit.negate());
          seq += 1;
          rows.push({
            rowId: `${entry.id}:${seq}`,
            date: entry.date,
            entryNo: entry.entryNo ?? entry.id,
            memo: line.memo ?? entry.memo,
            debit: moneyToNumber(line.debit),
            credit: moneyToNumber(line.credit),
            balance: moneyToNumber(running),
            isOpening: false,
            accountId: params.accountId,
            periodTo: params.periodTo,
            branchId: params.branchId,
          });
        }
      }
      return rows;
    },
  };
}
