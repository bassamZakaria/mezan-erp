/**
 * Messages here reach the UI verbatim: the api serves `message: err.message`
 * and screens render it directly, so every message must be Arabic.
 */
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
    super(`تعذّر العثور على القيد "${entryId}".`);
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
    super(`القيد "${entryId}" حالته "${status}" وليس مسودة، فلا يمكن ترحيله.`);
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
    super(`القيد "${entryId}" حالته "${status}" وليس مُرحَّلاً، فلا يمكن عكسه.`);
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
    super(`القيد "${entryId}" سبق عكسه بالقيد "${reversedByEntryId}".`);
    this.name = "JournalEntryAlreadyReversedError";
  }
}

/** Raised when a journal line targets an inactive (غير نشط) account — posting is blocked. */
export class InactiveAccountError extends Error {
  readonly code = "INACTIVE_ACCOUNT";
  constructor(readonly accountId: string) {
    super(`الحساب "${accountId}" غير نشط، فلا يمكن الترحيل إليه.`);
    this.name = "InactiveAccountError";
  }
}

/** Raised when a journal-entry id collides with an entry that already exists. */
export class DuplicateJournalEntryError extends Error {
  readonly code = "DUPLICATE_JOURNAL_ENTRY";
  constructor(readonly entryId: string) {
    super(`القيد "${entryId}" موجود بالفعل.`);
    this.name = "DuplicateJournalEntryError";
  }
}
