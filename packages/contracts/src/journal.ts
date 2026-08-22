import { z } from "zod";

/**
 * Wire contract for a single journal-entry line.
 *
 * Money crosses the wire as an exact decimal string, never a float — this is
 * the boundary that keeps the "no floats, ever" ledger invariant true end to
 * end (docs/plan.md §2.3). The domain re-parses these strings into `Money`.
 */
export const journalLineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.string(),
  credit: z.string(),
});

/** Wire contract for creating (posting) a journal entry. */
export const createJournalEntrySchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string(),
  lines: z.array(journalLineSchema).min(2),
});

export type JournalLineDTO = z.infer<typeof journalLineSchema>;
export type CreateJournalEntryDTO = z.infer<typeof createJournalEntrySchema>;
