export type {
  ReportColumn,
  ReportColumnFormat,
  ReportDefinition,
  ReportGroupResult,
  ReportGroupSpec,
  ReportParamField,
  ReportReconciliationResult,
  ReportReconciliationSpec,
  ReportValidationError,
  RunReportOutcome,
} from "./types.js";
export { computeReconciliation, computeReportGroups, runReport, validateReportParams } from "./engine.js";
export {
  createTrialBalanceReport,
  type TrialBalanceContext,
  type TrialBalanceParams,
  type TrialBalanceRow,
} from "./trial-balance.js";
export { sampleReportAccounts, sampleReportJournalEntries } from "./sample-gl-data.js";

// --- Shared helpers ----------------------------------------------------

export { periodBucketKey, withinDateRange, type PeriodGroupBy } from "./period-bucket.js";
export { aggregateItemSales, type ItemSalesAggregate } from "./sales-item-aggregation.js";
export { STOCK_SOURCE_DOC_TYPE_LABELS_AR } from "./inventory-source-doc-labels.js";

// --- المبيعات — Sales reports (docs/catalog/08-reports.md) -------------

export {
  createSalesByPeriodReport,
  type SalesByPeriodContext,
  type SalesByPeriodParams,
  type SalesByPeriodRow,
} from "./sales-by-period.js";
export {
  createSalesByItemReport,
  type SalesByItemContext,
  type SalesByItemParams,
  type SalesByItemRow,
} from "./sales-by-item.js";
export {
  createSalesByCustomerReport,
  type SalesByCustomerContext,
  type SalesByCustomerParams,
  type SalesByCustomerRow,
} from "./sales-by-customer.js";
export {
  createSalesBySalespersonReport,
  UNASSIGNED_SALESPERSON_KEY,
  type SalesBySalespersonContext,
  type SalesBySalespersonParams,
  type SalesBySalespersonRow,
} from "./sales-by-salesperson.js";
export {
  createTopProductsReport,
  type TopProductsContext,
  type TopProductsParams,
  type TopProductsRow,
} from "./sales-top-products.js";

// --- المشتريات — Purchases reports --------------------------------------

export {
  createPurchasesByPeriodReport,
  type PurchasesByPeriodContext,
  type PurchasesByPeriodParams,
  type PurchasesByPeriodRow,
} from "./purchases-by-period.js";
export {
  createPurchasesBySupplierReport,
  type PurchasesBySupplierContext,
  type PurchasesBySupplierParams,
  type PurchasesBySupplierRow,
} from "./purchases-by-supplier.js";
export {
  createPurchasesByItemReport,
  type PurchasesByItemContext,
  type PurchasesByItemParams,
  type PurchasesByItemRow,
} from "./purchases-by-item.js";

// --- المخزون — Inventory reports -----------------------------------------

export {
  createInventoryStockLevelsReport,
  type InventoryStockLevelsContext,
  type InventoryStockLevelsParams,
  type InventoryStockLevelsRow,
  type StockLevelStatus,
} from "./inventory-stock-levels.js";
export {
  createInventoryMovementReport,
  type InventoryMovementContext,
  type InventoryMovementParams,
  type InventoryMovementRow,
} from "./inventory-movement.js";
export {
  createInventoryLedgerReport,
  type InventoryLedgerContext,
  type InventoryLedgerParams,
  type InventoryLedgerRow,
} from "./inventory-ledger.js";
export {
  createInventoryValuationReport,
  type InventoryValuationContext,
  type InventoryValuationParams,
  type InventoryValuationRow,
} from "./inventory-valuation.js";
export {
  createInventoryAgingReport,
  type InventoryAgingContext,
  type InventoryAgingParams,
  type InventoryAgingRow,
  type AgeBucket,
} from "./inventory-aging.js";
export {
  createInventorySlowMovingReport,
  type InventorySlowMovingContext,
  type InventorySlowMovingParams,
  type InventorySlowMovingRow,
  type SlowMovingSeverity,
} from "./inventory-slow-moving.js";
export {
  createInventoryDriftReport,
  type InventoryDriftContext,
  type InventoryDriftParams,
  type InventoryDriftRow,
  type DriftType,
} from "./inventory-drift.js";

// --- أعمار الديون — Aging reports ----------------------------------------

export {
  createAgingCustomersReport,
  type AgingCustomersContext,
  type AgingCustomersParams,
  type AgingCustomersRow,
} from "./aging-customers.js";
export {
  createAgingSuppliersReport,
  type AgingSuppliersContext,
  type AgingSuppliersParams,
  type AgingSuppliersRow,
} from "./aging-suppliers.js";

// --- المبيعات الميدانية — Field/Van sales reports -------------------------

export {
  createVanSalesReport,
  type VanSalesContext,
  type VanSalesParams,
  type VanSalesRow,
} from "./field-van-sales.js";

// --- الأقساط — Installment reports ---------------------------------------

export {
  createInstallmentsOverviewReport,
  type InstallmentsOverviewContext,
  type InstallmentsOverviewParams,
  type InstallmentsOverviewRow,
} from "./installments-overview.js";
export {
  createInstallmentsOverdueReport,
  type InstallmentsOverdueContext,
  type InstallmentsOverdueParams,
  type InstallmentsOverdueRow,
  type OverdueBucket,
} from "./installments-overdue.js";
// --- Financial statements (phase9/financial-statements) ---
export {
  ACCOUNT_SECTION_LABELS,
  ACCOUNT_TYPE_LABELS,
  type AccountSection,
  type DateRange,
  type GlReportContext,
  accountNet,
  classifyAccount,
  isCashAccount,
  isLedgerEffective,
  moneyToNumber,
  netBalancesByAccount,
} from "./gl-shared.js";
export {
  INPUT_VAT_ACCOUNT_ID,
  OUTPUT_VAT_ACCOUNT_ID,
  financialStatementAccounts,
  financialStatementEntries,
} from "./financial-fixtures.js";
export {
  createIncomeStatementReport,
  incomeStatementNetIncome,
  type IncomeStatementParams,
  type IncomeStatementRow,
} from "./income-statement.js";
export {
  balanceSheetTotalAssets,
  balanceSheetTotalLiabilitiesEquity,
  createBalanceSheetReport,
  type BalanceSheetParams,
  type BalanceSheetRow,
} from "./balance-sheet.js";
export {
  cashFlowNetChange,
  createCashFlowReport,
  type CashFlowActivity,
  type CashFlowParams,
  type CashFlowRow,
} from "./cash-flow.js";
export {
  createVatReturnReport,
  vatNetPayable,
  type VatReturnContext,
  type VatReturnParams,
  type VatReturnRow,
  type VatSide,
} from "./vat-return.js";
export {
  createGeneralLedgerReport,
  type GeneralLedgerParams,
  type GeneralLedgerRow,
} from "./general-ledger.js";
export {
  createAccountLedgerReport,
  type AccountLedgerParams,
  type AccountLedgerRow,
} from "./account-ledger.js";
