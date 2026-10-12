import { recordSensitiveEvent, type AuditSink } from "../audit/index.js";
import {
  RecurringJournalPeriodAlreadyGeneratedError,
  RecurringJournalPeriodAlreadySkippedError,
  RecurringJournalTemplateNotFoundError,
  type RecurringJournalSkip,
} from "./types.js";
import type { RecurringJournalRunRepository, RecurringJournalSkipRepository, RecurringJournalTemplateRepository } from "./store.js";

export interface SkipRecurringJournalOccurrenceDeps {
  readonly templates: Pick<RecurringJournalTemplateRepository, "findById">;
  readonly runs: Pick<RecurringJournalRunRepository, "findByTemplateAndPeriod">;
  readonly skips: RecurringJournalSkipRepository;
  /** Status of a run's entry: a run whose entry was reversed covers nothing, so its period may be skipped. */
  readonly entryStatusOf?: (journalEntryId: string) => Promise<string | null>;
  readonly audit?: AuditSink;
  readonly now?: () => string;
  readonly actor?: string;
  readonly idGen: () => string;
}

/**
 * Marks one (template, period) as deliberately not generated — «تخطّي هذه
 * المرة». Refuses a period a run already covers (RecurringJournalRunRepository
 * is checked FIRST, so a generated entry can never be retro-skipped out from
 * under itself) and a period already skipped (the atomic claim, not this
 * pre-check, is what actually decides a concurrent double-call).
 *
 * The audit event is written immediately after the claim succeeds — the skip
 * has no journal entry of its own, so this event IS its only durable trail
 * (visible in the security/sensitive audit stream, not only in the recurring
 * journal's own skip list).
 */
export async function skipRecurringJournalOccurrence(
  templateId: string,
  period: string,
  note: string | null,
  deps: SkipRecurringJournalOccurrenceDeps,
): Promise<RecurringJournalSkip> {
  const template = await deps.templates.findById(templateId);
  if (!template) throw new RecurringJournalTemplateNotFoundError(templateId);

  const run = await deps.runs.findByTemplateAndPeriod(templateId, period);
  if (run && (await deps.entryStatusOf?.(run.journalEntryId)) !== "reversed") {
    throw new RecurringJournalPeriodAlreadyGeneratedError(templateId, period);
  }

  const skip: RecurringJournalSkip = {
    id: deps.idGen(),
    templateId,
    period,
    note,
    skippedAt: deps.now ? deps.now() : new Date().toISOString(),
    skippedBy: deps.actor ?? "system",
  };

  const claimed = await deps.skips.save(skip);
  if (!claimed) {
    throw new RecurringJournalPeriodAlreadySkippedError(templateId, period);
  }

  if (deps.audit) {
    await recordSensitiveEvent(deps.audit, {
      module: "accounting",
      entityType: "RECURRING_JOURNAL_TEMPLATE",
      entityId: templateId,
      action: "RECURRING_JOURNAL_OCCURRENCE_SKIPPED",
      actor: deps.actor ?? "system",
      severity: "INFO",
      details: { templateId, templateNameAr: template.nameAr, period, note },
    });
  }

  return skip;
}
