import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * أعمار ديون العملاء / الموردين — `GET /reports/aging/customers` and
 * `/reports/aging/suppliers`. Every money figure is an exact decimal string
 * (D126, D345); only the percentage and the party count are numbers.
 */
const agingBuckets = {
  current: moneyString,
  d31to60: moneyString,
  d61to90: moneyString,
  d91to120: moneyString,
  over120: moneyString,
  total: moneyString,
};

export const agingCustomersRowSchema = z.object({
  customerId: z.string(),
  customerNameAr: z.string(),
  customerNameEn: z.string().nullable(),
  ...agingBuckets,
});

export const agingSuppliersRowSchema = z.object({
  supplierId: z.string(),
  supplierNameAr: z.string(),
  supplierNameEn: z.string().nullable(),
  ...agingBuckets,
});

export const agingTotalsSchema = z.object(agingBuckets);

export const agingReconciliationSchema = z.object({
  labelAr: z.string(),
  reportTotal: moneyString,
  referenceTotal: moneyString,
  diff: moneyString,
  withinTolerance: z.boolean(),
  reconcilingItems: z.array(z.object({ key: z.string(), labelAr: z.string(), amount: moneyString })).optional(),
});

export enum AgingKpiFormat {
  Money = "money",
  Percent = "percent",
  Qty = "qty",
}

export const agingKpiSchema = z.discriminatedUnion("format", [
  z.object({ key: z.string(), labelAr: z.string(), hintAr: z.string().optional(), format: z.literal(AgingKpiFormat.Money), value: moneyString, tone: z.enum(["default", "success", "danger"]).optional() }),
  z.object({ key: z.string(), labelAr: z.string(), hintAr: z.string().optional(), format: z.literal(AgingKpiFormat.Percent), value: z.number(), tone: z.enum(["default", "success", "danger"]).optional() }),
  z.object({ key: z.string(), labelAr: z.string(), hintAr: z.string().optional(), format: z.literal(AgingKpiFormat.Qty), value: z.number(), tone: z.enum(["default", "success", "danger"]).optional() }),
]);

function agingReportSchema<Row extends z.ZodTypeAny>(row: Row) {
  return z.object({
    params: z.object({ asOfDate: z.string(), branchId: z.string() }),
    rows: z.array(row),
    groups: z.array(z.object({ key: z.string(), label: z.string(), rows: z.array(row), totals: agingTotalsSchema })),
    grandTotals: agingTotalsSchema,
    reconciliation: agingReconciliationSchema.nullable(),
    kpis: z.array(agingKpiSchema),
  });
}

export const agingCustomersReportSchema = agingReportSchema(agingCustomersRowSchema);
export const agingSuppliersReportSchema = agingReportSchema(agingSuppliersRowSchema);

export type AgingCustomersRowDTO = z.infer<typeof agingCustomersRowSchema>;
export type AgingSuppliersRowDTO = z.infer<typeof agingSuppliersRowSchema>;
export type AgingCustomersReportDTO = z.infer<typeof agingCustomersReportSchema>;
export type AgingSuppliersReportDTO = z.infer<typeof agingSuppliersReportSchema>;
