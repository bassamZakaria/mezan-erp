import { describe, it, expect } from "vitest";
import * as reports from "./index.js";

describe("reports/index barrel", () => {
  it("re-exports the report engine functions", () => {
    expect(typeof reports.runReport).toBe("function");
    expect(typeof reports.validateReportParams).toBe("function");
    expect(typeof reports.computeReportGroups).toBe("function");
    expect(typeof reports.computeReconciliation).toBe("function");
  });

  it("re-exports every report factory as a callable function", () => {
    const factories = [
      reports.createTrialBalanceReport,
      reports.createSalesByPeriodReport,
      reports.createSalesByItemReport,
      reports.createSalesByCustomerReport,
      reports.createSalesBySalespersonReport,
      reports.createTopProductsReport,
      reports.createPurchasesByPeriodReport,
      reports.createPurchasesBySupplierReport,
      reports.createPurchasesByItemReport,
      reports.createInventoryStockLevelsReport,
      reports.createInventoryMovementReport,
      reports.createInventoryLedgerReport,
      reports.createInventoryValuationReport,
      reports.createInventoryAgingReport,
      reports.createInventoryExpiringReport,
      reports.createInventorySlowMovingReport,
      reports.createInventoryDriftReport,
      reports.createMakeVsBuyReport,
      reports.createAgingCustomersReport,
      reports.createAgingSuppliersReport,
      reports.createVanSalesReport,
      reports.createInstallmentsOverviewReport,
      reports.createInstallmentsOverdueReport,
      reports.createIncomeStatementReport,
      reports.createBalanceSheetReport,
      reports.createCashFlowReport,
      reports.createVatReturnReport,
      reports.createWithholdingTaxReport,
      reports.createGeneralLedgerReport,
      reports.createAccountLedgerReport,
    ];
    for (const factory of factories) expect(typeof factory).toBe("function");
  });

  it("re-exports the shared GL helpers, wired to the same implementation as gl-shared.ts", () => {
    expect(typeof reports.classifyAccount).toBe("function");
    expect(typeof reports.isCashAccount).toBe("function");
    expect(typeof reports.isLedgerEffective).toBe("function");
    expect(typeof reports.moneyToNumber).toBe("function");
    expect(typeof reports.netBalancesByAccount).toBe("function");
    expect(typeof reports.accountNet).toBe("function");
    expect(reports.ACCOUNT_TYPE_LABELS.asset).toBe("الأصول");
  });

  it("re-exports the KPI arithmetic helpers", () => {
    expect(typeof reports.sumRows).toBe("function");
    expect(typeof reports.diffOf).toBe("function");
    expect(typeof reports.countRows).toBe("function");
    expect(typeof reports.countDistinct).toBe("function");
    expect(typeof reports.maxOf).toBe("function");
    expect(typeof reports.percentOf).toBe("function");
    expect(typeof reports.averageOf).toBe("function");
  });

  it("re-exports the shared period/aggregation helpers and constants", () => {
    expect(typeof reports.periodBucketKey).toBe("function");
    expect(typeof reports.withinDateRange).toBe("function");
    expect(typeof reports.aggregateItemSales).toBe("function");
    expect(reports.STOCK_SOURCE_DOC_TYPE_LABELS_AR.SALES_INVOICE).toBe("فاتورة مبيعات");
    expect(reports.UNASSIGNED_SALESPERSON_KEY).toBe("__unassigned__");
  });

  it("re-exports the sample fixture data used to prove the engine end to end", () => {
    expect(Array.isArray(reports.sampleReportAccounts)).toBe(true);
    expect(reports.sampleReportAccounts.length).toBeGreaterThan(0);
    expect(Array.isArray(reports.sampleReportJournalEntries)).toBe(true);
    expect(reports.sampleReportJournalEntries.length).toBeGreaterThan(0);
    expect(Array.isArray(reports.financialStatementAccounts)).toBe(true);
    expect(Array.isArray(reports.financialStatementEntries)).toBe(true);
    expect(typeof reports.OUTPUT_VAT_ACCOUNT_ID).toBe("string");
    expect(typeof reports.INPUT_VAT_ACCOUNT_ID).toBe("string");
  });

  it("re-exports the comparative-period helper and its Arabic labels", () => {
    expect(typeof reports.comparativeRange).toBe("function");
    expect(reports.COMPARISON_LABEL_AR.previous).toBe("الفترة السابقة");
  });

  it("wires createTrialBalanceReport through runReport end to end, off the sample fixture", () => {
    const definition = reports.createTrialBalanceReport("2026-12-31");
    const outcome = reports.runReport(definition, { asOfDate: "2026-12-31" }, {
      accounts: reports.sampleReportAccounts,
      journalEntries: reports.sampleReportJournalEntries,
    });
    expect(outcome.ok).toBe(true);
  });
});
