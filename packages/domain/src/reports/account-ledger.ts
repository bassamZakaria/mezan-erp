import { z } from "zod";
import { type GlReportContext, accountNet, isLedgerEffective, moneyToNumber } from "./gl-shared.js";
import type { Account } from "../accounts/account.js";
import type { ReportDefinition } from "./types.js";

/**
 * دفتر حساب — Account Ledger / statement (docs/catalog/08-reports.md). All
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
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");

function buildParamsSchema(accountIds: readonly string[]): z.ZodType<AccountLedgerParams> {
  return z
    .object({
      accountId: z.string().refine((id) => accountIds.includes(id), { message: "اختر حساباً" }),
      periodFrom: DATE,
      periodTo: DATE,
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
        return accountNet(ctx.journalEntries, first.accountId, { to: first.periodTo });
      },
      toleranceMoney: 0.01,
    },
    run: (params, ctx) => {
      const opening = accountNet(ctx.journalEntries, params.accountId, { to: dayBefore(params.periodFrom) });
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
        },
      ];

      let running = opening;
      let seq = 0;
      const inPeriod = ctx.journalEntries
        .filter(
          (e) => isLedgerEffective(e) && e.date >= params.periodFrom && e.date <= params.periodTo && e.lines.some((l) => l.accountId === params.accountId),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || (a.entryNo ?? a.id).localeCompare(b.entryNo ?? b.id));

      for (const entry of inPeriod) {
        for (const line of entry.lines) {
          if (line.accountId !== params.accountId) continue;
          const debit = moneyToNumber(line.debit);
          const credit = moneyToNumber(line.credit);
          running += debit - credit;
          seq += 1;
          rows.push({
            rowId: `${entry.id}:${seq}`,
            date: entry.date,
            entryNo: entry.entryNo ?? entry.id,
            memo: line.memo ?? entry.memo,
            debit,
            credit,
            balance: running,
            isOpening: false,
            accountId: params.accountId,
            periodTo: params.periodTo,
          });
        }
      }
      return rows;
    },
  };
}
