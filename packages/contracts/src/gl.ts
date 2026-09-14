import { z } from "zod";
import { moneyString } from "./money-string.js";
import { costCategorySchema } from "./contracting.js";
import { isoDateOrInstant } from "./iso-date.js";

/**
 * Wire contracts for the GL posting engine (docs/archive/catalog/04 §القيود المحاسبية).
 *
 * Money crosses the wire as an exact decimal string, never a float — the
 * boundary that keeps the "no floats, ever" ledger invariant true end to end
 * (docs/archive/plan.md §2.3). The domain re-parses these strings into `Money`.
 */
export const journalEntrySourceSchema = z.enum(["manual", "system"]);
export const journalEntryStatusSchema = z.enum(["draft", "pending", "posted", "reversed"]);

export const glJournalLineSchema = z.object({
  accountId: z.string().min(1),
  debit: moneyString,
  credit: moneyString,
  memo: z.string().nullish(),
  /** Optional cost-center dimension ("مركز التكلفة") for the Cost Center P&L report. */
  costCenterId: z.string().nullish(),
  /** Original transaction currency of a multi-currency line; debit/credit stay base-currency. */
  currency: z.string().nullish(),
  /** Foreign→base exchange rate applied at confirmation, as an exact decimal string. */
  fxRate: moneyString.nullish(),
  /** VAT rate this line was charged at, so the VAT return reports the rates actually charged (D28). */
  taxRatePercent: z.number().nullish(),
  /** بُعد المشروع — the contracting project the line belongs to (D-01). */
  projectId: z.string().min(1).nullish(),
  /** فئة التكلفة — only with `projectId`; the engine refuses one without the other. */
  costCategory: costCategorySchema.nullish(),
});

/** Create (and post) a journal entry. */
/** تسجيل إقرار ضريبي مقدَّم — record that a period's VAT return went to the authority. */
export const recordVatFilingSchema = z.object({
  id: z.string().min(1),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  netAmount: moneyString,
  referenceNo: z.string().nullish(),
});
export type RecordVatFilingDTO = z.infer<typeof recordVatFilingSchema>;

/** تعديل إقرار — reopen a filed period, with the reason that made it necessary. */
export const amendVatFilingSchema = z.object({
  reason: z.string().min(1, "سبب تعديل الإقرار مطلوب"),
});
export type AmendVatFilingDTO = z.infer<typeof amendVatFilingSchema>;

/** إقفال السنة المالية — roll the year's result into retained earnings. */
export const closeFiscalYearSchema = z.object({
  year: z.number().int().min(1900).max(9999),
  retainedEarningsAccountId: z.string().min(1),
  memo: z.string().optional(),
});
export type CloseFiscalYearDTO = z.infer<typeof closeFiscalYearSchema>;

/** What إقفال السنة المالية would post, before it is posted (`GET /gl/year-end-close/:year/preview`). */
export const yearEndClosePreviewLineSchema = z.object({
  accountId: z.string(),
  accountCode: z.string(),
  accountNameAr: z.string(),
  accountType: z.enum(["revenue", "expense"]),
  projectId: z.string().nullable(),
  debit: moneyString,
  credit: moneyString,
});

export const yearEndClosePreviewSchema = z.object({
  year: z.number().int(),
  entryId: z.string(),
  date: z.string(),
  netResult: z.string(),
  revenueClosed: z.string(),
  expensesClosed: z.string(),
  lines: z.array(yearEndClosePreviewLineSchema),
});

export type YearEndClosePreviewLineDTO = z.infer<typeof yearEndClosePreviewLineSchema>;
export type YearEndClosePreviewDTO = z.infer<typeof yearEndClosePreviewSchema>;

/** The result of a posted year-end close. */
export const closeFiscalYearResultSchema = z.object({
  journalEntryId: z.string(),
  year: z.number().int(),
  netResult: z.string(),
  revenueClosed: z.string(),
  expensesClosed: z.string(),
  accountsClosed: z.number().int().nonnegative(),
});

export type CloseFiscalYearResultDTO = z.infer<typeof closeFiscalYearResultSchema>;

export const createGlJournalEntrySchema = z.object({
  id: z.string().min(1),
  /** A day, or an instant the route resolves to the tenant's day (`tenantDay`). */
  date: isoDateOrInstant,
  memo: z.string(),
  source: journalEntrySourceSchema.optional(),
  lines: z.array(glJournalLineSchema).min(2),
});

/** Reverse a posted journal entry via a reversing entry. */
export const reverseGlJournalEntrySchema = z.object({
  /** Optional — the server generates a UUID when omitted. */
  reversalId: z.string().min(1).optional(),
  date: isoDateOrInstant.optional(),
  memo: z.string().optional(),
});

/** Which module a journal entry came from (R6.3), derived from its document type. */
export const journalSourceModuleSchema = z.enum([
  "sales",
  "purchases",
  "inventory",
  "treasury",
  "manufacturing",
  "payroll",
  "assets",
  "contracting",
  "manual",
  "unknown",
]);

/** Query filter for the journal-entry list. */
export const glJournalListQuerySchema = z.object({
  status: journalEntryStatusSchema.optional(),
  source: journalEntrySourceSchema.optional(),
  sourceModule: journalSourceModuleSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export type JournalEntrySourceDTO = z.infer<typeof journalEntrySourceSchema>;
export type JournalEntryStatusDTO = z.infer<typeof journalEntryStatusSchema>;
export type GlJournalLineDTO = z.infer<typeof glJournalLineSchema>;
export type CreateGlJournalEntryDTO = z.infer<typeof createGlJournalEntrySchema>;
export type ReverseGlJournalEntryDTO = z.infer<typeof reverseGlJournalEntrySchema>;
export type GlJournalListQueryDTO = z.infer<typeof glJournalListQuerySchema>;
export type JournalSourceModuleDTO = z.infer<typeof journalSourceModuleSchema>;

/** One party's outstanding balance in one currency (R1.16). */
export const partyCurrencyBalanceSchema = z.object({
  partyId: z.string(),
  partyName: z.string(),
  currency: z.string(),
  /** What the AR/AP control account holds for this party in this currency. */
  outstandingBase: z.string(),
  /** The same balance in the currency the documents were raised in. */
  outstandingTransaction: z.string(),
  documentCount: z.number().int(),
});

export const currencyBalanceGroupSchema = z.object({
  currency: z.string(),
  outstandingBase: z.string(),
  outstandingTransaction: z.string(),
  parties: z.array(partyCurrencyBalanceSchema),
});

/** GET /gl/balances-by-currency — customer and supplier balances per currency. */
export const partyCurrencyBalanceReportSchema = z.object({
  baseCurrency: z.string(),
  receivables: z.array(currencyBalanceGroupSchema),
  payables: z.array(currencyBalanceGroupSchema),
  receivableTotalBase: z.string(),
  payableTotalBase: z.string(),
});

export type PartyCurrencyBalanceDTO = z.infer<typeof partyCurrencyBalanceSchema>;
export type CurrencyBalanceGroupDTO = z.infer<typeof currencyBalanceGroupSchema>;
export type PartyCurrencyBalanceReportDTO = z.infer<typeof partyCurrencyBalanceReportSchema>;
