import { z } from "zod";
import { moneyString } from "../money-string.js";

export enum CashForecastHorizonDTO {
  Days30 = "30",
  Days60 = "60",
  Days90 = "90",
}

export enum CashForecastOverdueDTO {
  Today = "today",
  Exclude = "exclude",
}

export enum CashForecastKindDTO {
  Receivable = "receivable",
  Installment = "installment",
  ReceivableOther = "receivable_other",
  Payable = "payable",
  PayableOther = "payable_other",
  ChequeIncoming = "cheque_incoming",
  ChequeOutgoing = "cheque_outgoing",
  Commitment = "commitment",
}

export enum CashForecastDirectionDTO {
  Inflow = "inflow",
  Outflow = "outflow",
}

export const cashForecastQuerySchema = z.object({
  horizon: z.nativeEnum(CashForecastHorizonDTO).default(CashForecastHorizonDTO.Days30),
  overdue: z.nativeEnum(CashForecastOverdueDTO).default(CashForecastOverdueDTO.Today),
  /** One branch, the unattributed bucket, or "" for every branch the caller may see. Never widens the caller's scope. */
  branchId: z.string().trim().max(120).default(""),
});
export type CashForecastQueryDTO = z.infer<typeof cashForecastQuerySchema>;

export const updateCashForecastThresholdSchema = z.object({
  amount: moneyString,
});
export type UpdateCashForecastThresholdDTO = z.infer<typeof updateCashForecastThresholdSchema>;

export const cashForecastItemSchema = z.object({
  id: z.string(),
  kind: z.nativeEnum(CashForecastKindDTO),
  direction: z.nativeEnum(CashForecastDirectionDTO),
  dueDate: z.string(),
  expectedDate: z.string(),
  overdue: z.boolean(),
  amount: moneyString,
  partyId: z.string().nullable(),
  partyName: z.string().nullable(),
  partyNameEn: z.string().nullable(),
  reference: z.string().nullable(),
  documentId: z.string().nullable(),
  currency: z.string().nullable(),
  branchId: z.string().nullable(),
  detail: z.string().nullable(),
});
export type CashForecastItemDTO = z.infer<typeof cashForecastItemSchema>;

export const cashForecastDaySchema = z.object({
  date: z.string(),
  opening: moneyString,
  inflows: moneyString,
  outflows: moneyString,
  closing: moneyString,
  itemCount: z.number().int(),
});
export type CashForecastDayDTO = z.infer<typeof cashForecastDaySchema>;

export const cashForecastDipSchema = z.object({
  startDate: z.string(),
  endDate: z.string().nullable(),
  lowestDate: z.string(),
  lowestBalance: moneyString,
  drivers: z.array(cashForecastItemSchema),
});
export type CashForecastDipDTO = z.infer<typeof cashForecastDipSchema>;

export const cashForecastOpeningAccountSchema = z.object({
  /** Null for a cash or bank ledger account no treasury account is tied to yet. */
  treasuryAccountId: z.string().nullable(),
  name: z.string(),
  nameEn: z.string().nullable(),
  type: z.string(),
  branchId: z.string().nullable(),
  glAccountId: z.string().nullable(),
  balance: moneyString.nullable(),
});
export type CashForecastOpeningAccountDTO = z.infer<typeof cashForecastOpeningAccountSchema>;

export const cashForecastThresholdSchema = z.object({
  amount: moneyString,
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});
export type CashForecastThresholdDTO = z.infer<typeof cashForecastThresholdSchema>;

export const cashForecastAlertSchema = z.object({
  id: z.string(),
  crossingDate: z.string(),
  threshold: moneyString,
  lowestDate: z.string(),
  lowestBalance: moneyString,
  detectedAt: z.string(),
  clearedAt: z.string().nullable(),
  notifiedCount: z.number().int(),
});
export type CashForecastAlertDTO = z.infer<typeof cashForecastAlertSchema>;

/** What a branch-narrowed forecast leaves out, so the reader is never shown a partial total as the whole. */
export const cashForecastUnattributedSchema = z.object({
  inflows: moneyString,
  outflows: moneyString,
  count: z.number().int(),
});
export type CashForecastUnattributedDTO = z.infer<typeof cashForecastUnattributedSchema>;

export const cashForecastSchema = z.object({
  today: z.string(),
  horizon: z.nativeEnum(CashForecastHorizonDTO),
  endDate: z.string(),
  overdue: z.nativeEnum(CashForecastOverdueDTO),
  branchId: z.string(),
  branchNarrowed: z.boolean(),
  unattributed: cashForecastUnattributedSchema,
  openingCash: moneyString,
  openingAccounts: z.array(cashForecastOpeningAccountSchema),
  threshold: cashForecastThresholdSchema,
  days: z.array(cashForecastDaySchema),
  items: z.array(cashForecastItemSchema),
  totals: z.object({ inflows: moneyString, outflows: moneyString, closing: moneyString }),
  byKind: z.record(z.nativeEnum(CashForecastKindDTO), moneyString),
  overdueSummary: z.object({
    receivables: moneyString,
    receivablesCount: z.number().int(),
    payables: moneyString,
    payablesCount: z.number().int(),
  }),
  excludedOverdueReceivables: moneyString,
  beyondHorizon: z.object({ inflows: moneyString, outflows: moneyString }),
  firstBelowZero: z.string().nullable(),
  firstBelowThreshold: z.string().nullable(),
  lowest: z.object({ date: z.string(), balance: moneyString }),
  runwayDays: z.number().int().nullable(),
  dips: z.array(cashForecastDipSchema),
  alert: cashForecastAlertSchema.nullable(),
  alerts: z.array(cashForecastAlertSchema),
  commitmentSources: z.number().int(),
});
export type CashForecastDTO = z.infer<typeof cashForecastSchema>;
