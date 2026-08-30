export {
  BANK_STATEMENT_STATUS_DEFINITIONS,
  getBankStatementStatusLabel,
  type BankStatement,
  type BankStatementListFilter,
  type BankStatementRepository,
  type BankStatementSource,
  type BankStatementStatus,
  type BankStatementStatusDefinition,
  type StatementColumnMapping,
  type StatementColumnMappingRepository,
  type StatementDateFormat,
  type StatementLine,
  type StatementLineStatus,
} from "./bank-statement.js";

export {
  BankStatementNotFoundError,
  FinalizeOverrideReasonRequiredError,
  StatementHasUnmatchedLinesError,
  ColumnNotFoundError,
  InvalidColumnMappingError,
  InvalidStatementFileError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  StatementAlreadyFinalizedError,
  StatementLineNotFoundError,
} from "./errors.js";

export { mapCsvRows, parseCsv, type CsvTable, type MappedStatementRow } from "./csv.js";

export {
  suggestMatches,
  type MatchSuggestion,
  type TreasuryLedgerCandidate,
  type TreasuryLedgerReader,
} from "./matching.js";

export { createTreasuryLedgerReader, type TreasuryLedgerReaderDeps } from "./adapters.js";

export {
  BankReconciliationService,
  type AddManualLineCommand,
  type BankReconciliationServiceDeps,
  type FinalizeOptions,
  type ImportStatementCommand,
  type MatchedStatementLine,
  type MatchSummary,
} from "./reconciliation-service.js";
