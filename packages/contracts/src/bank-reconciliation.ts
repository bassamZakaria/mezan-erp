import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contracts for Bank Statement Reconciliation (docs/archive/catalog/04
 * §"تسوية كشوف البنك"). Money crosses the wire as an exact decimal string.
 */

export enum StatementSourceCode {
  Csv = "csv",
  Excel = "excel",
  Ofx = "ofx",
  Mt940 = "mt940",
}

export enum StatementFileFormatCode {
  Ofx = "ofx",
  Mt940 = "mt940",
}

export enum MatchSourceCode {
  Manual = "manual",
  Auto = "auto",
  Suggestion = "suggestion",
  CreatedEntry = "created_entry",
}

export enum SuggestionStatusCode {
  Pending = "pending",
  Accepted = "accepted",
  Rejected = "rejected",
  Superseded = "superseded",
}

export enum BankRuleDirectionCode {
  Any = "any",
  MoneyIn = "in",
  MoneyOut = "out",
}

export enum BankRuleMatchTypeCode {
  Contains = "contains",
  StartsWith = "starts_with",
  Equals = "equals",
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
  source: z.nativeEnum(StatementSourceCode),
  statementNumber: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  openingBalance: moneyString,
  closingBalance: z.string(),
  status: bankStatementStatusSchema,
  importedAt: z.string(),
  finalizedAt: z.string().nullable(),
  unmatchedAtFinalize: z.number().int().nullable().optional(),
  finalizeOverrideReason: z.string().nullable().optional(),
  finalizedBy: z.string().nullable().optional(),
  differenceAtFinalize: z.string().nullable().optional(),
});

export const statementLineSchema = z.object({
  id: z.string(),
  statementId: z.string(),
  date: z.string(),
  description: z.string(),
  reference: z.string().nullable(),
  amount: moneyString,
  status: statementLineStatusSchema,
  matchedEntryId: z.string().nullable(),
  /**
   * The matched entry's human number (JE-000038). Null when the line is
   * unmatched, and also when the entry carries no number of its own — the
   * screen decides what to show then; the server never substitutes the id.
   */
  matchedEntryNo: z.string().nullable(),
  matchedAt: z.string().nullable(),
  counterparty: z.string().nullable().optional(),
  /** Every entry the line is matched to — one, or N for a split whose amounts sum exactly to the line. */
  matchedEntryIds: z.array(z.string()).optional(),
  matchedEntryNos: z.array(z.string().nullable()).optional(),
  matchSource: z.nativeEnum(MatchSourceCode).nullable().optional(),
});

/** Import a CSV bank statement. The raw file content crosses as text. */
export const importBankStatementSchema = z.object({
  id: z.string().min(1).optional(),
  treasuryAccountId: z.string().min(1),
  rawCsv: z.string().min(1),
  mapping: columnMappingInputSchema,
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  openingBalance: moneyString,
  closingBalance: z.string(),
  statementNumber: z.string().nullish(),
  /** An Excel statement is converted to CSV text in the browser; this records the file it came from. */
  source: z.enum([StatementSourceCode.Csv, StatementSourceCode.Excel]).optional(),
});

/** Import an OFX or MT940 statement; balances and the period default to what the file states. */
export const importStatementFileSchema = z.object({
  id: z.string().min(1).optional(),
  treasuryAccountId: z.string().min(1),
  format: z.nativeEnum(StatementFileFormatCode),
  content: z.string().min(1),
  periodStart: isoDate.nullish(),
  periodEnd: isoDate.nullish(),
  openingBalance: moneyString.nullish(),
  closingBalance: moneyString.nullish(),
  statementNumber: z.string().nullish(),
});

export const matchManyEntriesSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1).max(20),
});

export const createEntryFromLineSchema = z.object({
  accountId: z.string().min(1).nullish(),
  costCenterId: z.string().min(1).nullish(),
  ruleId: z.string().min(1).nullish(),
  memo: z.string().max(500).nullish(),
  date: isoDate.nullish(),
});

export const finalizeStatementSchema = z.object({
  force: z.boolean().optional(),
  reason: z.string().max(1000).optional(),
});

