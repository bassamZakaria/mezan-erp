/**
 * GL posting engine (Tier 2 shared engine, docs/plan.md §4 "the heart").
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
  PostedLineFilter,
  PostedLine,
} from "./ledger.js";
export type {
  JournalLineInput,
  CreateJournalEntryCommand,
  JournalPostingDeps,
} from "./post.js";
export {
  createJournalEntry,
  postJournalEntry,
  postDraftJournalEntry,
  assertEntryStructure,
  assertBalanced,
  assertLinesPostable,
  assertPeriodOpen,
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
} from "./errors.js";

export {
  closeFiscalYear,
  YearAlreadyClosedError,
  NothingToCloseError,
  type CloseYearCommand,
  type CloseYearDeps,
  type CloseYearResult,
} from "./year-end-close.js";
