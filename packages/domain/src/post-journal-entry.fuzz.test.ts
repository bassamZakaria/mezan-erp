import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Money } from "./money/index.js";
import { allocateScaled } from "./money/rounding.js";
import type { JournalEntry, JournalLine, UnitOfWork } from "./journal.js";
import { InvalidJournalEntryError, postJournalEntry, UnbalancedEntryError } from "./post-journal-entry.js";

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

const amountArb = fc.bigInt({ min: 1n, max: 10n ** 13n });
const splitArb = fc.array(fc.bigInt({ min: 1n, max: 10n ** 6n }), { minLength: 1, maxLength: 12 });

/** A balanced entry: one total, split across debit lines and, independently, across credit lines. */
function balancedLines(total: bigint, debitWeights: readonly bigint[], creditWeights: readonly bigint[]): JournalLine[] {
  const debits = allocateScaled(total, debitWeights);
  const credits = allocateScaled(total, creditWeights);
  return [
    ...debits.map((d, i) => ({
      accountId: `D-${i}`,
      debit: Money.fromScaled(d),
      credit: Money.zero(),
    })),
    ...credits.map((c, i) => ({
      accountId: `C-${i}`,
      debit: Money.zero(),
      credit: Money.fromScaled(c),
    })),
  ];
}

describe("postJournalEntry — fuzz", () => {
  it("fuzz: any entry whose two sides split the same total posts, whatever the shape", async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, splitArb, splitArb, async (total, dw, cw) => {
        const uow = fakeUow();
        const lines = balancedLines(total, dw, cw);
        const entry = await postJournalEntry({ id: "JE-F", date: "2026-08-30", memo: "fuzz", lines }, uow);

        expect(entry.status).toBe("posted");
        expect(uow.saved).toHaveLength(1);
        const debit = Money.sum(entry.lines.map((l) => l.debit));
        const credit = Money.sum(entry.lines.map((l) => l.credit));
        expect(debit.scaled).toBe(credit.scaled);
        expect(debit.scaled).toBe(total);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: a single micro-unit of imbalance is always refused and nothing is saved", async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, splitArb, splitArb, fc.constantFrom(1n, -1n), async (total, dw, cw, drift) => {
        const uow = fakeUow();
        const lines = balancedLines(total, dw, cw);
        const first = lines[0] as JournalLine;
        const drifted: JournalLine[] = [
          { ...first, debit: Money.fromScaled(first.debit.scaled + drift) },
          ...lines.slice(1),
        ];

        await expect(
          postJournalEntry({ id: "JE-D", date: "2026-08-30", memo: "drift", lines: drifted }, uow),
        ).rejects.toBeInstanceOf(UnbalancedEntryError);
        expect(uow.saved).toHaveLength(0);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: line order never changes the verdict", async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, splitArb, splitArb, async (total, dw, cw) => {
        const lines = balancedLines(total, dw, cw);
        const reversed = [...lines].reverse();
        const forward = fakeUow();
        const backward = fakeUow();

        await postJournalEntry({ id: "JE-1", date: "2026-08-30", memo: "a", lines }, forward);
        await postJournalEntry({ id: "JE-2", date: "2026-08-30", memo: "a", lines: reversed }, backward);

        expect(forward.saved).toHaveLength(1);
        expect(backward.saved).toHaveLength(1);
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: fewer than two lines is structurally invalid however well it balances", async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, async (total) => {
        const uow = fakeUow();
        await expect(
          postJournalEntry({ id: "JE-0", date: "2026-08-30", memo: "empty", lines: [] }, uow),
        ).rejects.toBeInstanceOf(InvalidJournalEntryError);

        await expect(
          postJournalEntry(
            {
              id: "JE-0",
              date: "2026-08-30",
              memo: "one line",
              lines: [{ accountId: "1000", debit: Money.fromScaled(total), credit: Money.fromScaled(total) }],
            },
            uow,
          ),
        ).rejects.toBeInstanceOf(InvalidJournalEntryError);
        expect(uow.saved).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  it("fuzz: an entry of pure zeroes balances, which is why emptiness must be caught structurally", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 10 }), async (count) => {
        const uow = fakeUow();
        const lines: JournalLine[] = Array.from({ length: count }, (_, i) => ({
          accountId: `Z-${i}`,
          debit: Money.zero(),
          credit: Money.zero(),
        }));
        const entry = await postJournalEntry({ id: "JE-Z", date: "2026-08-30", memo: "zero", lines }, uow);
        expect(entry.status).toBe("posted");
        expect(Money.sum(entry.lines.map((l) => l.debit)).scaled).toBe(0n);
      }),
      { numRuns: 50 },
    );
  });

  it("fuzz: the raised error reports both totals exactly, for the screen that shows the difference", async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, amountArb, async (debit, credit) => {
        fc.pre(debit !== credit);
        const uow = fakeUow();
        const lines: JournalLine[] = [
          { accountId: "D", debit: Money.fromScaled(debit), credit: Money.zero() },
          { accountId: "C", debit: Money.zero(), credit: Money.fromScaled(credit) },
        ];
        try {
          await postJournalEntry({ id: "JE-E", date: "2026-08-30", memo: "err", lines }, uow);
          throw new Error("expected the entry to be refused");
        } catch (error) {
          expect(error).toBeInstanceOf(UnbalancedEntryError);
          const unbalanced = error as UnbalancedEntryError;
          expect(unbalanced.code).toBe("UNBALANCED_ENTRY");
          expect(unbalanced.totalDebit.scaled).toBe(debit);
          expect(unbalanced.totalCredit.scaled).toBe(credit);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: a line carrying both a debit and a credit still has to net out across the entry", async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, amountArb, async (a, b) => {
        const uow = fakeUow();
        const lines: JournalLine[] = [
          { accountId: "MIX", debit: Money.fromScaled(a), credit: Money.fromScaled(b) },
          { accountId: "BAL", debit: Money.fromScaled(b), credit: Money.fromScaled(a) },
        ];
        const entry = await postJournalEntry({ id: "JE-M", date: "2026-08-30", memo: "mixed", lines }, uow);
        expect(Money.sum(entry.lines.map((l) => l.debit)).scaled).toBe(
          Money.sum(entry.lines.map((l) => l.credit)).scaled,
        );
      }),
      { numRuns: 200 },
    );
  });
});
