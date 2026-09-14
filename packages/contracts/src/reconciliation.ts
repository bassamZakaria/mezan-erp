import { z } from "zod";
import { moneyString } from "./money-string.js";

/** Wire contract for Balance Reconciliation (docs/archive/catalog/04 "مطابقة الأرصدة"). */
export const reconciliationRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  controlAccountId: z.string(),
  subLedgerBalance: z.string(),
  glBalance: z.string(),
  difference: z.string(),
  matched: z.boolean(),
});

export const unlinkedEntryLineSchema = z.object({
  entryId: z.string(),
  entryNo: z.string().nullable(),
  date: z.string(),
  accountId: z.string(),
  memo: z.string().nullable(),
  debit: moneyString,
  credit: moneyString,
});

export const reconciliationReportSchema = z.object({
  rows: z.array(reconciliationRowSchema),
  allMatched: z.boolean(),
  unlinked: z.array(unlinkedEntryLineSchema),
});

export type ReconciliationRowDTO = z.infer<typeof reconciliationRowSchema>;
export type UnlinkedEntryLineDTO = z.infer<typeof unlinkedEntryLineSchema>;
export type ReconciliationReportDTO = z.infer<typeof reconciliationReportSchema>;
