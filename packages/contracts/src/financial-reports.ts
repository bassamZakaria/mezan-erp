import { z } from "zod";

/**
 * Wire contracts for the seven financial statements (docs/catalog/08-reports.md
 * — القوائم المالية), served by `/financial-reports/*` over the live posted
 * general ledger. Every endpoint answers with the report engine's
 * `RunReportOutcome`: the echoed params, the rows, the per-group subtotals, the
 * grand totals and the GL-reconciliation banner. `reportRunSchema` models that
 * envelope once; each statement only contributes its params + row shape.
 */

export const reportValidationErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const reportValidationFailureSchema = z.object({
  error: z.literal("VALIDATION_ERROR"),
  errors: z.array(reportValidationErrorSchema),
});

export const reportReconciliationSchema = z.object({
  labelAr: z.string(),
  reportTotal: z.number(),
  referenceTotal: z.number(),
  diff: z.number(),
  withinTolerance: z.boolean(),
});

const totalsSchema = z.record(z.string(), z.number());

export function reportGroupSchema<Row extends z.ZodTypeAny>(row: Row) {
  return z.object({
    key: z.string(),
    label: z.string(),
    rows: z.array(row),
    totals: totalsSchema,
  });
}

/** The success envelope every `/financial-reports/*` endpoint returns. */
export function reportRunSchema<Params extends z.ZodTypeAny, Row extends z.ZodTypeAny>(params: Params, row: Row) {
  return z.object({
    params,
    rows: z.array(row),
    groups: z.array(reportGroupSchema(row)),
    grandTotals: totalsSchema,
    reconciliation: reportReconciliationSchema.nullable(),
  });
}

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const asOfDateParamsSchema = z.object({ asOfDate: isoDateSchema });
export const periodParamsSchema = z.object({ periodFrom: isoDateSchema, periodTo: isoDateSchema });
export const accountPeriodParamsSchema = periodParamsSchema.extend({ accountId: z.string().min(1) });

// --- ميزان المراجعة ------------------------------------------------------

export const trialBalanceRowSchema = z.object({
  accountId: z.string(),
  code: z.string(),
  nameAr: z.string(),
  typeLabel: z.string(),
  debit: z.number(),
  credit: z.number(),
});
export const trialBalanceReportSchema = reportRunSchema(asOfDateParamsSchema, trialBalanceRowSchema);

// --- قائمة الدخل ---------------------------------------------------------

export const incomeStatementRowSchema = z.object({
  accountId: z.string(),
  code: z.string(),
  nameAr: z.string(),
  sectionKey: z.string(),
  sectionLabel: z.string(),
  amount: z.number(),
});
export const incomeStatementReportSchema = reportRunSchema(periodParamsSchema, incomeStatementRowSchema);

// --- الميزانية العمومية --------------------------------------------------

export const balanceSheetSideSchema = z.enum(["asset", "liability-equity"]);
export const balanceSheetRowSchema = z.object({
  rowId: z.string(),
  code: z.string(),
  nameAr: z.string(),
  sectionKey: z.string(),
  sectionLabel: z.string(),
  amount: z.number(),
  side: balanceSheetSideSchema,
});
export const balanceSheetReportSchema = reportRunSchema(asOfDateParamsSchema, balanceSheetRowSchema);

// --- التدفقات النقدية ----------------------------------------------------

export const cashFlowActivitySchema = z.enum(["operating", "investing", "financing"]);
export const cashFlowRowSchema = z.object({
  rowId: z.string(),
  activity: cashFlowActivitySchema,
  activityLabel: z.string(),
  label: z.string(),
  amount: z.number(),
  openingCash: z.number(),
  closingCash: z.number(),
});
export const cashFlowReportSchema = reportRunSchema(periodParamsSchema, cashFlowRowSchema);

// --- إقرار ضريبة القيمة المضافة ------------------------------------------

export const vatSideSchema = z.enum(["output", "input"]);
export const vatReturnRowSchema = z.object({
  rowId: z.string(),
  side: vatSideSchema,
  sideLabel: z.string(),
  rate: z.number(),
  base: z.number(),
  tax: z.number(),
});
export const vatReturnReportSchema = reportRunSchema(periodParamsSchema, vatReturnRowSchema);

// --- دفتر الأستاذ العام --------------------------------------------------

export const generalLedgerRowSchema = z.object({
  rowId: z.string(),
  date: z.string(),
  entryNo: z.string(),
  accountKey: z.string(),
  accountLabel: z.string(),
  memo: z.string(),
  debit: z.number(),
  credit: z.number(),
});
export const generalLedgerReportSchema = reportRunSchema(periodParamsSchema, generalLedgerRowSchema);

// --- دفتر حساب -----------------------------------------------------------

export const accountLedgerRowSchema = z.object({
  rowId: z.string(),
  date: z.string(),
  entryNo: z.string(),
  memo: z.string(),
  debit: z.number(),
  credit: z.number(),
  balance: z.number(),
  isOpening: z.boolean(),
  accountId: z.string(),
  periodTo: z.string(),
});
export const accountLedgerReportSchema = reportRunSchema(accountPeriodParamsSchema, accountLedgerRowSchema);

export type ReportValidationErrorDTO = z.infer<typeof reportValidationErrorSchema>;
export type ReportValidationFailureDTO = z.infer<typeof reportValidationFailureSchema>;
export type ReportReconciliationDTO = z.infer<typeof reportReconciliationSchema>;
export type AsOfDateParamsDTO = z.infer<typeof asOfDateParamsSchema>;
export type PeriodParamsDTO = z.infer<typeof periodParamsSchema>;
export type AccountPeriodParamsDTO = z.infer<typeof accountPeriodParamsSchema>;
export type TrialBalanceRowDTO = z.infer<typeof trialBalanceRowSchema>;
export type TrialBalanceReportDTO = z.infer<typeof trialBalanceReportSchema>;
export type IncomeStatementRowDTO = z.infer<typeof incomeStatementRowSchema>;
export type IncomeStatementReportDTO = z.infer<typeof incomeStatementReportSchema>;
export type BalanceSheetSideDTO = z.infer<typeof balanceSheetSideSchema>;
export type BalanceSheetRowDTO = z.infer<typeof balanceSheetRowSchema>;
export type BalanceSheetReportDTO = z.infer<typeof balanceSheetReportSchema>;
export type CashFlowActivityDTO = z.infer<typeof cashFlowActivitySchema>;
export type CashFlowRowDTO = z.infer<typeof cashFlowRowSchema>;
export type CashFlowReportDTO = z.infer<typeof cashFlowReportSchema>;
export type VatSideDTO = z.infer<typeof vatSideSchema>;
export type VatReturnRowDTO = z.infer<typeof vatReturnRowSchema>;
export type VatReturnReportDTO = z.infer<typeof vatReturnReportSchema>;
export type GeneralLedgerRowDTO = z.infer<typeof generalLedgerRowSchema>;
export type GeneralLedgerReportDTO = z.infer<typeof generalLedgerReportSchema>;
export type AccountLedgerRowDTO = z.infer<typeof accountLedgerRowSchema>;
export type AccountLedgerReportDTO = z.infer<typeof accountLedgerReportSchema>;
