import { RecurringJournalTemplateNotFoundError, RecurringJournalTemplateStatus, type RecurringJournalFrequency, type RecurringJournalTemplate, type RecurringJournalTemplateLine } from "./types.js";
import { assertValidSchedule, assertValidTemplateLines, type ValidateTemplateDeps } from "./validate.js";
import type { RecurringJournalTemplateRepository } from "./store.js";

export interface RecurringJournalTemplateDeps extends ValidateTemplateDeps {
  readonly templates: RecurringJournalTemplateRepository;
  readonly now?: () => string;
}

function nowIso(deps: Pick<RecurringJournalTemplateDeps, "now">): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

export interface CreateRecurringJournalTemplateCommand {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly memo: string;
  readonly frequency: RecurringJournalFrequency;
  readonly dayOfPeriod: number;
  readonly yearlyMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly autoReverseNextPeriod: boolean;
  readonly lines: readonly RecurringJournalTemplateLine[];
}

export async function createRecurringJournalTemplate(
  cmd: CreateRecurringJournalTemplateCommand,
  deps: RecurringJournalTemplateDeps,
): Promise<RecurringJournalTemplate> {
  assertValidSchedule(cmd);
  await assertValidTemplateLines(cmd.lines, deps);
  const timestamp = nowIso(deps);
  const template: RecurringJournalTemplate = {
    id: cmd.id,
    nameAr: cmd.nameAr,
    nameEn: cmd.nameEn,
    memo: cmd.memo,
    frequency: cmd.frequency,
    dayOfPeriod: cmd.dayOfPeriod,
    yearlyMonth: cmd.yearlyMonth,
    startDate: cmd.startDate,
    endDate: cmd.endDate,
    autoReverseNextPeriod: cmd.autoReverseNextPeriod,
    status: RecurringJournalTemplateStatus.Active,
    lines: cmd.lines,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await deps.templates.save(template);
  return template;
}

export interface UpdateRecurringJournalTemplateCommand {
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly memo: string;
  readonly frequency: RecurringJournalFrequency;
  readonly dayOfPeriod: number;
  readonly yearlyMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly autoReverseNextPeriod: boolean;
  readonly lines: readonly RecurringJournalTemplateLine[];
}

/**
 * Edits a template going forward. Runs already generated are historical
 * records of what was posted at the time and are never rewritten — only the
 * schedule and lines used for periods still to come change.
 */
export async function updateRecurringJournalTemplate(
  id: string,
  cmd: UpdateRecurringJournalTemplateCommand,
  deps: RecurringJournalTemplateDeps,
): Promise<RecurringJournalTemplate> {
  const existing = await deps.templates.findById(id);
  if (!existing) throw new RecurringJournalTemplateNotFoundError(id);
  assertValidSchedule(cmd);
  await assertValidTemplateLines(cmd.lines, deps);
  const updated: RecurringJournalTemplate = {
    ...existing,
    nameAr: cmd.nameAr,
    nameEn: cmd.nameEn,
    memo: cmd.memo,
    frequency: cmd.frequency,
    dayOfPeriod: cmd.dayOfPeriod,
    yearlyMonth: cmd.yearlyMonth,
    startDate: cmd.startDate,
    endDate: cmd.endDate,
    autoReverseNextPeriod: cmd.autoReverseNextPeriod,
    lines: cmd.lines,
    updatedAt: nowIso(deps),
  };
  await deps.templates.save(updated);
  return updated;
}

/** Pause/resume (§3.3, the worklist never generates for a paused template). */
export async function setRecurringJournalTemplateStatus(
  id: string,
  status: RecurringJournalTemplateStatus,
  deps: Pick<RecurringJournalTemplateDeps, "templates" | "now">,
): Promise<RecurringJournalTemplate> {
  const existing = await deps.templates.findById(id);
  if (!existing) throw new RecurringJournalTemplateNotFoundError(id);
  const updated: RecurringJournalTemplate = { ...existing, status, updatedAt: nowIso(deps) };
  await deps.templates.save(updated);
  return updated;
}
