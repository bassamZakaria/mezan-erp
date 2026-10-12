import { createJournalEntry, deleteDraftJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import { duePeriods, journalDateForPeriod, nextPeriodFirstDate } from "./schedule.js";
import { RecurringJournalTemplateStatus, type RecurringJournalRun, type RecurringJournalTemplate } from "./types.js";
import type { RecurringJournalRunRepository, RecurringJournalSkipRepository, RecurringJournalTemplateRepository } from "./store.js";

export interface GenerateDueRecurringJournalsDeps extends JournalPostingDeps {
  readonly templates: Pick<RecurringJournalTemplateRepository, "list">;
  readonly runs: RecurringJournalRunRepository;
  /** A period an operator skipped is exactly as unavailable to this sweep as one a run already covers. */
  readonly skips: Pick<RecurringJournalSkipRepository, "findByTemplateAndPeriod">;
  /**
   * No ambient `node:crypto` default here — a `@mezan/domain` barrel export
   * reaches the browser bundle (this package has no server/client split), and
   * a bare `import { randomUUID } from "node:crypto"` at this module's top
   * level fails Vite's build the moment anything walks this far into the
   * `export *` graph, whether or not the fallback is ever called. The API
   * layer (Node-only) always supplies one.
   */
  readonly idGen: () => string;
}

export interface RecurringRunStanding {
  readonly standing: RecurringJournalRun | null;
  readonly reversed: RecurringJournalRun | null;
}

export async function recurringRunStanding(
  deps: { readonly runs: Pick<RecurringJournalRunRepository, "findByTemplateAndPeriod">; readonly ledger: Pick<JournalPostingDeps["ledger"], "findById"> },
  templateId: string,
  period: string,
): Promise<RecurringRunStanding> {
  const run = await deps.runs.findByTemplateAndPeriod(templateId, period);
  if (!run) return { standing: null, reversed: null };
  const entry = await deps.ledger.findById(run.journalEntryId);
  return entry?.status === "reversed" ? { standing: null, reversed: run } : { standing: run, reversed: null };
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

/** One (template, period) this sweep could not generate — a bad template must never jam every other one. */
export interface FailedRecurringJournalGeneration {
  readonly templateId: string;
  readonly templateNameAr: string;
  readonly period: string;
  readonly message: string;
}

export interface GenerateDueRecurringJournalsResult {
  readonly generated: readonly GeneratedRecurringJournal[];
  readonly failed: readonly FailedRecurringJournalGeneration[];
}

/**
 * `POST /gl/recurring/generate-due` (ENH-E2-02). Idempotent per (template,
 * period): a period a `RecurringJournalRun` already covers is skipped, never
 * regenerated — and the CLAIM on that record (see `store.ts`'s `save`) is
 * what actually decides the race, not the fast pre-check below, which exists
 * only to avoid drafting an entry it is about to discard. Every entry this
 * creates is a DRAFT ONLY — D226 made drafts editable, so the worklist
 * review-and-post step is a real one, not a rubber stamp. No timer calls this
 * on the tenant's behalf (ROADMAP DEC-28, plan §3.3): the desktop only shows
 * what is due, and the cloud edition calls it on a schedule the TENANT opted
 * into.
 *
 * One template's failure (a deactivated account, a period whose fiscal period
 * is now locked) is reported in `failed` and never stops the sweep: an
 * un-caught throw here would jam every OTHER due template behind it, turning
 * a routine close step into a support ticket.
 */
export async function generateDueRecurringJournals(
  deps: GenerateDueRecurringJournalsDeps,
  opts: GenerateDueRecurringJournalsOptions,
): Promise<GenerateDueRecurringJournalsResult> {
  const idGen = deps.idGen;
  const templates = await deps.templates.list();
  const scope = opts.templateIds ? new Set(opts.templateIds) : null;
  const generated: GeneratedRecurringJournal[] = [];
  const failed: FailedRecurringJournalGeneration[] = [];

  for (const template of templates) {
    if (template.status !== RecurringJournalTemplateStatus.Active) continue;
    if (scope && !scope.has(template.id)) continue;
    for (const period of duePeriods(template, opts.asOfDate)) {
      // The fast pre-check: a period already recorded is skipped without
      // ever drafting anything. The actual idempotency guarantee is the
      // atomic claim inside `generateOnePeriod`.
      const { standing, reversed } = await recurringRunStanding(deps, template.id, period);
      if (standing) continue;
      // A period an operator deliberately skipped is never drafted either —
      // "skip this occurrence" would be decorative if the next sweep drafted
      // it anyway.
      if (await deps.skips.findByTemplateAndPeriod(template.id, period)) continue;
      try {
        const result = await generateOnePeriod(template, period, idGen, deps, reversed);
        if (result) generated.push(result);
        // `result === null` means another call won the (template, period)
        // race between the pre-check above and the claim — already
        // generated, correctly, by that other call. Not a failure.
      } catch (err) {
        failed.push({
          templateId: template.id,
          templateNameAr: template.nameAr,
          period,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return { generated, failed };
}

async function generateOnePeriod(
  template: RecurringJournalTemplate,
  period: string,
  idGen: () => string,
  deps: GenerateDueRecurringJournalsDeps,
  reversed: RecurringJournalRun | null,
): Promise<GeneratedRecurringJournal | null> {
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

  const run: RecurringJournalRun = {
    id: idGen(),
    templateId: template.id,
    period,
    generation: reversed ? reversed.generation + 1 : 1,
    journalEntryId: entry.id,
    journalEntryNo: entry.entryNo ?? null,
    reversalJournalEntryId: reversalId,
    reversalJournalEntryNo: reversalNo,
    generatedAt: deps.now ? deps.now() : new Date().toISOString(),
    generatedBy: deps.actor ?? "system",
  };
  const claimed = await deps.runs.save(run);

  if (!claimed) {
    // Lost the race: a concurrent call recorded this (template, period)
    // between the pre-check and this claim. The drafts just created here
    // are orphans nothing points at — delete them rather than leave two
    // drafts for one accrual with only one ever discoverable from the
    // worklist's history.
    await deleteDraftJournalEntry(entry.id, deps).catch(() => {});
    if (reversalId) await deleteDraftJournalEntry(reversalId, deps).catch(() => {});
    return null;
  }

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
