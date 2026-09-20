import { z } from "zod";
import { isoDay } from "../iso-date.js";
import { glJournalLineSchema } from "../gl.js";

/**
 * Wire contracts for recurring & template journal automation (ENH-E2-02).
 * Contracts must not depend on the domain (see `money-string.ts`), so the
 * closed value sets are re-declared here as their own `z.nativeEnum` — same
 * string values as `RecurringJournalFrequency`/`RecurringJournalTemplateStatus`
 * in `@mezan/domain`.
 */
export enum RecurringJournalFrequencyDTO {
  Monthly = "monthly",
  Quarterly = "quarterly",
  Yearly = "yearly",
}

export enum RecurringJournalTemplateStatusDTO {
  Active = "active",
  Paused = "paused",
}

export const recurringJournalFrequencySchema = z.nativeEnum(RecurringJournalFrequencyDTO);
export const recurringJournalTemplateStatusSchema = z.nativeEnum(RecurringJournalTemplateStatusDTO);

/** Same shape a hand-written GL journal line takes — the engine that posts a template's lines is the same one. */
export const recurringJournalTemplateLineSchema = glJournalLineSchema;
export type RecurringJournalTemplateLineDTO = z.infer<typeof recurringJournalTemplateLineSchema>;

const scheduleFields = {
  frequency: recurringJournalFrequencySchema,
  dayOfPeriod: z.number().int().min(1).max(31),
  /** Yearly templates only — which calendar month (1-12) the entry falls in. */
  yearlyMonth: z.number().int().min(1).max(12).nullable(),
  startDate: isoDay,
  endDate: isoDay.nullable(),
  autoReverseNextPeriod: z.boolean(),
};

export const createRecurringJournalTemplateSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  memo: z.string().min(1),
  ...scheduleFields,
  lines: z.array(recurringJournalTemplateLineSchema).min(2),
});
export type CreateRecurringJournalTemplateDTO = z.infer<typeof createRecurringJournalTemplateSchema>;

export const updateRecurringJournalTemplateSchema = z.object({
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  memo: z.string().min(1),
  ...scheduleFields,
  lines: z.array(recurringJournalTemplateLineSchema).min(2),
});
export type UpdateRecurringJournalTemplateDTO = z.infer<typeof updateRecurringJournalTemplateSchema>;

export const setRecurringJournalTemplateStatusSchema = z.object({
  status: recurringJournalTemplateStatusSchema,
});
export type SetRecurringJournalTemplateStatusDTO = z.infer<typeof setRecurringJournalTemplateStatusSchema>;

export const generateDueRecurringJournalsSchema = z.object({
  /** Defaults to the tenant's today; a day only, so a run is reproducible. */
  asOfDate: isoDay.optional(),
  /** Restrict to these templates (the screen's per-template "generate now"); omit for every due template. */
  templateIds: z.array(z.string().min(1)).optional(),
});
export type GenerateDueRecurringJournalsDTO = z.infer<typeof generateDueRecurringJournalsSchema>;

/** "Save as template" on JournalsScreen — the schedule is asked for; the lines come straight off the entry being saved. */
export const saveJournalEntryAsTemplateSchema = z.object({
  id: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  ...scheduleFields,
});
export type SaveJournalEntryAsTemplateDTO = z.infer<typeof saveJournalEntryAsTemplateSchema>;

/** A generated draft, as `POST /gl/recurring/generate-due` reports it (the worklist's result toast/history). */
export const generatedRecurringJournalSchema = z.object({
  templateId: z.string(),
  templateNameAr: z.string(),
  period: z.string(),
  journalEntryId: z.string(),
  journalEntryNo: z.string().nullable(),
  reversalJournalEntryId: z.string().nullable(),
  reversalJournalEntryNo: z.string().nullable(),
});
export type GeneratedRecurringJournalDTO = z.infer<typeof generatedRecurringJournalSchema>;

/** "Skip this occurrence" — `POST /gl/recurring/templates/:id/skip`. `period` is the same key `/due` reports back. */
export const skipRecurringJournalOccurrenceSchema = z.object({
  period: z.string().min(1),
  note: z.string().trim().min(1).nullish(),
});
export type SkipRecurringJournalOccurrenceDTO = z.infer<typeof skipRecurringJournalOccurrenceSchema>;
