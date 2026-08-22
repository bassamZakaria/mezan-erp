import { Money } from "./money/index.js";
import type { JournalEntry, JournalLine, UnitOfWork } from "./journal.js";

/** Raised when a journal entry does not satisfy Σdebit = Σcredit. */
export class UnbalancedEntryError extends Error {
  readonly code = "UNBALANCED_ENTRY";
  constructor(
    readonly totalDebit: Money,
    readonly totalCredit: Money,
  ) {
    super(
      `Journal entry is unbalanced: debits ${totalDebit.toString()} != credits ${totalCredit.toString()}`,
    );
    this.name = "UnbalancedEntryError";
  }
}

/** Raised when an entry is structurally invalid (too few lines, etc.). */
export class InvalidJournalEntryError extends Error {
  readonly code = "INVALID_JOURNAL_ENTRY";
  constructor(message: string) {
    super(message);
    this.name = "InvalidJournalEntryError";
  }
}

export interface PostJournalEntryCommand {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly JournalLine[];
}

/**
 * The one domain service the spike proves out.
 *
 * Enforces the double-entry invariant (Σdebit = Σcredit), stamps the entry
 * "posted", and persists it inside exactly one transaction. Pure domain logic:
 * it knows nothing of HTTP or SQL — only the UnitOfWork port.
 */
export async function postJournalEntry(
  cmd: PostJournalEntryCommand,
  uow: UnitOfWork,
): Promise<JournalEntry> {
  if (cmd.lines.length < 2) {
    throw new InvalidJournalEntryError(
      "A journal entry requires at least two lines.",
    );
  }

  const totalDebit = Money.sum(cmd.lines.map((l) => l.debit));
  const totalCredit = Money.sum(cmd.lines.map((l) => l.credit));

  if (!totalDebit.equals(totalCredit)) {
    throw new UnbalancedEntryError(totalDebit, totalCredit);
  }

  const entry: JournalEntry = {
    id: cmd.id,
    date: cmd.date,
    memo: cmd.memo,
    status: "posted",
    lines: cmd.lines,
  };

  return uow.transaction(async (tx) => {
    await tx.journal.save(entry);
    return entry;
  });
}
