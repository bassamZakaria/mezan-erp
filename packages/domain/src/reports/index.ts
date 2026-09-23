export type {
  ReportColumn,
  ReportColumnFormat,
  ReportEntityKind,
  ReportEntityRef,
  ReportDefinition,
  ReportGroupResult,
  ReportGroupSpec,
  ReportParamField,
  ReportReconciliationResult,
  ReportKpiResult,
  ReportFigure,
  ReportKpiSpec,
  ReportChartSpec,
  ReportReconciliationSpec,
  ReportReconcilingItem,
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
export { averageOf, countDistinct, countRows, diffOf, maxOf, percentOf, sumRows } from "./kpi.js";
export { aggregateItemSales, creditedRevenueAccountIds, type ItemSalesAggregate } from "./sales-item-aggregation.js";
export { STOCK_SOURCE_DOC_TYPE_LABELS_AR } from "./inventory-source-doc-labels.js";

// --- المبيعات — Sales reports (docs/archive/catalog/08-reports.md) -------------

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
  salesInvoiceRemaining,
  salesRemainingOverPeriod,
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
  purchaseInvoiceRemaining,
  purchasesRemainingOverPeriod,
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
  createGoodsInTransitReport,
  type GoodsInTransitContext,
  type GoodsInTransitParams,
  type GoodsInTransitRow,
} from "./goods-in-transit.js";
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
  createInventoryExpiringReport,
  type InventoryExpiringContext,
  type InventoryExpiringParams,
  type InventoryExpiringRow,
  type ExpiryWindow,
} from "./inventory-expiring.js";
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
export {
  createReturnsFxFaceValueReport,
  type ForeignInvoiceRef,
  type ReturnFxKind,
  type ReturnsFxFaceValueContext,
  type ReturnsFxFaceValueParams,
  type ReturnsFxFaceValueRow,
  type ReturnDocumentLike,
} from "./returns-fx-face-value.js";

// --- تكرار ترحيل الأرصدة الافتتاحية — Duplicate Opening-Balance Postings (D241) ---

export {
  createOpeningBalanceDuplicatesReport,
  findOpeningBalanceDuplicates,
  type OpeningBalanceDuplicatesContext,
  type OpeningBalanceDuplicateRow,
  type OpeningBalanceEntryRef,
  type OpeningBalancePartyRef,
} from "./opening-balance-duplicates.js";

// --- التصنيع أم الشراء — Make vs Buy ---------------------------------------

export {
  createMakeVsBuyReport,
  type MakeVsBuyContext,
  type MakeVsBuyParams,
  type MakeVsBuyRow,
  type MakeVsBuyVerdict,
} from "./make-vs-buy.js";

// --- أعمار الديون — Aging reports ----------------------------------------

export {
  createAgingCustomersReport,
  customerAgingBalances,
  agingBucketsTotal,
  type CustomerAgingBalance,
  type AgingCustomersContext,
  type AgingCustomersParams,
  type AgingCustomersRow,
} from "./aging-customers.js";
export {
  createAgingSuppliersReport,
  supplierAgingBalances,
  supplierAgingTotal,
  type SupplierAgingBalance,
  type AgingSuppliersContext,
  type AgingSuppliersParams,
  type AgingSuppliersRow,
} from "./aging-suppliers.js";
export {
  type AgingOpenItem,
  type AgingOpenItemSource,
  CUSTOMER_OPENING_BALANCE_DOC_TYPE,
  SUPPLIER_OPENING_BALANCE_DOC_TYPE,
} from "./aging-open-items.js";

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
  type AccountActivity,
  type AccountSection,
  type DateRange,
  type GlReportContext,
  accountActivity,
  accountNet,
  classifyAccount,
  isCashAccount,
  isLedgerEffective,
  isMemorandumAccount,
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
  COMPARISON_LABEL_AR,
  comparativeRange,
  type ClosedDateRange,
  type ComparisonMode,
} from "./comparative-period.js";
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
  createWithholdingTaxReport,
  type WithholdingTaxContext,
  type WithholdingTaxParams,
  type WithholdingTaxRow,
} from "./withholding-tax.js";
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

// --- نموذج 41 — Withholding-tax (Form 41) quarterly filing ---------------

export {
  amendForm41Filing,
  assertWithholdingNotFiled,
  recordForm41Filing,
  withholdingQuarter,
  withholdingQuarterOf,
  DuplicateForm41FilingError,
  Form41FilingNotFoundError,
  Form41PeriodAlreadyFiledError,
  type Form41Filing,
  type Form41FilingRepository,
  type Form41FilingStatus,
  type Form41Quarter,
  type RecordForm41FilingCommand,
  type WithholdingQuarter,
} from "./form41-filing.js";
export {
  buildForm41Return,
  type Form41Return,
  type Form41ReturnRow,
} from "./form41-return.js";
export { BRANCH_PARAM_FIELD, branchIdParamSchema, branchOfWarehouse, matchesBranch } from "./branch-filter.js";
export {
  BRANCH_STATEMENT_NOTE_AR,
  BRANCH_STATEMENT_PARAM_FIELD,
  UNATTRIBUTED_BRANCH_ID,
  UNATTRIBUTED_BRANCH_LABEL,
  matchesStatementBranch,
  withinBranchScope,
} from "./branch-filter.js";
export { isoDateParamSchema, isRealIsoDate } from "./iso-date.js";
export {
  createPayrollRegisterReport,
  createSocialInsuranceReturnReport,
  createSalaryTaxReturnReport,
  SOCIAL_INSURANCE_CONTROL_ACCOUNT,
  SALARY_TAX_CONTROL_ACCOUNT,
  PAYROLL_RUN_SOURCE_DOC_TYPE,
  payrollCreditsByRunId,
  type SocialInsuranceReturnRow,
  type SalaryTaxReturnRow,
  type PayrollReportContext,
  type PayrollPeriodParams,
  type PayrollRegisterRow,
} from "./hr-payroll.js";
export {
  createAttendanceSummaryReport,
  createLeaveLiabilityReport,
  createHeadcountMovementReport,
  LEAVE_LIABILITY_CONTROL_ACCOUNT,
  type AttendanceSummaryContext,
  type AttendanceSummaryParams,
  type AttendanceSummaryRow,
  type LeaveLiabilityContext,
  type LeaveLiabilityParams,
  type LeaveLiabilityRow,
  type HeadcountMovementContext,
  type HeadcountMovementRow,
} from "./hr-workforce.js";

export {
  buildPartyStatement,
  statementSides,
  type PartyStatement,
  type PartyStatementEntry,
  type PartyStatementEntryKind,
  type PartyStatementLine,
} from "./party-statement.js";
