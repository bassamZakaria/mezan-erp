import type { RecurringJournalRun, RecurringJournalSkip, RecurringJournalTemplate } from "./types.js";

/** Persistence port for templates. The domain depends on this interface only — no SQL, no driver. */
export interface RecurringJournalTemplateRepository {
  findById(id: string): Promise<RecurringJournalTemplate | null>;
  list(): Promise<readonly RecurringJournalTemplate[]>;
  save(template: RecurringJournalTemplate): Promise<void>;
  insert(template: RecurringJournalTemplate): Promise<void>;
}

/**
 * Persistence port for generation history — the record `generate-due` checks
 * before creating anything, so the SAME (template, period) is never drafted
 * twice.
 *
 * `findByTemplateAndPeriod` is the fast, non-claiming read used by the due
 * worklist and by `generate-due`'s first pass. `save` is the atomic claim:
 * implementations enforce `UNIQUE(template_id, period)` and `save` returns
 * `false` (never throws) when another call already recorded this period —
 * the caller (`generate-due.ts`) uses that to detect and undo a draft it
 * created just before losing a race, so a concurrent double-call cannot leave
 * an orphan entry with no run record pointing at it.
 */
export interface RecurringJournalRunRepository {
  findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalRun | null>;
  listByTemplate(templateId: string): Promise<readonly RecurringJournalRun[]>;
  /** The newest runs, of `templateIds` only when given — the limit counts the rows asked for, never rows the caller may not see. */
  list(limit?: number, templateIds?: readonly string[]): Promise<readonly RecurringJournalRun[]>;
  /** Returns `true` if this call recorded the run, `false` if (template, period) was already claimed. */
  save(run: RecurringJournalRun): Promise<boolean>;
}

/**
 * Persistence port for "skip this occurrence" — the same idempotent-claim
 * shape as {@link RecurringJournalRunRepository}, over its own table. A period
 * is claimed by EITHER a run or a skip, never both, so `generate-due` and the
 * due worklist both have to consult this port alongside the run repository.
 */
export interface RecurringJournalSkipRepository {
  findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalSkip | null>;
  listByTemplate(templateId: string): Promise<readonly RecurringJournalSkip[]>;
  list(limit?: number, templateIds?: readonly string[]): Promise<readonly RecurringJournalSkip[]>;
  /** Returns `true` if this call recorded the skip, `false` if (template, period) was already claimed. */
  save(skip: RecurringJournalSkip): Promise<boolean>;
}
