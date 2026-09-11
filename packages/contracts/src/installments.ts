import { z } from "zod";
import { nonNegativeMoneyString } from "./money-string.js";
import { documentStatusSchema } from "./documents.js";

/** Wire contracts for Installments (خطط الأقساط + متابعة التحصيل، docs/archive/catalog/05). */

/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

export const installmentFrequencySchema = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]);
export const installmentLineStatusSchema = z.enum(["pending", "paid", "overdue", "cancelled"]);

/** The create request carries raw schedule inputs; the API computes `generateInstallmentSchedule` server-side. */
export const createInstallmentPlanSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string().default(""),
  customerId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  invoiceTotal: positiveDecimalString,
  downPayment: positiveDecimalString.default("0"),
  installmentCount: z.number().int().min(1),
  frequency: installmentFrequencySchema,
  startDate: z.string().min(1),
});

export const installmentLineSchema = z.object({
  no: z.number().int().min(1),
  customerId: z.string().min(1),
  sourceInvoiceId: z.string().min(1),
  sourceInvoiceNumber: z.string().nullable(),
  frequency: installmentFrequencySchema,
  downPayment: positiveDecimalString,
  dueDate: z.string(),
  amount: positiveDecimalString,
  paidAmount: positiveDecimalString,
  status: installmentLineStatusSchema,
  lateFeeAmount: positiveDecimalString,
});

export const installmentPlanDocumentSchema = z.object({
  id: z.string(),
  docType: z.literal("INSTALLMENT_PLAN"),
  docNo: z.string().nullable(),
  date: z.string(),
  memo: z.string(),
  status: documentStatusSchema,
  lines: z.array(installmentLineSchema),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  reversesDocId: z.string().nullable(),
  reversedByDocId: z.string().nullable(),
  workflowRequestId: z.string().nullable(),
  journalEntryId: z.string().nullable(),
});

/** معالجة المتأخرات — the overdue processing batch request. */
export const processOverdueInstallmentsSchema = z.object({
  asOfDate: z.string().min(1),
});

export const processOverdueInstallmentsResultSchema = z.object({
  newlyOverdueCount: z.number().int(),
  totalLateFeesApplied: positiveDecimalString,
});

/**
 * تحصيل قسط. `installmentNo` omitted means "run this payment down the schedule
 * oldest-first", which is what a customer handing over a round sum means. The
 * treasury account is required and never defaulted: the money has to land in a
 * real till, and guessing which one is how a collection ends up in the wrong
 * drawer (D119).
 */
export const collectInstallmentSchema = z.object({
  installmentNo: z.number().int().min(1).optional(),
  amount: positiveDecimalString,
  treasuryAccountId: z.string().min(1),
  branchId: z.string().min(1),
  paymentMethod: z.enum(["cash", "bank", "cheque", "card", "wallet"]).default("cash"),
  date: z.string().min(1),
  referenceNo: z.string().nullable().default(null),
  memo: z.string().nullable().default(null),
});
export type CollectInstallmentDTO = z.infer<typeof collectInstallmentSchema>;

// --- متابعة التحصيل (collection follow-ups) ---

export const followUpTypeSchema = z.enum(["CALL", "VISIT", "SMS", "EMAIL", "NOTE"]);
export const followUpStatusSchema = z.enum(["pending", "completed", "cancelled"]);

export const createFollowUpSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  installmentPlanId: z.string().nullish(),
  type: followUpTypeSchema,
  followUpDate: z.string().min(1),
  assignedTo: z.string().nullish(),
  notes: z.string().nullish(),
});

export const completeFollowUpSchema = z.object({ outcome: z.string().min(1) });

export const collectionFollowUpSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  installmentPlanId: z.string().nullable(),
  type: followUpTypeSchema,
  followUpDate: z.string(),
  assignedTo: z.string().nullable(),
  notes: z.string().nullable(),
  status: followUpStatusSchema,
  outcome: z.string().nullable(),
  createdAt: z.string(),
});

export type InstallmentFrequencyDTO = z.infer<typeof installmentFrequencySchema>;
export type InstallmentLineStatusDTO = z.infer<typeof installmentLineStatusSchema>;
export type CreateInstallmentPlanDTO = z.infer<typeof createInstallmentPlanSchema>;
export type InstallmentLineDTO = z.infer<typeof installmentLineSchema>;
export type InstallmentPlanDocumentDTO = z.infer<typeof installmentPlanDocumentSchema>;
export type ProcessOverdueInstallmentsDTO = z.infer<typeof processOverdueInstallmentsSchema>;
export type ProcessOverdueInstallmentsResultDTO = z.infer<typeof processOverdueInstallmentsResultSchema>;
export type FollowUpTypeDTO = z.infer<typeof followUpTypeSchema>;
export type FollowUpStatusDTO = z.infer<typeof followUpStatusSchema>;
export type CreateFollowUpDTO = z.infer<typeof createFollowUpSchema>;
export type CompleteFollowUpDTO = z.infer<typeof completeFollowUpSchema>;
export type CollectionFollowUpDTO = z.infer<typeof collectionFollowUpSchema>;
