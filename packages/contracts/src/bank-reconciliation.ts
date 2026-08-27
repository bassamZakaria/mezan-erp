import { z } from "zod";

/**
 * Wire contracts for Bank Statement Reconciliation (docs/catalog/04
 * §"تسوية كشوف البنك"). Money crosses the wire as an exact decimal string.
 */

export const bankStatementStatusSchema = z.enum(["imported", "in_progress", "completed"]);
export const statementLineStatusSchema = z.enum(["unmatched", "matched"]);
export const statementDateFormatSchema = z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]);

export const statementColumnMappingSchema = z.object({
  treasuryAccountId: z.string().min(1),
  dateColumn: z.string().min(1),
  descriptionColumn: z.string().min(1),
  amountColumn: z.string().nullable(),
  debitColumn: z.string().nullable(),
  creditColumn: z.string().nullable(),
  referenceColumn: z.string().nullable(),
  dateFormat: statementDateFormatSchema,
  updatedAt: z.string(),
});

/** The mapping fields the client supplies (treasuryAccountId + updatedAt are stamped server-side). */
export const columnMappingInputSchema = z.object({
  dateColumn: z.string().min(1),
  descriptionColumn: z.string().min(1),
  amountColumn: z.string().nullish(),
  debitColumn: z.string().nullish(),
  creditColumn: z.string().nullish(),
  referenceColumn: z.string().nullish(),
  dateFormat: statementDateFormatSchema.optional(),
});

export const bankStatementSchema = z.object({
  id: z.string().min(1),
  treasuryAccountId: z.string(),
  source: z.literal("csv"),
  statementNumber: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  openingBalance: z.string(),
  closingBalance: z.string(),
  status: bankStatementStatusSchema,
  importedAt: z.string(),
  finalizedAt: z.string().nullable(),
});

export const statementLineSchema = z.object({
  id: z.string(),
  statementId: z.string(),
  date: z.string(),
  description: z.string(),
  reference: z.string().nullable(),
  amount: z.string(),
  status: statementLineStatusSchema,
  matchedEntryId: z.string().nullable(),
  matchedAt: z.string().nullable(),
});

/** Import a CSV bank statement. The raw file content crosses as text. */
export const importBankStatementSchema = z.object({
  id: z.string().min(1).optional(),
  treasuryAccountId: z.string().min(1),
  rawCsv: z.string().min(1),
  mapping: columnMappingInputSchema,
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  openingBalance: z.string(),
  closingBalance: z.string(),
  statementNumber: z.string().nullish(),
});

export const matchStatementLineSchema = z.object({
  entryId: z.string().min(1),
});

export const addManualLineSchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().min(1),
  description: z.string().min(1),
  reference: z.string().nullish(),
  amount: z.string(),
});

export const matchSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
  matchRate: z.number().min(0).max(1),
});

/** A list row: the statement plus how much of it is matched, so the list can show a real rate. */
export const bankStatementListItemSchema = bankStatementSchema.extend({
  matchSummary: matchSummarySchema,
});

/** One treasury movement a statement line may be matched to (`GET /bank-statements/:id/candidates`). */
export const matchCandidateSchema = z.object({
  entryId: z.string(),
  entryNo: z.string().nullable(),
  date: z.string(),
  amount: z.string(),
  description: z.string().nullable(),
});

export const bankStatementListQuerySchema = z.object({
  treasuryAccountId: z.string().optional(),
  status: bankStatementStatusSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export type BankStatementStatusDTO = z.infer<typeof bankStatementStatusSchema>;
export type StatementLineStatusDTO = z.infer<typeof statementLineStatusSchema>;
export type StatementDateFormatDTO = z.infer<typeof statementDateFormatSchema>;
export type StatementColumnMappingDTO = z.infer<typeof statementColumnMappingSchema>;
export type ColumnMappingInputDTO = z.infer<typeof columnMappingInputSchema>;
export type BankStatementDTO = z.infer<typeof bankStatementSchema>;
export type StatementLineDTO = z.infer<typeof statementLineSchema>;
export type ImportBankStatementDTO = z.infer<typeof importBankStatementSchema>;
export type MatchStatementLineDTO = z.infer<typeof matchStatementLineSchema>;
export type AddManualLineDTO = z.infer<typeof addManualLineSchema>;
export type MatchSummaryDTO = z.infer<typeof matchSummarySchema>;
export type MatchCandidateDTO = z.infer<typeof matchCandidateSchema>;
export type BankStatementListItemDTO = z.infer<typeof bankStatementListItemSchema>;
export type BankStatementListQueryDTO = z.infer<typeof bankStatementListQuerySchema>;
