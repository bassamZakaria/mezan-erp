/**
 * مقارنة النظام المبسط بالنظام العادي — what the SAME year costs under each
 * regime, so an owner can see the difference instead of being told about it.
 *
 * Both sides are read off work Mezan already does: turnover comes from the
 * `sales.by-period` report (the SAME aggregation the sales screen shows, not a
 * second one), and profit comes from the `accounting.income-statement` rows
 * over the same window. Two reports that disagree about the year would be two
 * answers; this one has none of its own.
 *
 * It prices only what it can source. Stamp duty, the development fee, dividend
 * and capital-gains tax and the withholding system are all lifted by the
 * regime and all left at "—" with the article cited: Mezan does not hold the
 * facts to price them, and a plausible number is exactly what a bug looks like.
 */

import { z } from "zod";
import { Money } from "../money/index.js";
import type { ReportDefinition } from "../reports/types.js";
import { isoDateParamSchema } from "../reports/iso-date.js";
import { createSalesByPeriodReport, type SalesByPeriodContext } from "../reports/sales-by-period.js";
import { type GlReportContext, classifyAccount, netBalancesByAccount, moneyToNumber } from "../reports/gl-shared.js";
import { sumRows } from "../reports/kpi.js";
import { simplifiedRegimeScheduleOn, type SimplifiedRegimeSchedule } from "./simplified-regime-schedule.js";
import { computeSimplifiedRegimeLiability, taxOnBase } from "./simplified-regime.js";

export interface SimplifiedRegimeComparisonContext extends SalesByPeriodContext, GlReportContext {}

/**
 * No branch parameter, deliberately. An invoice always carries its branch; a
 * journal line carries one only where DEC-20's attribution has reached that
 * posting path, so a great deal of the ledger is still unattributed. Narrowing
 * would therefore shrink the turnover side in full and the profit side only
 * partly, and the difference between them would be a figure about two
 * different companies.
 */
export interface SimplifiedRegimeComparisonParams {
  readonly periodFrom: string;
  readonly periodTo: string;
}

export interface SimplifiedRegimeComparisonRow {
  readonly key: string;
  readonly item: string;
  readonly basis: string;
  /** Null where the charge exists but Mezan cannot price it from the books it holds. */
  readonly simplified: number | null;
  readonly normal: number | null;
  readonly difference: number | null;
  readonly source: string;
}

const paramsSchema = z
  .object({
    periodFrom: isoDateParamSchema,
    periodTo: isoDateParamSchema,
  })
  .refine((p) => p.periodFrom <= p.periodTo, {
    message: "تاريخ البداية يجب أن يسبق تاريخ النهاية",
    path: ["periodFrom"],
  });

const BASE_ROW_KEY = "base";

function moneyOf(value: number): Money {
  return Money.fromScaled(Math.round(value * 1e6));
}

/** Adds a column over the CHARGE rows only, leaving the tax-base row out of every total. */
function chargesOnly(
  pick: (row: SimplifiedRegimeComparisonRow) => number | null,
): (rows: readonly SimplifiedRegimeComparisonRow[]) => number {
  return (rows) => sumRows(rows.filter((row) => row.key !== BASE_ROW_KEY), pick);
}

/**
 * Turnover for the window, taken from `sales.by-period`'s own rows and stripped
 * of VAT.
 *
 * WHICH FIGURE IS "حجم الأعمال" IS THE OPEN QUESTION. The statute charges gross
 * turnover; Mezan reads that as invoiced revenue after discount and BEFORE
 * VAT, which is `net − tax` on that report's rows. It has not been confirmed
 * against the Arabic text whether VAT, returns or exports belong in the base,
 * which is why every liability this produces is labelled an estimate.
 */
export function turnoverForWindow(
  ctx: SalesByPeriodContext,
  params: { readonly periodFrom: string; readonly periodTo: string },
): Money {
  const definition = createSalesByPeriodReport(params.periodFrom, params.periodTo);
  const rows = definition.run(
    { dateFrom: params.periodFrom, dateTo: params.periodTo, groupBy: "month", branchId: "" },
    ctx,
  );
  const net = sumRows(rows, (row) => row.net);
  const tax = sumRows(rows, (row) => row.tax);
  return moneyOf(net).add(moneyOf(tax).negate());
}

/** Net profit for the window, on the income statement's own sign convention. */
export function netProfitForWindow(ctx: GlReportContext, range: { readonly from: string; readonly to: string }): Money {
  const balances = netBalancesByAccount(ctx.journalEntries, range, { excludeYearEndClose: true });
  let profit = Money.zero();
  for (const account of ctx.accounts) {
    if (account.isHeader) continue;
    const section = classifyAccount(account, ctx.cashAccountIds);
    if (section !== "revenue" && section !== "expense") continue;
    // A revenue account carries a CREDIT balance, so the income statement's
    // "positive is revenue" convention is the negated net movement.
    profit = profit.add(Money.fromScaled(Math.round(-moneyToNumber(balances.get(account.id) ?? Money.zero()) * 1e6)));
  }
  return profit;
}

