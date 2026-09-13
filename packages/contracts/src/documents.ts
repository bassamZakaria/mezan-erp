import { z } from "zod";
import { costCategorySchema } from "./contracting.js";
import { moneyString } from "./money-string.js";

/**
 * Wire contracts for the generic document framework (docs/archive/plan.md §3 document
 * lifecycle + "تأثيرات هذا المستند" effects panel). These shapes are shared by
 * every document module's api routes and the web effects panel. Money crosses
 * the wire as an exact decimal string, never a float (docs/archive/plan.md §2.3).
 */

export const documentStatusSchema = z.enum([
  "draft",
  "pending",
  "confirmed",
  "posted",
  "cancelled",
  "reversed",
]);

export const documentEffectKindSchema = z.enum(["gl", "stock", "balance", "workflow", "info"]);

export const documentEffectSchema = z.object({
  kind: documentEffectKindSchema,
  description: z.string(),
  detail: z.string().nullish(),
});

/** The computed "تأثيرات هذا المستند" descriptor returned to the effects panel. */
export const documentEffectsSchema = z.object({
  effects: z.array(documentEffectSchema),
  balanced: z.boolean().optional(),
  totalDebit: z.string().optional(),
  totalCredit: z.string().optional(),
  blocked: z.boolean(),
  blockedReason: z.string().nullish(),
});

/** A journal-document line as it crosses the wire. */
export const journalDocumentLineSchema = z.object({
  accountId: z.string().min(1),
  debit: moneyString,
  credit: moneyString,
  memo: z.string().nullish(),
  costCenterId: z.string().min(1).nullish(),
  projectId: z.string().min(1).nullish(),
  costCategory: costCategorySchema.nullish(),
});

/** Create a journal document (draft or to post in one step). */
export const createJournalDocumentSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string(),
  lines: z.array(journalDocumentLineSchema).min(2),
});

/** Compute effects for a would-be journal document (no persistence). */
export const journalDocumentEffectsRequestSchema = z.object({
  lines: z.array(journalDocumentLineSchema).min(1),
});

export type DocumentStatusDTO = z.infer<typeof documentStatusSchema>;
export type DocumentEffectKindDTO = z.infer<typeof documentEffectKindSchema>;
export type DocumentEffectDTO = z.infer<typeof documentEffectSchema>;
export type DocumentEffectsDTO = z.infer<typeof documentEffectsSchema>;
export type JournalDocumentLineDTO = z.infer<typeof journalDocumentLineSchema>;
export type CreateJournalDocumentDTO = z.infer<typeof createJournalDocumentSchema>;
export type JournalDocumentEffectsRequestDTO = z.infer<typeof journalDocumentEffectsRequestSchema>;
