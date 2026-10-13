import { z } from "zod";
import { moneyString } from "./money-string.js";
import { isoDateOrInstant } from "./iso-date.js";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contracts for the Cheque Register (docs/archive/catalog/04 §"سجل الشيكات").
 * Money crosses the wire as an exact decimal string, never a float — the
 * domain re-parses it via `Money.fromMajor`.
 */

export const chequeDirectionSchema = z.enum(["incoming", "outgoing"]);
export const chequeStoredStatusSchema = z.enum(["pending", "deposited", "collected", "bounced", "replaced"]);
export const chequeStatusSchema = z.enum(["pending", "under_collection", "due_today", "deposited", "collected", "bounced", "replaced"]);

export const chequeControlAccountsSchema = z.object({
  underCollectionAccountId: z.string().min(1),
  bouncedAccountId: z.string().nullish(),
});

/** One ACTIVE application of a cheque against an invoice. */
export const chequeAllocationSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  amount: moneyString,
  date: z.string().nullable().optional(),
});

/** Apply part or all of a cheque against one of its party's open invoices. */
export const createChequeAllocationSchema = z.object({
  allocationId: clientSuppliedId.optional(),
  invoiceId: z.string().min(1),
  amount: moneyString,
  date: isoDateOrInstant.optional(),
});

/** A cheque as it crosses the wire. */
export const chequeSchema = z.object({
  id: z.string().min(1),
  direction: chequeDirectionSchema,
  status: chequeStoredStatusSchema,
  effectiveStatus: chequeStatusSchema,
  chequeNumber: z.string(),
  bankName: z.string(),
  bankBranchName: z.string().nullable(),
  bankAccountNumber: z.string().nullable(),
  amount: moneyString,
  currency: z.string(),
  issueDate: z.string(),
  dueDate: z.string(),
  branchId: z.string(),
  notes: z.string().nullable(),
  partyId: z.string(),
  counterpartyGlAccountId: z.string(),
  controlAccounts: chequeControlAccountsSchema,
  bankTreasuryAccountId: z.string().nullable(),
  createdAt: z.string(),
  depositedAt: z.string().nullable(),
  collectedAt: z.string().nullable(),
  bouncedAt: z.string().nullable(),
  replacesChequeId: z.string().nullable(),
  replacedByChequeId: z.string().nullable(),
  creationJournalEntryId: z.string().nullable(),
  collectionJournalEntryId: z.string().nullable(),
  bounceJournalEntryId: z.string().nullable(),
  allocations: z.array(chequeAllocationSchema).optional(),
});

/** Record a newly received/issued cheque. */
export const createChequeSchema = z.object({
  id: clientSuppliedId.optional(),
  direction: chequeDirectionSchema,
  chequeNumber: z.string().min(1),
  bankName: z.string().min(1),
  bankBranchName: z.string().nullish(),
  bankAccountNumber: z.string().nullish(),
  amount: moneyString,
  currency: z.string().optional(),
  issueDate: isoDateOrInstant,
  dueDate: z.string().min(1),
  branchId: z.string().min(1),
  notes: z.string().nullish(),
  partyId: z.string().min(1),
  counterpartyGlAccountId: z.string().min(1),
  controlAccounts: chequeControlAccountsSchema,
});

export const depositChequeSchema = z.object({
  bankTreasuryAccountId: z.string().min(1),
});

export const collectChequeSchema = z.object({
  bankGlAccountId: z.string().min(1).optional(),
  date: isoDateOrInstant.optional(),
});

export const bounceChequeSchema = z.object({
  date: isoDateOrInstant.optional(),
});

/** Replace a bounced cheque with a new one of the same amount. */
export const replaceChequeSchema = z.object({
  newCheque: z.object({
    id: clientSuppliedId.optional(),
    chequeNumber: z.string().min(1),
    bankName: z.string().min(1),
    bankBranchName: z.string().nullish(),
    bankAccountNumber: z.string().nullish(),
    issueDate: z.string().min(1),
    dueDate: z.string().min(1),
    branchId: z.string().min(1),
    notes: z.string().nullish(),
  }),
  date: isoDateOrInstant.optional(),
});

export const chequeListQuerySchema = z.object({
  direction: chequeDirectionSchema.optional(),
  status: chequeStatusSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export type ChequeDirectionDTO = z.infer<typeof chequeDirectionSchema>;
export type ChequeStoredStatusDTO = z.infer<typeof chequeStoredStatusSchema>;
export type ChequeStatusDTO = z.infer<typeof chequeStatusSchema>;
export type ChequeControlAccountsDTO = z.infer<typeof chequeControlAccountsSchema>;
export type ChequeDTO = z.infer<typeof chequeSchema>;
export type CreateChequeDTO = z.infer<typeof createChequeSchema>;
export type DepositChequeDTO = z.infer<typeof depositChequeSchema>;
export type CollectChequeDTO = z.infer<typeof collectChequeSchema>;
export type BounceChequeDTO = z.infer<typeof bounceChequeSchema>;
export type ReplaceChequeDTO = z.infer<typeof replaceChequeSchema>;
export type ChequeListQueryDTO = z.infer<typeof chequeListQuerySchema>;
export type ChequeAllocationDTO = z.infer<typeof chequeAllocationSchema>;
export type CreateChequeAllocationDTO = z.infer<typeof createChequeAllocationSchema>;
