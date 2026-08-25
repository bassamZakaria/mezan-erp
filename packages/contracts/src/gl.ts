import { z } from "zod";

/**
 * Wire contracts for the GL posting engine (docs/catalog/04 §القيود المحاسبية).
 *
 * Money crosses the wire as an exact decimal string, never a float — the
 * boundary that keeps the "no floats, ever" ledger invariant true end to end
 * (docs/plan.md §2.3). The domain re-parses these strings into `Money`.
 */
export const journalEntrySourceSchema = z.enum(["manual", "system"]);
export const journalEntryStatusSchema = z.enum(["draft", "pending", "posted", "reversed"]);

export const glJournalLineSchema = z.object({
  accountId: z.string().min(1),
  debit: z.string(),
  credit: z.string(),
  memo: z.string().nullish(),
  /** Optional cost-center dimension ("مركز التكلفة") for the Cost Center P&L report. */
  costCenterId: z.string().nullish(),
  /** Original transaction currency of a multi-currency line; debit/credit stay base-currency. */
  currency: z.string().nullish(),
  /** Foreign→base exchange rate applied at confirmation, as an exact decimal string. */
  fxRate: z.string().nullish(),
});

/** Create (and post) a journal entry. */
/** إقفال السنة المالية — roll the year's result into retained earnings. */
export const closeFiscalYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  retainedEarningsAccountId: z.string().min(1),
  memo: z.string().optional(),
});
export type CloseFiscalYearDTO = z.infer<typeof closeFiscalYearSchema>;

export const createGlJournalEntrySchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string(),
  source: journalEntrySourceSchema.optional(),
  lines: z.array(glJournalLineSchema).min(2),
});

/** Reverse a posted journal entry via a reversing entry. */
export const reverseGlJournalEntrySchema = z.object({
  /** Optional — the server generates a UUID when omitted. */
  reversalId: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  memo: z.string().optional(),
});

/** Query filter for the journal-entry list. */
export const glJournalListQuerySchema = z.object({
  status: journalEntryStatusSchema.optional(),
  source: journalEntrySourceSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export type JournalEntrySourceDTO = z.infer<typeof journalEntrySourceSchema>;
export type JournalEntryStatusDTO = z.infer<typeof journalEntryStatusSchema>;
export type GlJournalLineDTO = z.infer<typeof glJournalLineSchema>;
export type CreateGlJournalEntryDTO = z.infer<typeof createGlJournalEntrySchema>;
export type ReverseGlJournalEntryDTO = z.infer<typeof reverseGlJournalEntrySchema>;
export type GlJournalListQueryDTO = z.infer<typeof glJournalListQuerySchema>;
