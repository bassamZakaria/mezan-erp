import { z } from "zod";
import { Money } from "../money/index.js";
import type { InstallmentLine, InstallmentPlanDocument } from "../installments/index.js";
import type { Customer } from "../customers/customer.js";
import type { ReportDefinition } from "./types.js";

/**
 * نظرة عامة على الأقساط — Installments Overview (docs/catalog/08-reports.md):
 * portfolio status and collection rate per confirmed plan
 * (`InstallmentPlanDocument` — packages/domain/src/installments/, the real
 * document-framework aggregate `afacfc1`/#27 shipped). A plan carries no
 * header-level customer/total — every `InstallmentLine` denormalizes those,
 * so this report resolves them the same way `installments-routes.ts` does:
 * from the plan's first line + `ctx.customers`. No filter panel in the
 * catalog capture (empty tenant) — this definition carries an empty params
 * schema so the engine's normal validate → run pipeline still applies.
 */

export interface InstallmentsOverviewContext {
  readonly plans: readonly InstallmentPlanDocument[];
  readonly customers: readonly Customer[];
}

export type InstallmentsOverviewParams = Record<string, never>;

export interface InstallmentsOverviewRow {
  readonly planId: string;
  readonly planNo: string;
  readonly customerNameAr: string;
  readonly totalAmount: number;
  readonly percentPaid: number;
  readonly remaining: number;
  readonly installmentsCount: number;
  readonly overdueCount: number;
  readonly startDate: string;
  readonly statusLabel: string;
}

const paramsSchema = z.object({});

/** Plan-wide totals from its (denormalized) lines — mirrors installment-plan-document.ts's private `totals()`. */
function planTotals(lines: readonly InstallmentLine[]) {
  const scheduled = Money.sum(lines.map((l) => l.amount));
  const paid = Money.sum(lines.map((l) => l.paidAmount));
  const downPayment = lines[0]?.downPayment ?? Money.zero();
  const grandTotal = scheduled.add(downPayment);
  return { grandTotal, paid, remaining: Money.fromScaled(grandTotal.scaled - paid.scaled) };
}

function isLineOverdue(line: InstallmentLine, asOfDate: string): boolean {
  return line.status !== "paid" && line.status !== "cancelled" && line.dueDate < asOfDate;
}

export function createInstallmentsOverviewReport(
  today: string,
): ReportDefinition<InstallmentsOverviewParams, InstallmentsOverviewRow, InstallmentsOverviewContext> {
  return {
    id: "installments.overview",
    titleAr: "نظرة عامة على الأقساط",
    descriptionAr: "ما وضع المحفظة الآن — الخطط النشطة ونسبة التحصيل في كل خطة.",
    paramsSchema,
    defaultParams: {},
    paramFields: [],
    rowKey: (row) => row.planId,
    columns: [
      { key: "planNo", header: "رقم الخطة", format: "text", value: (row) => row.planNo },
      { key: "customerNameAr", header: "العميل", format: "text", value: (row) => row.customerNameAr },
      { key: "totalAmount", header: "المبلغ الكلي", format: "money", align: "end", total: true, value: (row) => row.totalAmount },
      { key: "percentPaid", header: "نسبة السداد", format: "percent", align: "end", value: (row) => row.percentPaid },
      { key: "remaining", header: "المبلغ المتبقي", format: "money", align: "end", total: true, value: (row) => row.remaining },
      { key: "installmentsCount", header: "الأقساط", format: "qty", align: "end", value: (row) => row.installmentsCount },
      { key: "startDate", header: "تاريخ البدء", format: "date", value: (row) => row.startDate },
      { key: "statusLabel", header: "الحالة", format: "text", value: (row) => row.statusLabel },
    ],
    run: (_params, ctx) => {
      const customerNames = new Map(ctx.customers.map((c) => [c.id, c.nameAr]));
      return ctx.plans
        .filter((plan) => plan.status === "confirmed")
        .map((plan) => {
          const { grandTotal, paid, remaining } = planTotals(plan.lines);
          const customerId = plan.lines[0]?.customerId ?? "";
          return {
            planId: plan.id,
            planNo: plan.docNo ?? plan.id,
            customerNameAr: customerNames.get(customerId) ?? customerId,
            totalAmount: Number(grandTotal.toString()),
            percentPaid: grandTotal.scaled === 0n ? 0 : (Number(paid.scaled) / Number(grandTotal.scaled)) * 100,
            remaining: Number(remaining.toString()),
            installmentsCount: plan.lines.length,
            overdueCount: plan.lines.filter((line) => isLineOverdue(line, today)).length,
            startDate: plan.date,
            statusLabel: remaining.scaled <= 0n ? "مكتملة" : "نشطة",
          };
        })
        .sort((a, b) => b.remaining - a.remaining);
    },
  };
}
