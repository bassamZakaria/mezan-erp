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
  assertEntryDate,
  assertMemorandumPartition,
  assertProjectRequired,
  assertPartyLines,
} from "./post.js";
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
  DuplicateJournalEntryError,
  PartyRequiredOnControlAccountError,
  InvalidJournalPartyError,
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
