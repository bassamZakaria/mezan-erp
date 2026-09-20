export {
  BANK_STATEMENT_STATUS_DEFINITIONS,
  BankStatementSource,
  getBankStatementStatusLabel,
  MatchSource,
  MAX_STATEMENT_BALANCE_SCALED,
  type BankStatement,
  type BankStatementListFilter,
  type BankStatementRepository,
  type BankStatementStatus,
  type BankStatementStatusDefinition,
  type StatementColumnMapping,
  type StatementColumnMappingRepository,
  type StatementDateFormat,
  type StatementLine,
  type StatementLineStatus,
} from "./bank-statement.js";

export { statementFingerprint, type FingerprintInput, type FingerprintRow } from "./fingerprint.js";

export {
  BankRuleNotFoundError,
  BankStatementNotFoundError,
  DuplicateStatementImportError,
  ColumnNotFoundError,
  EntryAccountRequiredError,
  EntryAlreadyMatchedError,
  EntryDateBeforeLineError,
  EntryNotOnTreasuryAccountError,
  FinalizeOverrideReasonRequiredError,
  InvalidBankRuleError,
  InvalidColumnMappingError,
  InvalidEntryAccountError,
  InvalidStatementBalanceError,
  InvalidStatementFileError,
  LineAlreadyMatchedError,
  LineNotMatchedError,
  LineNotOnStatementError,
  MatchAmountMismatchError,
  MatchCurrencyMismatchError,
  NoEntriesSelectedError,
  StatementAccountMismatchError,
  StatementAlreadyFinalizedError,
  StatementCurrencyMismatchError,
  StatementDifferenceNotZeroError,
  StatementHasUnmatchedLinesError,
  StatementLineNotFoundError,
  StatementOutOfBranchScopeError,
  SuggestionNotFoundError,
  SuggestionNotPendingError,
  TreasuryAccountNumberMissingError,
  TreasuryAccountOutOfBranchScopeError,
  TreasuryAccountUnpostableError,
  ZeroAmountLineError,
} from "./errors.js";

export { mapCsvRows, parseCsv, type CsvTable, type MappedStatementRow } from "./csv.js";
export { parseOfx } from "./ofx.js";
export { parseMt940 } from "./mt940.js";
export { StatementFileFormat, type ParsedStatementFile, type ParsedStatementRow } from "./statement-file.js";

export {
  AUTO_APPLY_THRESHOLD,
  buildSuggestions,
  MATCH_WEIGHTS,
  MATCH_WINDOW_DAYS,
  rankCandidates,
  scoreCandidate,
  splitCandidates,
  SPLIT_SCORE_CAP,
  suggestMatches,
  type LineSuggestions,
  type MatchScore,
  type MatchSuggestion,
  type ScoredCandidateSet,
  type TreasuryLedgerCandidate,
  type TreasuryLedgerReader,
} from "./matching.js";

export { SuggestionStatus, type MatchSuggestionRecord, type MatchSuggestionRepository } from "./suggestions.js";
export {
  BankRuleDirection,
  BankRuleMatchType,
  findMatchingRule,
  ruleMatchesLine,
  type BankRule,
  type BankRuleRepository,
} from "./bank-rules.js";
export { BankEntryKind, type BankEntryPostInput, type BankEntryPostResult, type BankEntryPoster } from "./entry-poster.js";

export {
  createTreasuryLedgerReader,
  createVoucherBankEntryPoster,
  type TreasuryLedgerReaderDeps,
  type VoucherBankEntryPosterDeps,
} from "./adapters.js";

export {
  BankReconciliationService,
  displayAmount,
  type AddManualLineCommand,
  type BankReconciliationServiceDeps,
  type BankRuleInput,
  type CreateEntryCommand,
  type CreateEntryResult,
  type FinalizeOptions,
  type ImportStatementCommand,
  type ImportStatementFileCommand,
  type MatchedStatementLine,
  type MatchSummary,
  type ReconciliationPosition,
  type ReviewItem,
  type ReviewSuggestion,
} from "./reconciliation-service.js";