export function createSimplifiedRegimeComparisonReport(
  defaultPeriodFrom: string,
  defaultPeriodTo: string,
  scheduleOn: (day: string) => SimplifiedRegimeSchedule | null = simplifiedRegimeScheduleOn,
): ReportDefinition<SimplifiedRegimeComparisonParams, SimplifiedRegimeComparisonRow, SimplifiedRegimeComparisonContext> {
  return {
    id: "tax.simplified-regime-comparison",
    titleAr: "مقارنة النظام الضريبي المبسط بالنظام العادي",
    descriptionAr:
      "تقدير استرشادي لما تدفعه المنشأة عن نفس الفترة تحت النظام المبسط مقابل النظام العادي. ليس إقراراً ولا رقماً نهائياً — راجعه مع محاسبك القانوني.",
    paramsSchema,
    defaultParams: { periodFrom: defaultPeriodFrom, periodTo: defaultPeriodTo },
    paramFields: [{ kind: "dateRange", fromKey: "periodFrom", toKey: "periodTo", label: "السنة الضريبية" }],
    rowKey: (row) => row.key,
    columns: [
      { key: "item", header: "البند", format: "text", value: (row) => row.item },
      { key: "basis", header: "الأساس", format: "text", value: (row) => row.basis },
      // The base row holds turnover and profit, not a charge. Summing it into
      // the tax column would add a year's sales to a year's tax and print the
      // answer as "what you pay" — the shape of the VAT-return grand total that
      // once told the dashboard 24,983 was payable on a refundable return.
      { key: "simplified", header: "النظام المبسط", format: "money", align: "end", total: true, value: (row) => row.simplified, grandTotal: chargesOnly((row) => row.simplified) },
      { key: "normal", header: "النظام العادي", format: "money", align: "end", total: true, value: (row) => row.normal, grandTotal: chargesOnly((row) => row.normal) },
      { key: "difference", header: "الفرق", format: "variance", align: "end", total: true, value: (row) => row.difference, grandTotal: chargesOnly((row) => row.difference) },
    ],
    kpis: [
      { key: "simplified", labelAr: "الإجمالي تحت النظام المبسط", format: "money", value: chargesOnly((r) => r.simplified) },
      { key: "normal", labelAr: "الإجمالي تحت النظام العادي", format: "money", value: chargesOnly((r) => r.normal) },
      {
        key: "difference",
        labelAr: "الوفر المقدَّر",
        hintAr: "النظام العادي − النظام المبسط، على البنود التي يمكن تسعيرها فقط",
        format: "money",
        value: (rows) => -chargesOnly((r: SimplifiedRegimeComparisonRow) => r.difference)(rows),
        tone: (value) => (value >= 0 ? "success" : "danger"),
      },
    ],
    run: (params, ctx) => {
      const schedule = scheduleOn(params.periodTo);
      if (schedule === null) return [];

      const turnover = turnoverForWindow(ctx, params);
      const profit = netProfitForWindow(ctx, { from: params.periodFrom, to: params.periodTo });
      const liability = computeSimplifiedRegimeLiability(schedule, turnover);
      // A loss bears no income tax under the ordinary law; charging 22.5% of a
      // negative profit would hand the comparison a refund that does not exist.
      const taxableProfit = profit.scaled > 0n ? profit : Money.zero();
      const normalIncomeTax = taxOnBase(taxableProfit, schedule.normalIncomeTaxPercent.value);

      const simplifiedIncomeTax = liability.tax;
      const rows: SimplifiedRegimeComparisonRow[] = [
        {
          key: BASE_ROW_KEY,
          item: "الوعاء الضريبي",
          basis: "حجم الأعمال مقابل صافي الربح",
          simplified: moneyToNumber(turnover),
          normal: moneyToNumber(profit),
          difference: null,
          source: schedule.turnoverCeiling.source,
        },
        {
          key: "incomeTax",
          item: "ضريبة الدخل",
          basis:
            liability.ratePercent === null
              ? "خارج حدود النظام المبسط"
              : `${liability.ratePercent}% من حجم الأعمال مقابل ${schedule.normalIncomeTaxPercent.value}% من صافي الربح`,
          simplified: simplifiedIncomeTax === null ? null : moneyToNumber(simplifiedIncomeTax),
          normal: moneyToNumber(normalIncomeTax),
          difference:
            simplifiedIncomeTax === null
              ? null
              : moneyToNumber(Money.fromScaled(simplifiedIncomeTax.scaled - normalIncomeTax.scaled)),
          source: `${liability.sources.join(" / ")} — ${schedule.normalIncomeTaxPercent.source}`,
        },
        ...schedule.exemptions.value
          .filter((exemption) => exemption.key !== "auditDeferral" && exemption.key !== "payrollAnnual")
          .map((exemption) => ({
            key: exemption.key,
            item: exemption.labelAr,
            basis: "معفى تحت النظام المبسط — لا تحسب مزان قيمته تحت النظام العادي",
            simplified: null,
            normal: null,
            difference: null,
            source: exemption.source,
          })),
      ];
      return rows;
    },
  };
}
