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
  isPosted,
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
