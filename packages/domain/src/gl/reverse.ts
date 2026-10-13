import type { JournalEntry, JournalLine } from "../journal.js";
import { recordSensitiveEvent } from "../audit/index.js";
import { assertBalanced, assertPeriodOpen, assertVatNotFiled, type JournalPostingDeps } from "./post.js";
import { namingEarliestOpenDay } from "../fiscal-periods/errors.js";
import {
  JournalEntryAlreadyReversedError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
} from "./errors.js";

const JOURNAL_ENTRY_SEQUENCE = "JOURNAL_ENTRY";

export interface ReverseJournalEntryOptions {
  /** Id for the new reversing entry (caller-supplied so the domain stays pure — no id generation). */
  readonly reversalId: string;
  /** Date the reversing entry is posted into; defaults to the original's date. Period-gated. */
  readonly date?: string;
  /** Memo for the reversing entry; defaults to an "عكس القيد …" note. */
  readonly memo?: string;
  /**
   * Applied to each mirrored line before it posts — every other dimension
   * still comes straight from the original. Exists for callers correcting an
   * entry that predates a dimension the domain now expects (e.g. a legacy
   * opening balance whose control-account line never named its party, D241):
   * the reversal can carry what the original never did, without rewriting the
   * original itself.
   */
  readonly linePatch?: (line: JournalLine) => JournalLine;
  /**
   * ORDER MATTERS: called inside the reversal's transaction once its number is
   * allocated and before it is saved. The balanced lines it returns are booked
   * in the reversing entry itself, after the mirrored ones.
   */
  readonly appendLines?: (reversal: { readonly id: string; readonly entryNo: string }) => Promise<readonly JournalLine[]>;
}

export interface ReverseJournalEntryResult {
  /** The original entry, now status "reversed" and linked to the reversing entry. */
  readonly original: JournalEntry;
  /** The newly posted reversing entry. */
  readonly reversal: JournalEntry;
}

/**
 * Mirror a line: a debit becomes a credit of the same amount and vice-versa.
 *
 * EVERY DIMENSION TRAVELS WITH IT. A reversal that keeps only the account and
 * the amount un-tags itself: cost-centre P&L never nets it out, the VAT return
 * cannot reverse it into the rate it was charged at, and FX revaluation cannot
 * see it at all — so a second revaluation at an unchanged rate posts a further
 * gain. Copy the whole line and swap the two sides; anything added to
 * `JournalLine` must appear here too.
 */
function mirror(line: JournalLine): JournalLine {
  return {
    ...line,
    debit: line.credit,
    credit: line.debit,
    memo: line.memo ?? null,
  };
}

/**
 * Reverse a posted entry the ONLY correct way (docs/archive/plan.md §3 rule 1;
 * docs/archive/catalog/04): never mutate or delete the posted entry — post a new,
 * mirror-image reversing entry and mark the original "reversed", linked to it.
 *
 * The reversing entry is itself a normal posted entry (source "system"): it is
 * period-gated on its own date, number-stamped by the numbering engine, and its
 * lines are the originals with debit/credit swapped, so it is balanced by
 * construction. Both writes and the two links happen in one transaction.
 */
export async function reverseJournalEntry(
  entryId: string,
  deps: JournalPostingDeps,
  opts: ReverseJournalEntryOptions,
): Promise<ReverseJournalEntryResult> {
  const original = await deps.ledger.findById(entryId);
  if (!original) throw new JournalEntryNotFoundError(entryId);
  // Check already-reversed before status: a reversed entry's status is
  // "reversed", so this gives the more specific error for a double-reversal.
  if (original.reversedByEntryId) {
    throw new JournalEntryAlreadyReversedError(entryId, original.reversedByEntryId);
  }
  if (original.status !== "posted") {
    throw new JournalEntryNotPostedError(entryId, original.status);
  }

  const reversalDate = opts.date ?? original.date;
  const reversalLines = original.lines.map(mirror).map(opts.linePatch ?? ((line) => line));
  const { totalDebit, totalCredit } = assertBalanced(reversalLines);
  await namingEarliestOpenDay(deps.periods, original.date, () => assertPeriodOpen(reversalDate, deps.periods));
  // The filed-VAT lock is a second, independent gate: an accounting period can
  // legitimately be open after its return has gone to the authority, and a
  // reversal dated into a filed period would restate a filed return (B-11).
  await assertVatNotFiled(reversalDate, deps.vatFilings);

  const stamp = deps.now ? deps.now() : new Date().toISOString();
  const memo = opts.memo ?? `عكس القيد ${original.entryNo ?? original.id}`;

  const result = await deps.ledger.transaction(async () => {
    const number = await deps.numbering.next(JOURNAL_ENTRY_SEQUENCE);
    const appended = (await opts.appendLines?.({ id: opts.reversalId, entryNo: number.formatted })) ?? [];
    if (appended.length > 0) assertBalanced(appended);
    const reversal: JournalEntry = {
      id: opts.reversalId,
      entryNo: number.formatted,
      date: reversalDate,
      memo,
      status: "posted",
      source: "system",
      lines: appended.length > 0 ? [...reversalLines, ...appended] : reversalLines,
      createdAt: stamp,
      postedAt: stamp,
      reversesEntryId: original.id,
      reversedByEntryId: null,
      // The mirror belongs to the same document's trail (R6.3): without these a
      // reversal is filed under no module at all.
      sourceDocType: original.sourceDocType ?? null,
      sourceDocId: original.sourceDocId ?? null,
      sourceDocNumber: original.sourceDocNumber ?? null,
    };
    await deps.ledger.save(reversal);

    const reversedOriginal: JournalEntry = {
      ...original,
      status: "reversed",
      reversedByEntryId: reversal.id,
    };
    await deps.ledger.update(reversedOriginal);

    // The audit row rides in the reversal's own transaction: recorded after the
    // commit it could be lost on a crash, and a rolled-back reversal could still
    // leave a record claiming the entry was reversed.
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: "accounting",
        entityType: "JOURNAL_ENTRY",
        entityId: original.id,
        action: "REVERSE",
        actor: deps.actor ?? "system",
        severity: "WARNING",
        details: {
          entryId: original.id,
          entryNo: original.entryNo,
          reversalId: reversal.id,
          reversalNo: reversal.entryNo,
          date: reversalDate,
          totalDebit: totalDebit.toString(),
        },
      });
    }

    return { original: reversedOriginal, reversal };
  });
  deps.events?.publish({
    type: "JOURNAL_ENTRY_REVERSED",
    entryId: result.reversal.id,
    entryNo: result.reversal.entryNo ?? null,
    date: reversalDate,
    source: "system",
    totalDebit,
    totalCredit,
    reversesEntryId: original.id,
    occurredAt: stamp,
  });

  return result;
}
