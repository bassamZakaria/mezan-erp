import { z } from "zod";
import { Money } from "../money/index.js";
import type { InstallmentLine, InstallmentPlanDocument } from "../installments/index.js";
import type { Customer } from "../customers/customer.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countDistinct, maxOf } from "./kpi.js";

/**
 * الأقساط المتأخرة — Overdue Installments (docs/archive/catalog/08-reports.md):
 * every overdue schedule line across every confirmed plan
 * (`InstallmentPlanDocument`, packages/domain/src/installments/), ranked by
 * urgency (days late, descending) — the standard 4-bucket overdue ladder
 * (1-30 / 31-60 / 61-90 / 91+ يوم) as a filter chip. Recomputed dynamically
 * from `dueDate`/`status` at the report's `asOfDate` rather than trusting a
 * line's stored "overdue" status (set only when the معالجة المتأخرات batch —
 * `processOverdueInstallments` — last ran), so the report is correct even
 * between batch runs.
 */

export type OverdueBucket = "1to30" | "31to60" | "61to90" | "over90";

function bucketOf(days: number): OverdueBucket {
  if (days <= 30) return "1to30";
  if (days <= 60) return "31to60";
  if (days <= 90) return "61to90";
  return "over90";
}

export interface InstallmentsOverdueContext {
  readonly plans: readonly InstallmentPlanDocument[];
  readonly customers: readonly Customer[];
}

export interface InstallmentsOverdueParams {
  readonly asOfDate: string;
  readonly bucket: "" | OverdueBucket;
}

export interface InstallmentsOverdueRow {
  readonly rank: number;
  readonly lineId: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  /** The English name, so the report can be read in English (D57). Null when the record has none. */
  readonly customerNameEn: string | null;
  readonly planNo: string;
  readonly amount: number;
  readonly remaining: number;
  readonly dueDate: string;
  readonly daysLate: number;
}

const paramsSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح"),
  bucket: z.enum(["", "1to30", "31to60", "61to90", "over90"]),
});

function isLineOverdue(line: InstallmentLine, asOfDate: string): boolean {
  return line.status !== "paid" && line.status !== "cancelled" && line.dueDate < asOfDate;
}

function daysLate(line: InstallmentLine, asOfDate: string): number {
  const due = Date.parse(`${line.dueDate}T00:00:00Z`);
  const asOf = Date.parse(`${asOfDate}T00:00:00Z`);
  return Math.max(0, Math.round((asOf - due) / 86_400_000));
}

function lineRemaining(line: InstallmentLine): Money {
  const remaining = line.amount.scaled - line.paidAmount.scaled;
  return Money.fromScaled(remaining > 0n ? remaining : 0n);
}

export function createInstallmentsOverdueReport(
  defaultAsOfDate: string,
): ReportDefinition<InstallmentsOverdueParams, InstallmentsOverdueRow, InstallmentsOverdueContext> {
  return {
    id: "installments.overdue",
    titleAr: "الأقساط المتأخرة",
    descriptionAr: "قائمة الأقساط المتأخرة مرتبة حسب الأولوية.",
    paramsSchema,
    defaultParams: { asOfDate: defaultAsOfDate, bucket: "" },
    paramFields: [
      { kind: "date", key: "asOfDate", label: "حتى تاريخ" },
      {
        kind: "select",
        key: "bucket",
        label: "التأخر",
        options: [
          { value: "", label: "الكل" },
          { value: "1to30", label: "1-30 يوم" },
          { value: "31to60", label: "31-60 يوم" },
          { value: "61to90", label: "61-90 يوم" },
          { value: "over90", label: "91+ يوم" },
        ],
      },
    ],
    rowKey: (row) => row.lineId,
    columns: [
      { key: "rank", header: "#", format: "qty", align: "end", value: (row) => row.rank },
      { key: "customerNameAr", header: "اسم العميل", format: "text", value: (row) => row.customerNameAr, entity: { kind: "customer", id: (row) => row.customerId } },
      { key: "planNo", header: "رقم خطة التقسيط", format: "text", value: (row) => row.planNo },
      { key: "amount", header: "المبلغ", format: "money", align: "end", total: true, value: (row) => row.amount },
      { key: "remaining", header: "المبلغ المتبقي", format: "money", align: "end", total: true, value: (row) => row.remaining },
      { key: "dueDate", header: "تاريخ الاستحقاق", format: "date", value: (row) => row.dueDate },
      { key: "daysLate", header: "أيام التأخير", format: "qty", align: "end", value: (row) => row.daysLate },
    ],
    kpis: [
      { key: "remaining", labelAr: "إجمالي المتأخر", format: "money", value: (rows) => sumRows(rows, (r) => r.remaining), tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "lineCount", labelAr: "أقساط متأخرة", format: "qty", value: (rows) => rows.length },
      { key: "customerCount", labelAr: "عملاء متأخرون", format: "qty", value: (rows) => countDistinct(rows, (r) => r.customerId) },
      { key: "maxDaysLate", labelAr: "أطول تأخير (يوم)", format: "qty", value: (rows) => maxOf(rows, (r) => r.daysLate) },
    ],
    chart: {
      labelColumn: "customerNameAr",
      valueColumn: "remaining",
      aggregate: true,
      maxPoints: 8,
      captionAr: "العملاء مرتبون حسب إجمالي المتبقي من أقساطهم المتأخرة.",
    },
    run: (params, ctx) => {
      const customerNames = new Map(ctx.customers.map((c) => [c.id, c.nameAr]));
      const customerNamesEn = new Map(ctx.customers.map((c) => [c.id, c.nameEn ?? null]));
      const rows: Omit<InstallmentsOverdueRow, "rank">[] = [];
      for (const plan of ctx.plans) {
        if (plan.status !== "confirmed") continue;
        for (const line of plan.lines) {
          if (!isLineOverdue(line, params.asOfDate)) continue;
          const days = daysLate(line, params.asOfDate);
          if (params.bucket !== "" && bucketOf(days) !== params.bucket) continue;
          rows.push({
            lineId: `${plan.id}|${line.no}`,
            customerId: line.customerId,
            customerNameAr: customerNames.get(line.customerId) ?? line.customerId,
          customerNameEn: customerNamesEn.get(line.customerId) ?? null,
            planNo: plan.docNo ?? plan.id,
            amount: Number(line.amount.toString()),
            remaining: Number(lineRemaining(line).toString()),
            dueDate: line.dueDate,
            daysLate: days,
          });
        }
      }
      return rows
        .sort((a, b) => b.daysLate - a.daysLate)
        .map((row, i) => ({ rank: i + 1, ...row }));
    },
  };
}
