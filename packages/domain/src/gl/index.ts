/**
 * GL posting engine (Tier 2 shared engine, docs/archive/plan.md §4 "the heart").
 *
 * Double-entry posting with balance enforcement and the fiscal-period gate;
 * the draft → posted → reversed lifecycle; append-only posted entries corrected
 * only by reversing entries; JE numbering via the numbering engine; audit +
 * domain-event emission. Pure domain — it depends on ports only.
 */
export type {
  LedgerRepository,
  JournalListFilter,
  AccountBalance,
  AccountLedgerLine,
  LedgerAggregateFilter,
  TreasuryBalanceQuery,
  PostedLineFilter,
  PostedLine,
} from "./ledger.js";
export type {
  JournalLineInput,
  CreateJournalEntryCommand,
  JournalPostingDeps,
  ReplaceDraftJournalEntryCommand,
} from "./post.js";
export {
  createJournalEntry,
  postJournalEntry,
  postDraftJournalEntry,
  replaceDraftJournalEntry,
  deleteDraftJournalEntry,
  assertEntryStructure,
  assertBalanced,
  assertLinesPostable,
  assertPeriodOpen,
  assertVatNotFiled,
  assertEntryDate,
  assertMemorandumPartition,
  assertProjectRequired,
  assertPartyLines,
} from "./post.js";
export { branchOfPostingWarehouse, type WarehouseBranchLookup } from "./warehouse-branch.js";
export { inBranchOf } from "./line-branch.js";
export { createJournalTaxTagPort, JournalTaxTagUnsupportedError } from "./tax-tag.js";

export {
  reverseJournalEntry,
  type ReverseJournalEntryOptions,
  type ReverseJournalEntryResult,
} from "./reverse.js";
export type { GlEventType, GlDomainEvent, GlEventPublisher } from "./events.js";
export {
  JournalEntryNotFoundError,
  JournalEntryNotDraftError,
  JournalEntryNotPostedError,
  JournalEntryAlreadyReversedError,
  InactiveAccountError,
  PartyRequiredOnControlAccountError,
  InvalidJournalPartyError,
  ReversalDateBeforeOriginalError,
  JournalEntryOwnedByDocumentError,
  JournalReversalNotReversibleError,
  assertReversibleFromJournal,
  type PartyControlKind,
} from "./errors.js";

export {
  closeFiscalYear,
  planYearEndClose,
  YearAlreadyClosedError,
  NothingToCloseError,
  type CloseYearCommand,
  type CloseYearDeps,
  type CloseYearResult,
  type YearEndClosePlan,
  type YearEndClosePlanLine,
} from "./year-end-close.js";

export { nextEntryGenerationId, standingEntryGeneration } from "./entry-generations.js";
export { PostingBeforeRevaluationError, type JournalPostingInternals } from "./revaluation-lock.js";
export { ReservedJournalEntryIdError, assertEntryIdNotReserved, isReservedJournalEntryId } from "./reserved-entry-ids.js";
export { reopenFiscalYear, standingYearClose, YearNotClosedError, FollowingYearClosedError, type ReopenYearOptions, type ReopenYearResult } from "./year-end-close.js";
