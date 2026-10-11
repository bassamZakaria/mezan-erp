import { describe, it, expect } from "vitest";
import {
  JournalEntryNotFoundError,
  JournalEntryNotDraftError,
  JournalEntryNotPostedError,
  JournalEntryAlreadyReversedError,
  InactiveAccountError,
  DuplicateJournalEntryError,
  assertReversibleFromJournal,
  JournalReversalNotReversibleError,
  JournalEntryOwnedByDocumentError,
} from "./errors.js";

describe("gl errors", () => {
  it("JournalEntryNotFoundError carries the missing id and an Arabic message", () => {
    const err = new JournalEntryNotFoundError("je-1");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("JournalEntryNotFoundError");
    expect(err.code).toBe("JOURNAL_ENTRY_NOT_FOUND");
    expect(err.entryId).toBe("je-1");
    expect(err.message).toBe('تعذّر العثور على القيد "je-1".');
  });

  it("JournalEntryNotDraftError carries the id, status and an Arabic message", () => {
    const err = new JournalEntryNotDraftError("je-1", "posted");
    expect(err.name).toBe("JournalEntryNotDraftError");
    expect(err.code).toBe("JOURNAL_ENTRY_NOT_DRAFT");
    expect(err.entryId).toBe("je-1");
    expect(err.status).toBe("posted");
    expect(err.message).toBe('القيد "je-1" حالته "posted" وليس مسودة، فلا يمكن ترحيله.');
  });

  it("JournalEntryNotPostedError carries the id, status and an Arabic message", () => {
    const err = new JournalEntryNotPostedError("je-1", "draft");
    expect(err.name).toBe("JournalEntryNotPostedError");
    expect(err.code).toBe("JOURNAL_ENTRY_NOT_POSTED");
    expect(err.entryId).toBe("je-1");
    expect(err.status).toBe("draft");
    expect(err.message).toBe('القيد "je-1" حالته "draft" وليس مُرحَّلاً، فلا يمكن عكسه.');
  });

  it("JournalEntryAlreadyReversedError carries both entry ids and an Arabic message", () => {
    const err = new JournalEntryAlreadyReversedError("je-1", "je-2");
    expect(err.name).toBe("JournalEntryAlreadyReversedError");
    expect(err.code).toBe("JOURNAL_ENTRY_ALREADY_REVERSED");
    expect(err.entryId).toBe("je-1");
    expect(err.reversedByEntryId).toBe("je-2");
    expect(err.message).toBe('القيد "je-1" سبق عكسه بالقيد "je-2".');
  });

  it("InactiveAccountError carries the account id and an Arabic message", () => {
    const err = new InactiveAccountError("1300");
    expect(err.name).toBe("InactiveAccountError");
    expect(err.code).toBe("INACTIVE_ACCOUNT");
    expect(err.accountId).toBe("1300");
    expect(err.message).toBe('الحساب "1300" غير نشط، فلا يمكن الترحيل إليه.');
  });

  it("DuplicateJournalEntryError carries the entry id and an Arabic message", () => {
    const err = new DuplicateJournalEntryError("je-1");
    expect(err.name).toBe("DuplicateJournalEntryError");
    expect(err.code).toBe("DUPLICATE_JOURNAL_ENTRY");
    expect(err.entryId).toBe("je-1");
    expect(err.message).toBe('القيد "je-1" موجود بالفعل.');
  });
});

describe("what the journal's own reverse action accepts", () => {
  const entry = (over: Record<string, unknown>) => ({ id: "JE-1", entryNo: "JE-000001", reversesEntryId: null, sourceDocType: null, sourceDocId: null, sourceDocNumber: null, ...over });

  it("a manual journal and an imported opening balance: neither has a document to reverse instead", () => {
    expect(() => assertReversibleFromJournal(entry({}))).not.toThrow();
    expect(() => assertReversibleFromJournal(entry({ sourceDocType: "RECURRING_JOURNAL_TEMPLATE", sourceDocId: "T-1" }))).toThrow(JournalEntryOwnedByDocumentError);
    expect(() => assertReversibleFromJournal(entry({ sourceDocType: "INITIAL_BALANCE" }))).not.toThrow();
  });

  it("an entry a document posted is refused, naming the document; a reversing entry is refused whatever posted it", () => {
    expect(() => assertReversibleFromJournal(entry({ sourceDocType: "TREASURY_VOUCHER", sourceDocId: "V-1", sourceDocNumber: "CV-000009" }))).toThrow(/CV-000009/);
    expect(() => assertReversibleFromJournal(entry({ reversesEntryId: "JE-0" }))).toThrow(JournalReversalNotReversibleError);
  });
});

