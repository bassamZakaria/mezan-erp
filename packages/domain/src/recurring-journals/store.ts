import type { RecurringJournalRun, RecurringJournalTemplate } from "./types.js";

/** Persistence port for templates. The domain depends on this interface only — no SQL, no driver. */
export interface RecurringJournalTemplateRepository {
  findById(id: string): Promise<RecurringJournalTemplate | null>;
  list(): Promise<readonly RecurringJournalTemplate[]>;
  save(template: RecurringJournalTemplate): Promise<void>;
}

/**
 * Persistence port for generation history — the record `generate-due` checks
 * before creating anything, so the SAME (template, period) is never drafted
 * twice. Implementations enforce this with a UNIQUE(template_id, period)
 * constraint as the last line of defence against a concurrent double-call;
 * `save` is expected to no-op (never throw) on that conflict, since the caller
 * already checked `findByTemplateAndPeriod` first.
 */
export interface RecurringJournalRunRepository {
  findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalRun | null>;
  listByTemplate(templateId: string): Promise<readonly RecurringJournalRun[]>;
  list(limit?: number): Promise<readonly RecurringJournalRun[]>;
  save(run: RecurringJournalRun): Promise<void>;
}
