import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * كشف حساب العميل / المورد — `GET /reports/statements/{customers|suppliers}/:id`.
 * Every amount is in BASE currency. `increase` raises what the party owes (a
 * customer debit, a supplier credit); `closing` equals the party's aging row,
 * which the server sends beside it as `agingTotal`.
 */
export const partyStatementEntryKindSchema = z.enum([
  "opening",
  "invoice",
  "return",
  "receipt",
  "payment",
  "refund",
  "cheque",
  "cheque_returned",
  "deduction",
  "journal",
  "imported",
  "fx_difference",
]);

export const partyStatementLineSchema = z.object({
  key: z.string(),
  date: z.string(),
  kind: partyStatementEntryKindSchema,
  reference: z.string(),
  increase: moneyString,
  decrease: moneyString,
  balance: moneyString,
  allocations: z.array(z.object({ invoiceRef: z.string(), amount: moneyString })),
});

export const partyStatementSchema = z.object({
  partyId: z.string(),
  asOfDate: z.string(),
  lines: z.array(partyStatementLineSchema),
  totalIncrease: moneyString,
  totalDecrease: moneyString,
  closing: moneyString,
  agingTotal: moneyString,
});

export type PartyStatementEntryKindDTO = z.infer<typeof partyStatementEntryKindSchema>;
export type PartyStatementLineDTO = z.infer<typeof partyStatementLineSchema>;
export type PartyStatementDTO = z.infer<typeof partyStatementSchema>;
