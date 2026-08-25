import { z } from "zod";
import { Money } from "../money/index.js";
import type { ReportDefinition } from "./types.js";

/**
 * إقرار ضريبة الخصم والتحصيل — Withholding Tax (docs/catalog/08-reports.md).
 *
 * Egypt withholds tax on most local B2B payments: the supplier is discharged in
 * full while a slice of the payment is retained and owed to the authority
 * instead. Each confirmed payment voucher that withheld reports one row — payee,
 * gross settled, rate, tax withheld, net paid — which is what the quarterly
 * filing is assembled from.
 *
 * The figures come from the vouchers themselves, not from GL 2210, so the two
 * can be compared: a filing that disagrees with the control account means a
 * hand-written entry touched it.
 */

export interface WithholdingTaxContext {
  readonly rows: readonly {
    readonly voucherId: string;
    readonly voucherNo: string | null;
    readonly date: string;
    readonly partyId: string | null;
    readonly partyNameAr: string;
    readonly grossAmount: Money;
    readonly ratePercent: number | null;
    readonly withheldAmount: Money;
  }[];
}

export interface WithholdingTaxParams {
  readonly fromDate: string;
  readonly toDate: string;
}

export interface WithholdingTaxRow {
  readonly voucherId: string;
  readonly voucherNo: string;
  readonly date: string;
  readonly partyNameAr: string;
  readonly grossAmount: number;
  readonly ratePercent: number;
  readonly withheldAmount: number;
  readonly netPaidAmount: number;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح — استخدم الصيغة YYYY-MM-DD");
const paramsSchema = z
  .object({ fromDate: DATE, toDate: DATE })
  .refine((p) => p.fromDate <= p.toDate, { message: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية" });

export function createWithholdingTaxReport(
  defaultFrom: string,
  defaultTo: string,
): ReportDefinition<WithholdingTaxParams, WithholdingTaxRow, WithholdingTaxContext> {
  return {
    id: "tax.withholding",
    titleAr: "ضريبة الخصم والتحصيل",
    descriptionAr: "المبالغ المستقطعة من مدفوعات الموردين والمستحقة لمصلحة الضرائب.",
    paramsSchema,
    defaultParams: { fromDate: defaultFrom, toDate: defaultTo },
    paramFields: [
      { kind: "date", key: "fromDate", label: "من تاريخ" },
      { kind: "date", key: "toDate", label: "إلى تاريخ" },
    ],
    rowKey: (row) => row.voucherId,
    columns: [
      { key: "voucherNo", header: "رقم السند", format: "text", value: (row) => row.voucherNo },
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "partyNameAr", header: "المورد", format: "text", value: (row) => row.partyNameAr },
      { key: "grossAmount", header: "المبلغ الإجمالي", format: "money", align: "end", total: true, value: (row) => row.grossAmount },
      { key: "ratePercent", header: "النسبة %", format: "percent", align: "end", value: (row) => row.ratePercent },
      { key: "withheldAmount", header: "الضريبة المستقطعة", format: "money", align: "end", total: true, value: (row) => row.withheldAmount },
      { key: "netPaidAmount", header: "الصافي المدفوع", format: "money", align: "end", total: true, value: (row) => row.netPaidAmount },
    ],
    run: (params, ctx) =>
      ctx.rows
        .filter((r) => r.date >= params.fromDate && r.date <= params.toDate)
        .filter((r) => r.withheldAmount.scaled > 0n)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((r) => ({
          voucherId: r.voucherId,
          voucherNo: r.voucherNo ?? r.voucherId,
          date: r.date,
          partyNameAr: r.partyNameAr,
          grossAmount: Number(r.grossAmount.toString()),
          ratePercent: r.ratePercent ?? 0,
          withheldAmount: Number(r.withheldAmount.toString()),
          netPaidAmount: Number(Money.fromScaled(r.grossAmount.scaled - r.withheldAmount.scaled).toString()),
        })),
  };
}