export const bankRuleInputSchema = z.object({
  name: z.string().min(1).max(120),
  treasuryAccountId: z.string().min(1).nullable().default(null),
  pattern: z.string().min(1).max(200),
  matchType: z.nativeEnum(BankRuleMatchTypeCode).default(BankRuleMatchTypeCode.Contains),
  direction: z.nativeEnum(BankRuleDirectionCode).default(BankRuleDirectionCode.Any),
  accountId: z.string().min(1),
  costCenterId: z.string().min(1).nullable().default(null),
  priority: z.number().int().min(0).max(9999).default(100),
  active: z.boolean().default(true),
});

export const bankRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  treasuryAccountId: z.string().nullable(),
  pattern: z.string(),
  matchType: z.nativeEnum(BankRuleMatchTypeCode),
  direction: z.nativeEnum(BankRuleDirectionCode),
  accountId: z.string(),
  costCenterId: z.string().nullable(),
  priority: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const matchStatementLineSchema = z.object({
  entryId: z.string().min(1),
});

export const addManualLineSchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().min(1),
  description: z.string().min(1),
  reference: z.string().nullish(),
  amount: moneyString,
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
  amount: moneyString,
  description: z.string().nullable(),
});

export const reviewEntrySchema = z.object({
  entryId: z.string(),
  entryNo: z.string().nullable(),
  docNo: z.string().nullable(),
  date: z.string(),
  amount: moneyString,
  description: z.string().nullable(),
  reference: z.string().nullable(),
  counterparty: z.string().nullable(),
});

export const matchSuggestionSchema = z.object({
  id: z.string(),
  lineId: z.string(),
  entryIds: z.array(z.string()),
  entries: z.array(reviewEntrySchema),
  score: z.number().int().min(0).max(100),
  amountScore: z.number().int(),
  dateScore: z.number().int(),
  referenceScore: z.number().int(),
  counterpartyScore: z.number().int(),
  dateDeltaDays: z.number().int(),
  status: z.nativeEnum(SuggestionStatusCode),
});

export const reviewItemSchema = z.object({
  lineId: z.string(),
  suggestions: z.array(matchSuggestionSchema),
  rule: bankRuleSchema.nullable(),
});

/** The statement's reconciliation position; every amount is exact to the micro-unit. */
export const reconciliationPositionSchema = z.object({
  openingBalance: moneyString,
  closingBalance: moneyString,
  clearedBalance: moneyString,
  difference: moneyString,
  statementLinesTotal: moneyString,
  statementArithmeticGap: moneyString,
  unmatchedLines: z.object({ count: z.number().int(), total: moneyString }),
  bookBalance: moneyString.nullable(),
  bookDifference: moneyString.nullable(),
  outstandingBook: z.object({ count: z.number().int(), total: moneyString, items: z.array(reviewEntrySchema) }),
  unexplainedBookDifference: moneyString.nullable(),
});

export const bankStatementReviewSchema = z.object({
  position: reconciliationPositionSchema,
  items: z.array(reviewItemSchema),
});

export const autoMatchResultSchema = z.object({
  matchedCount: z.number().int(),
  suggestedCount: z.number().int(),
});

export const createEntryResultSchema = z.object({
  held: z.boolean(),
  voucherId: z.string(),
  voucherNo: z.string().nullable(),
  entryId: z.string().nullable(),
  line: statementLineSchema,
  ruleId: z.string().nullable(),
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
export type ImportStatementFileDTO = z.infer<typeof importStatementFileSchema>;
export type MatchManyEntriesDTO = z.infer<typeof matchManyEntriesSchema>;
export type CreateEntryFromLineDTO = z.infer<typeof createEntryFromLineSchema>;
export type FinalizeStatementDTO = z.infer<typeof finalizeStatementSchema>;
export type BankRuleInputDTO = z.input<typeof bankRuleInputSchema>;
export type BankRuleDTO = z.infer<typeof bankRuleSchema>;
export type ReviewEntryDTO = z.infer<typeof reviewEntrySchema>;
export type MatchSuggestionDTO = z.infer<typeof matchSuggestionSchema>;
export type ReviewItemDTO = z.infer<typeof reviewItemSchema>;
export type ReconciliationPositionDTO = z.infer<typeof reconciliationPositionSchema>;
export type BankStatementReviewDTO = z.infer<typeof bankStatementReviewSchema>;
export type AutoMatchResultDTO = z.infer<typeof autoMatchResultSchema>;
export type CreateEntryResultDTO = z.infer<typeof createEntryResultSchema>;
