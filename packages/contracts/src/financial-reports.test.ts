import { describe, it, expect } from "vitest";
import {
  reportValidationErrorSchema,
  reportValidationFailureSchema,
  reportReconciliationSchema,
  reportGroupSchema,
  reportRunSchema,
  asOfDateParamsSchema,
  periodParamsSchema,
  accountPeriodParamsSchema,
  trialBalanceRowSchema,
  trialBalanceReportSchema,
  incomeStatementReportSchema,
  balanceSheetSideSchema,
  balanceSheetRowSchema,
  balanceSheetReportSchema,
  cashFlowActivitySchema,
  cashFlowRowSchema,
  vatSideSchema,
  vatReturnRowSchema,
  generalLedgerRowSchema,
  dayBookRowSchema,
  dayBookReportSchema,
  accountLedgerRowSchema,
  accountLedgerReportSchema,
} from "./financial-reports.js";

describe("reportValidationErrorSchema", () => {
  it("accepts a minimal valid error and preserves every field verbatim", () => {
    const error = { field: "periodFrom", message: "required" };
    const result = reportValidationErrorSchema.safeParse(error);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(error);
  });

  it("rejects an error missing message", () => {
    const result = reportValidationErrorSchema.safeParse({ field: "periodFrom" });
    expect(result.success).toBe(false);
  });
});

describe("reportValidationFailureSchema", () => {
  it("accepts a minimal valid failure and preserves every field verbatim", () => {
    const failure = { error: "VALIDATION_ERROR" as const, errors: [{ field: "periodFrom", message: "required" }] };
    const result = reportValidationFailureSchema.safeParse(failure);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(failure);
  });

  it("rejects an error other than the literal VALIDATION_ERROR", () => {
    const result = reportValidationFailureSchema.safeParse({ error: "NOT_FOUND", errors: [] });
    expect(result.success).toBe(false);
  });
});

describe("reportReconciliationSchema", () => {
  const recon = { labelAr: "إجمالي القيد", reportTotal: 100000, referenceTotal: 100000, diff: 0, withinTolerance: true };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = reportReconciliationSchema.safeParse(recon);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(recon);
  });

  it("accepts a non-zero diff outside tolerance", () => {
    const result = reportReconciliationSchema.safeParse({ ...recon, diff: 50, withinTolerance: false });
    expect(result.success).toBe(true);
  });

  it("rejects reportTotal sent as a decimal string instead of a number — report figures are plain numbers here, unlike ledger money fields", () => {
    const result = reportReconciliationSchema.safeParse({ ...recon, reportTotal: "100000" });
    expect(result.success).toBe(false);
  });
});

