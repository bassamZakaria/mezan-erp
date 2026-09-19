import { randomUUID } from "node:crypto";
import { createJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import { duePeriods, journalDateForPeriod, nextPeriodFirstDate } from "./schedule.js";
import { RecurringJournalTemplateStatus, type RecurringJournalTemplate } from "./types.js";
import type { RecurringJournalRunRepository, RecurringJournalTemplateRepository } from "./store.js";

export interface GenerateDueRecurringJournalsDeps extends JournalPostingDeps {
  readonly templates: Pick<RecurringJournalTemplateRepository, "list">;
  readonly runs: RecurringJournalRunRepository;
  readonly idGen?: () => string;
}

export interface GenerateDueRecurringJournalsOptions {
  readonly asOfDate: string;
  /** Restrict the sweep to these templates (the screen's per-template "generate now"); omit for every due template. */
  readonly templateIds?: readonly string[];
}

export interface GeneratedRecurringJournal {
  readonly templateId: string;
  readonly templateNameAr: string;
  readonly period: string;
  readonly journalEntryId: string;
  readonly journalEntryNo: string | null;
  readonly reversalJournalEntryId: string | null;
  readonly reversalJournalEntryNo: string | null;
}

/**
 * `POST /gl/recurring/generate-due` (ENH-E2-02). Idempotent per (template,
 * period): a period a `RecurringJournalRun` already covers is skipped, never
 * regenerated. Every entry this creates is a DRAFT ONLY — D226 made drafts
 * editable, so the worklist review-and-post step is a real one, not a
 * rubber stamp. No timer calls this on the tenant's behalf (ROADMAP DEC-28,
 * plan §3.3): the desktop only shows what is due, and the cloud edition calls
 * it on a schedule the TENANT opted into.
 */
export async function generateDueRecurringJournals(
  deps: GenerateDueRecurringJournalsDeps,
  opts: GenerateDueRecurringJournalsOptions,
): Promise<GeneratedRecurringJournal[]> {
  const idGen = deps.idGen ?? (() => randomUUID());
  const templates = await deps.templates.list();
  const scope = opts.templateIds ? new Set(opts.templateIds) : null;
  const generated: GeneratedRecurringJournal[] = [];

  for (const template of templates) {
    if (template.status !== RecurringJournalTemplateStatus.Active) continue;
    if (scope && !scope.has(template.id)) continue;
    for (const period of duePeriods(template, opts.asOfDate)) {
      // The idempotency check IS this line: a period already recorded here is
      // never drafted twice, no matter how many times generate-due runs.
      if (await deps.runs.findByTemplateAndPeriod(template.id, period)) continue;
      generated.push(await generateOnePeriod(template, period, idGen, deps));
    }
  }
  return generated;
}

async function generateOnePeriod(
  template: RecurringJournalTemplate,
  period: string,
  idGen: () => string,
  deps: GenerateDueRecurringJournalsDeps,
): Promise<GeneratedRecurringJournal> {
  const date = journalDateForPeriod(template, period);
  const entry = await createJournalEntry(
    {
      id: idGen(),
      date,
      memo: `${template.memo} — ${period}`,
      source: "system",
      sourceDocType: "RECURRING_JOURNAL_TEMPLATE",
      sourceDocId: template.id,
      sourceDocNumber: template.nameAr,
      lines: template.lines,
    },
    deps,
  );

  let reversalId: string | null = null;
  let reversalNo: string | null = null;
  if (template.autoReverseNextPeriod) {
    const reversal = await createJournalEntry(
      {
        id: idGen(),
        date: nextPeriodFirstDate(template.frequency, period),
        memo: `عكس تلقائي — ${template.memo} — ${period}`,
        source: "system",
        sourceDocType: "RECURRING_JOURNAL_REVERSAL",
        sourceDocId: template.id,
        sourceDocNumber: template.nameAr,
        // Same lines, debit and credit swapped — the accrual unwinds itself
        // the moment the next period opens, dated that period's first day.
        lines: template.lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit })),
      },
      deps,
    );
    reversalId = reversal.id;
    reversalNo = reversal.entryNo ?? null;
  }

  await deps.runs.save({
    id: idGen(),
    templateId: template.id,
    period,
    journalEntryId: entry.id,
    journalEntryNo: entry.entryNo ?? null,
    reversalJournalEntryId: reversalId,
    reversalJournalEntryNo: reversalNo,
    generatedAt: deps.now ? deps.now() : new Date().toISOString(),
    generatedBy: deps.actor ?? "system",
  });

  return {
    templateId: template.id,
    templateNameAr: template.nameAr,
    period,
    journalEntryId: entry.id,
    journalEntryNo: entry.entryNo ?? null,
    reversalJournalEntryId: reversalId,
    reversalJournalEntryNo: reversalNo,
  };
}
