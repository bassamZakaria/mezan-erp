import { describe, it, expect } from "vitest";
import { Money } from "./money/index.js";
import type { JournalEntry, UnitOfWork } from "./journal.js";
import {
  postJournalEntry,
  UnbalancedEntryError,
  InvalidJournalEntryError,
} from "./post-journal-entry.js";

/** In-memory fake UnitOfWork so the domain test needs no database. */
function fakeUow(): UnitOfWork & { saved: JournalEntry[] } {
  const saved: JournalEntry[] = [];
  const uow: UnitOfWork & { saved: JournalEntry[] } = {
    saved,
    journal: {
      async save(entry) {
        saved.push(entry);
      },
      async findById(id) {
        return saved.find((e) => e.id === id) ?? null;
      },
    },
    roles: {
      async save() {},
      async findById() {
        return null;
      },
      async findByCode() {
        return null;
      },
      async list() {
        return [];
      },
      async delete() {},
    },
    users: {
      async save() {},
      async findById() {
        return null;
      },
      async findByEmail() {
        return null;
      },
      async list() {
        return [];
      },
    },
    async transaction(fn) {
      return fn(uow);
    },
  };
  return uow;
}

describe("postJournalEntry", () => {
  it("posts a balanced entry and persists it with status 'posted'", async () => {
    const uow = fakeUow();
    const entry = await postJournalEntry(
      {
        id: "JE-0001",
        date: "2026-08-22",
        memo: "Cash sale",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("100") },
        ],
      },
      uow,
    );

    expect(entry.status).toBe("posted");
    expect(uow.saved).toHaveLength(1);
    expect(uow.saved[0]?.id).toBe("JE-0001");
  });

  it("rejects an unbalanced entry with a clear domain error", async () => {
    const uow = fakeUow();
    await expect(
      postJournalEntry(
        {
          id: "JE-0002",
          date: "2026-08-22",
          memo: "Broken",
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("90") },
          ],
        },
        uow,
      ),
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
    expect(uow.saved).toHaveLength(0); // nothing persisted
  });

  it("rejects an entry with fewer than two lines", async () => {
    const uow = fakeUow();
    await expect(
      postJournalEntry(
        {
          id: "JE-0003",
          date: "2026-08-22",
          memo: "One-legged",
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
          ],
        },
        uow,
      ),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });
});