describe("asOfDateParamsSchema / periodParamsSchema / accountPeriodParamsSchema", () => {
  it("accepts a minimal valid asOfDate payload", () => {
    const result = asOfDateParamsSchema.safeParse({ asOfDate: "2026-08-30" });
    expect(result.success).toBe(true);
  });

  it("rejects a non-ISO asOfDate", () => {
    const result = asOfDateParamsSchema.safeParse({ asOfDate: "30/08/2026" });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid period payload", () => {
    const result = periodParamsSchema.safeParse({ periodFrom: "2026-08-01", periodTo: "2026-08-31" });
    expect(result.success).toBe(true);
  });

  it("does NOT enforce periodFrom <= periodTo — an inverted range is not refused by this schema", () => {
    const result = periodParamsSchema.safeParse({ periodFrom: "2026-08-31", periodTo: "2026-08-01" });
    expect(result.success).toBe(true);
  });

  it("accountPeriodParamsSchema extends period params with a required accountId", () => {
    const result = accountPeriodParamsSchema.safeParse({ periodFrom: "2026-08-01", periodTo: "2026-08-31", accountId: "acc-1" });
    expect(result.success).toBe(true);
  });

  it("accountPeriodParamsSchema rejects a payload missing accountId", () => {
    const result = accountPeriodParamsSchema.safeParse({ periodFrom: "2026-08-01", periodTo: "2026-08-31" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("accountId");
  });
});

describe("reportGroupSchema (generic)", () => {
  const group = reportGroupSchema(trialBalanceRowSchema);
  const row = { accountId: "acc-1", code: "1000", nameAr: "النقدية", nameEn: null, typeLabel: "أصول", debit: 1000, credit: 0 };

  it("accepts a minimal valid group and preserves every field verbatim", () => {
    const result = group.safeParse({ key: "assets", label: "الأصول", rows: [row], totals: { debit: 1000, credit: 0 } });
    expect(result.success).toBe(true);
  });

  it("rejects a row that doesn't match the parameterized row schema", () => {
    const result = group.safeParse({ key: "assets", label: "الأصول", rows: [{ bad: "row" }], totals: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a totals value sent as a decimal string instead of a number", () => {
    const result = group.safeParse({ key: "assets", label: "الأصول", rows: [row], totals: { debit: "1000" } });
    expect(result.success).toBe(false);
  });
});

describe("trialBalanceReportSchema (a reportRunSchema instantiation)", () => {
  const row = { accountId: "acc-1", code: "1000", nameAr: "النقدية", nameEn: null, typeLabel: "أصول", debit: 1000, credit: 0 };
  const report = {
    params: { asOfDate: "2026-08-30" },
    rows: [row],
    groups: [{ key: "assets", label: "الأصول", rows: [row], totals: { debit: 1000, credit: 0 } }],
    grandTotals: { debit: 1000, credit: 1000 },
    reconciliation: { labelAr: "التوازن", reportTotal: 1000, referenceTotal: 1000, diff: 0, withinTolerance: true },
  };

  it("accepts a minimal valid report and preserves every field verbatim", () => {
    const result = trialBalanceReportSchema.safeParse(report);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(report);
  });

  it("accepts a null reconciliation when the report has none to offer", () => {
    const result = trialBalanceReportSchema.safeParse({ ...report, reconciliation: null });
    expect(result.success).toBe(true);
  });

  it("rejects a report missing grandTotals", () => {
    const { grandTotals, ...rest } = report;
    const result = trialBalanceReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("grandTotals");
  });

  it("rejects params with a non-ISO asOfDate — the params schema is validated too, not just the rows", () => {
    const result = trialBalanceReportSchema.safeParse({ ...report, params: { asOfDate: "30/08/2026" } });
    expect(result.success).toBe(false);
  });

  it("rejects debit sent as a decimal string instead of a number", () => {
    const badRow = { ...row, debit: "1000" };
    const result = trialBalanceReportSchema.safeParse({ ...report, rows: [badRow] });
    expect(result.success).toBe(false);
  });
});

describe("incomeStatementReportSchema", () => {
  it("accepts a minimal valid report using period params", () => {
    const row = { accountId: "acc-1", code: "4000", nameAr: "الإيرادات", nameEn: null, sectionKey: "revenue", sectionLabel: "الإيرادات", amount: 100000 };
    const result = incomeStatementReportSchema.safeParse({
      params: { periodFrom: "2026-08-01", periodTo: "2026-08-31" },
      rows: [row],
      groups: [],
      grandTotals: {},
      reconciliation: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("balanceSheetSideSchema / balanceSheetRowSchema", () => {
  it("accepts asset and liability-equity", () => {
    expect(balanceSheetSideSchema.safeParse("asset").success).toBe(true);
    expect(balanceSheetSideSchema.safeParse("liability-equity").success).toBe(true);
  });

  it("rejects a side outside the enum", () => {
    expect(balanceSheetSideSchema.safeParse("equity").success).toBe(false);
  });

  it("balanceSheetRowSchema accepts a minimal valid row", () => {
    const row = { rowId: "r1", code: "1000", nameAr: "النقدية", nameEn: null, sectionKey: "current_assets", sectionLabel: "أصول متداولة", amount: 5000, side: "asset" as const };
    const result = balanceSheetRowSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it("balanceSheetReportSchema uses asOfDate params, not a period", () => {
    const row = { rowId: "r1", code: "1000", nameAr: "النقدية", nameEn: null, sectionKey: "current_assets", sectionLabel: "أصول متداولة", amount: 5000, side: "asset" as const };
    const result = balanceSheetReportSchema.safeParse({
      params: { asOfDate: "2026-08-30" },
      rows: [row],
      groups: [],
      grandTotals: {},
      reconciliation: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("cashFlowActivitySchema / cashFlowRowSchema", () => {
  it("accepts operating, investing and financing", () => {
    for (const a of ["operating", "investing", "financing"]) {
      expect(cashFlowActivitySchema.safeParse(a).success).toBe(true);
    }
  });

  it("rejects an activity outside the enum", () => {
    expect(cashFlowActivitySchema.safeParse("other").success).toBe(false);
  });

  it("cashFlowRowSchema accepts a minimal valid row", () => {
    const row = { rowId: "r1", activity: "operating" as const, activityLabel: "التشغيل", label: "تحصيلات من العملاء", amount: 50000, openingCash: 10000, closingCash: 60000 };
    const result = cashFlowRowSchema.safeParse(row);
    expect(result.success).toBe(true);
  });
});

describe("vatSideSchema / vatReturnRowSchema", () => {
  it("accepts output and input", () => {
    expect(vatSideSchema.safeParse("output").success).toBe(true);
    expect(vatSideSchema.safeParse("input").success).toBe(true);
  });

  it("vatReturnRowSchema accepts a minimal valid row", () => {
    const row = { rowId: "r1", side: "output" as const, sideLabel: "مخرجات", rate: 14, base: 10000, tax: 1400 };
    const result = vatReturnRowSchema.safeParse(row);
    expect(result.success).toBe(true);
  });
});

describe("generalLedgerRowSchema", () => {
  const row = { rowId: "r1", date: "2026-08-30", entryNo: "JE-2026-001", accountKey: "1000", accountLabel: "النقدية", memo: "sale", debit: 1000, credit: 0 };

  it("accepts a minimal valid row and preserves every field verbatim", () => {
    const result = generalLedgerRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("rejects a row missing entryNo", () => {
    const { entryNo, ...rest } = row;
    const result = generalLedgerRowSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("dayBookRowSchema / dayBookReportSchema (#126)", () => {
  const row = {
    rowId: "je-1:0",
    entryId: "je-1",
    date: "2026-08-30",
    entryNo: "JE-000001",
    entryLabel: "JE-000001 — 2026-08-30",
    accountCode: "1100",
    accountNameAr: "النقدية",
    accountNameEn: null,
    memo: "بيع",
    sourceRef: "INV-000014",
    debit: "1250.500000",
    credit: "0.000000",
  };

  it("accepts a row whose money is an exact decimal string", () => {
    expect(dayBookRowSchema.safeParse(row).success).toBe(true);
  });

  it("rejects money sent as a float", () => {
    expect(dayBookRowSchema.safeParse({ ...row, debit: 1250.5 }).success).toBe(false);
  });

  it("accepts a balanced envelope and an empty period totalling zero", () => {
    const totals = { debit: "1250.500000", credit: "1250.500000" };
    const reconciliation = { labelAr: "إجمالي المدين = إجمالي الدائن", reportTotal: "1250.500000", referenceTotal: "1250.500000", diff: "0.000000", withinTolerance: true };
    const params = { periodFrom: "2026-08-01", periodTo: "2026-08-31" };
    expect(dayBookReportSchema.safeParse({ params, rows: [row], groups: [{ key: "je-1", label: row.entryLabel, rows: [row], totals }], grandTotals: totals, reconciliation }).success).toBe(true);
    expect(dayBookReportSchema.safeParse({ params, rows: [], groups: [], grandTotals: { debit: 0, credit: 0 }, reconciliation: { ...reconciliation, reportTotal: "0.000000", referenceTotal: "0.000000" } }).success).toBe(true);
  });
});

describe("accountLedgerRowSchema / accountLedgerReportSchema", () => {
  const row = {
    rowId: "r1",
    date: "2026-08-30",
    entryNo: "JE-2026-001",
    memo: "opening balance",
    debit: 1000,
    credit: 0,
    balance: 1000,
    isOpening: true,
    accountId: "acc-1",
    periodTo: "2026-08-31",
  };

  it("accountLedgerRowSchema accepts a minimal valid row and preserves every field verbatim", () => {
    const result = accountLedgerRowSchema.safeParse(row);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("accountLedgerReportSchema uses accountPeriodParamsSchema, requiring accountId in params", () => {
    const result = accountLedgerReportSchema.safeParse({
      params: { periodFrom: "2026-08-01", periodTo: "2026-08-31", accountId: "acc-1" },
      rows: [row],
      groups: [],
      grandTotals: {},
      reconciliation: null,
    });
    expect(result.success).toBe(true);
  });

  it("accountLedgerReportSchema rejects params missing accountId", () => {
    const result = accountLedgerReportSchema.safeParse({
      params: { periodFrom: "2026-08-01", periodTo: "2026-08-31" },
      rows: [row],
      groups: [],
      grandTotals: {},
      reconciliation: null,
    });
    expect(result.success).toBe(false);
  });
});
