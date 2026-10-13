import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { ReportParamKind } from "./types.js";

/**
 * إقرار ضريبة الخصم والتحصيل — Withholding Tax (docs/archive/catalog/08-reports.md).
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
  readonly partyId: string | null;
  readonly voucherNo: string;
  readonly date: string;
  readonly partyNameAr: string;
  readonly grossAmount: number;
  readonly ratePercent: number;
  readonly withheldAmount: number;
  readonly netPaidAmount: number;
}

const DATE = isoDateParamSchema;
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
      { kind: ReportParamKind.Date, key: "fromDate", label: "من تاريخ" },
      { kind: ReportParamKind.Date, key: "toDate", label: "إلى تاريخ" },
    ],
    rowKey: (row) => row.voucherId,
    columns: [
      { key: "voucherNo", header: "رقم السند", format: "text", value: (row) => row.voucherNo },
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "partyNameAr", header: "المورد", format: "text", value: (row) => row.partyNameAr, entity: { kind: "supplier", id: (row) => row.partyId } },
      { key: "grossAmount", header: "المبلغ الإجمالي", format: "money", align: "end", total: true, value: (row) => row.grossAmount },
      { key: "ratePercent", header: "النسبة %", format: "percent", align: "end", value: (row) => row.ratePercent },
      { key: "withheldAmount", header: "الضريبة المستقطعة", format: "money", align: "end", total: true, value: (row) => row.withheldAmount },
      { key: "netPaidAmount", header: "الصافي المدفوع", format: "money", align: "end", total: true, value: (row) => row.netPaidAmount },
    ],
    kpis: [
      { key: "withheldAmount", labelAr: "إجمالي المستقطع", format: "money", value: (rows) => sumRows(rows, (r) => r.withheldAmount) },
      { key: "grossAmount", labelAr: "إجمالي المدفوعات", format: "money", value: (rows) => sumRows(rows, (r) => r.grossAmount) },
      { key: "netPaidAmount", labelAr: "الصافي المدفوع", format: "money", value: (rows) => sumRows(rows, (r) => r.netPaidAmount) },
      { key: "voucherCount", labelAr: "عدد السندات", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      labelColumn: "partyNameAr",
      valueColumn: "withheldAmount",
      aggregate: true,
      maxPoints: 8,
      captionAr: "الموردون مرتبون حسب ما استُقطع من مدفوعاتهم.",
    },
    run: (params, ctx) =>
      ctx.rows
        .filter((r) => r.date >= params.fromDate && r.date <= params.toDate)
        .filter((r) => r.withheldAmount.scaled > 0n)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((r) => ({
          voucherId: r.voucherId,
          partyId: r.partyId,
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
