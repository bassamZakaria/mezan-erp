/**
 * GL posting-engine errors. Structural/balance errors are reused from the
 * spike's `post-journal-entry.ts` (UnbalancedEntryError, InvalidJournalEntryError);
 * account- and period-gate errors are reused from `accounts/` and
 * `fiscal-periods/`. The classes below cover the lifecycle transitions the GL
 * engine adds on top (post a draft, reverse a posted entry).
 */

/** Raised when an operation references a journal-entry id that does not exist. */
export class JournalEntryNotFoundError extends Error {
  readonly code = "JOURNAL_ENTRY_NOT_FOUND";
  constructor(readonly entryId: string) {
    super(`Journal entry "${entryId}" was not found.`);
    this.name = "JournalEntryNotFoundError";
  }
}

/** Raised when trying to post an entry that is not in the مسودة (draft) state. */
export class JournalEntryNotDraftError extends Error {
  readonly code = "JOURNAL_ENTRY_NOT_DRAFT";
  constructor(
    readonly entryId: string,
    readonly status: string,
  ) {
    super(`Journal entry "${entryId}" is "${status}", not a draft, and cannot be posted.`);
    this.name = "JournalEntryNotDraftError";
  }
}

/**
 * Raised when trying to reverse an entry that is not مرحل (posted) — only a
 * posted entry can be reversed (a draft is edited/deleted; a reversed entry is
 * already offset).
 */
export class JournalEntryNotPostedError extends Error {
  readonly code = "JOURNAL_ENTRY_NOT_POSTED";
  constructor(
    readonly entryId: string,
    readonly status: string,
  ) {
    super(`Journal entry "${entryId}" is "${status}", not posted, and cannot be reversed.`);
    this.name = "JournalEntryNotPostedError";
  }
}

/** Raised when reversing an entry that has already been reversed (append-only: never reverse twice). */
export class JournalEntryAlreadyReversedError extends Error {
  readonly code = "JOURNAL_ENTRY_ALREADY_REVERSED";
  constructor(
    readonly entryId: string,
    readonly reversedByEntryId: string,
  ) {
    super(`Journal entry "${entryId}" was already reversed by "${reversedByEntryId}".`);
    this.name = "JournalEntryAlreadyReversedError";
  }
}

/** Raised when a journal line targets an inactive (غير نشط) account — posting is blocked. */
export class InactiveAccountError extends Error {
  readonly code = "INACTIVE_ACCOUNT";
  constructor(readonly accountId: string) {
    super(`Account "${accountId}" is inactive and cannot be posted to.`);
    this.name = "InactiveAccountError";
  }
}

/** Raised when a journal-entry id collides with an entry that already exists. */
export class DuplicateJournalEntryError extends Error {
  readonly code = "DUPLICATE_JOURNAL_ENTRY";
  constructor(readonly entryId: string) {
    super(`Journal entry "${entryId}" already exists.`);
    this.name = "DuplicateJournalEntryError";
  }
}
