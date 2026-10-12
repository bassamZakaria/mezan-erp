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

export type PartyControlKind = "customer" | "supplier";

/**
 * A manual line on a party control account names no customer or supplier
 * (D205). QuickBooks' rule: an A/R or A/P line must name its party, or the
 * control account moves while no party's balance does.
 */
export class PartyRequiredOnControlAccountError extends Error {
  readonly code = "PARTY_REQUIRED_ON_CONTROL_ACCOUNT";
  readonly messageEn: string;
  constructor(
    readonly accountId: string,
    readonly partyKind: PartyControlKind,
  ) {
    super(
      partyKind === "customer"
        ? `الحساب "${accountId}" حساب مراقبة العملاء — كل سطر عليه يجب أن يحدد العميل.`
        : `الحساب "${accountId}" حساب مراقبة الموردين — كل سطر عليه يجب أن يحدد المورد.`,
    );
    this.messageEn =
      partyKind === "customer"
        ? `Account "${accountId}" is the accounts receivable control account — every line on it must name a customer.`
        : `Account "${accountId}" is the accounts payable control account — every line on it must name a supplier.`;
    this.name = "PartyRequiredOnControlAccountError";
  }
}

/** A line names a party that does not exist, or names one on an account that is not a party control account. */
export class InvalidJournalPartyError extends Error {
  readonly code = "INVALID_JOURNAL_PARTY";
  readonly messageEn: string;
  constructor(
    readonly accountId: string,
    readonly partyId: string,
    reason: "not_found" | "not_control",
    partyKind?: PartyControlKind,
  ) {
    super(
      reason === "not_control"
        ? `الحساب "${accountId}" ليس حساب مراقبة عملاء أو موردين، فلا يُحدَّد عليه طرف.`
        : partyKind === "customer"
          ? `العميل "${partyId}" غير موجود.`
          : `المورد "${partyId}" غير موجود.`,
    );
    this.messageEn =
      reason === "not_control"
        ? `Account "${accountId}" is not a customer or supplier control account, so a line on it cannot name a party.`
        : `${partyKind === "customer" ? "Customer" : "Supplier"} "${partyId}" does not exist.`;
    this.name = "InvalidJournalPartyError";
  }
}

/**
 * A reversal dated before the entry it reverses (D270): QuickBooks and Odoo
 * both refuse this, because it would restate a day the books have already
 * reported on. The reversal may be dated anywhere from the original entry's
 * own day onward, never earlier.
 */
export class ReversalDateBeforeOriginalError extends Error {
  readonly code = "REVERSAL_DATE_BEFORE_ORIGINAL";
  readonly messageEn: string;
  constructor(
    readonly entryId: string,
    readonly date: string,
    readonly originalDate: string,
  ) {
    super(`تاريخ العكس "${date}" أسبق من تاريخ القيد الأصلي "${originalDate}"؛ لا يمكن أن يعكس المستند قبل تاريخه.`);
    this.messageEn = `Reversal date "${date}" is before the original entry's date "${originalDate}"; a reversal cannot be dated before the document it reverses.`;
    this.name = "ReversalDateBeforeOriginalError";
  }
}
