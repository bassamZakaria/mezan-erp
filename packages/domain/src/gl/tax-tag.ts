import {
  JournalTaxLineAlreadyNamedError,
  JournalTaxLinesMismatchError,
  type ExpectedTaxJournalLine,
  type JournalLineTaxTag,
  type JournalTaxTagPort,
} from "./tax-ports.js";
import type { JournalEntry, JournalLine } from "../journal.js";
import type { LedgerRepository } from "./ledger.js";
import { assertVatNotFiled, type JournalPostingDeps } from "./post.js";

export class JournalTaxTagUnsupportedError extends Error {
  readonly code = "JOURNAL_TAX_TAG_UNSUPPORTED";
  constructor() {
    super("دفتر الأستاذ لا يدعم تسمية ضريبة قيد مرحّل.");
    this.name = "JournalTaxTagUnsupportedError";
  }
}

const amountsKey = (line: { readonly accountId: string; readonly debit: { readonly scaled: bigint }; readonly credit: { readonly scaled: bigint } }): string =>
  `${line.accountId}|${line.debit.scaled}|${line.credit.scaled}`;

const untagged = (line: JournalLine, taxRatePercent: number): boolean =>
  (line.taxRateId ?? null) === null && ((line.taxRatePercent ?? null) === null || line.taxRatePercent === taxRatePercent);

const tagOf = (line: JournalLine, lineIndex: number): JournalLineTaxTag => ({
  lineIndex,
  accountId: line.accountId,
  debit: line.debit.toString(),
  credit: line.credit.toString(),
  taxRatePercent: line.taxRatePercent ?? null,
  taxRateId: line.taxRateId ?? null,
});

function matchExpected(entry: JournalEntry, expected: readonly ExpectedTaxJournalLine[], taxRatePercent: number): number[] | null {
  const claimed = new Set<number>();
  for (const wanted of expected) {
    const found = entry.lines.findIndex((line, index) => !claimed.has(index) && untagged(line, taxRatePercent) && amountsKey(line) === amountsKey(wanted));
    if (found < 0) return null;
    claimed.add(found);
  }
  return [...claimed];
}

function notYetNamed(entry: JournalEntry, expected: readonly ExpectedTaxJournalLine[], taxRatePercent: number, taxRateId: string): ExpectedTaxJournalLine[] {
  const claimed = new Set<number>();
  return expected.filter((wanted) => {
    const found = entry.lines.findIndex(
      (line, index) => !claimed.has(index) && line.taxRateId === taxRateId && line.taxRatePercent === taxRatePercent && amountsKey(line) === amountsKey(wanted),
    );
    if (found < 0) return true;
    claimed.add(found);
    return false;
  });
}

// INVARIANT: naming the rate moves the entry's amounts from the VAT return's
// unnamed row to a named one, so it is refused once the return covering the
// ENTRY's own date is filed — exactly as a posting dated there would be. A
// closed fiscal period does not refuse it: no balance moves.
export function createJournalTaxTagPort(deps: {
  readonly ledger: Pick<LedgerRepository, "findById" | "retagUnnamedTaxRate" | "tagJournalLines">;
  readonly vatFilings?: JournalPostingDeps["vatFilings"];
}): JournalTaxTagPort {
  return {
    async retagUnnamedTaxRate(entryId, taxRatePercent, taxRateId, expected) {
      const entry = await deps.ledger.findById(entryId);
      if (!entry) return 0;
      await assertVatNotFiled(entry.date, deps.vatFilings);
      if (!deps.ledger.retagUnnamedTaxRate) throw new JournalTaxTagUnsupportedError();
      const named = await deps.ledger.retagUnnamedTaxRate(entryId, taxRatePercent, taxRateId);
      if (!expected || expected.length === 0 || !deps.ledger.tagJournalLines) return named;
      // INVARIANT: a classification names EVERY journal line its document
      // lines posted, or none beyond what the percent found. An entry whose
      // VAT line alone carried a percent is finished here — the lines the
      // percent could not find are matched by account and amount — so it is
      // never left with its tax named and its base unnamed.
      const current = named > 0 ? ((await deps.ledger.findById(entryId)) ?? entry) : entry;
      const stillExpected = notYetNamed(current, expected, taxRatePercent, taxRateId);
      if (stillExpected.length === 0) return named;
      const matched = matchExpected(current, stillExpected, taxRatePercent);
      return matched ? named + (await deps.ledger.tagJournalLines(entryId, matched, taxRatePercent, taxRateId)) : named;
    },

    async nameExpectedLines(entryId, taxRatePercent, taxRateId, expected) {
      const entry = await deps.ledger.findById(entryId);
      if (!entry || expected.length === 0) return 0;
      await assertVatNotFiled(entry.date, deps.vatFilings);
      if (!deps.ledger.tagJournalLines) throw new JournalTaxTagUnsupportedError();
      const matched = matchExpected(entry, expected, taxRatePercent);
      return matched ? deps.ledger.tagJournalLines(entryId, matched, taxRatePercent, taxRateId) : 0;
    },

    async nameChosenLines(entryId, lineIndexes, taxRatePercent, taxRateId, expected) {
      const entry = await deps.ledger.findById(entryId);
      if (!entry || !deps.ledger.tagJournalLines) throw new JournalTaxTagUnsupportedError();
      await assertVatNotFiled(entry.date, deps.vatFilings);
      const chosen = [...new Set(lineIndexes)];
      for (const lineIndex of chosen) {
        const line = entry.lines[lineIndex];
        if (!line || !untagged(line, taxRatePercent)) throw new JournalTaxLineAlreadyNamedError(entryId, lineIndex);
      }
      const chosenKeys = chosen.map((lineIndex) => amountsKey(entry.lines[lineIndex] as JournalLine)).sort();
      const expectedKeys = expected.map(amountsKey).sort();
      if (chosenKeys.length !== expectedKeys.length || chosenKeys.some((key, index) => key !== expectedKeys[index])) {
        throw new JournalTaxLinesMismatchError(
          entryId,
          expected.map((line) => ({ accountId: line.accountId, debit: line.debit.toString(), credit: line.credit.toString() })),
        );
      }
      const before = chosen.map((lineIndex) => tagOf(entry.lines[lineIndex] as JournalLine, lineIndex));
      const named = await deps.ledger.tagJournalLines(entryId, chosen, taxRatePercent, taxRateId);
      if (named !== chosen.length) throw new JournalTaxLineAlreadyNamedError(entryId, chosen[0] ?? 0);
      return { before, after: before.map((tag) => ({ ...tag, taxRatePercent, taxRateId })) };
    },
  };
}
