import { z } from "zod";

/**
 * Wire contracts for Treasury Vouchers (docs/archive/catalog/04 §"السندات النقدية") —
 * the unified receipt/payment/transfer document + invoice allocation. Money
 * crosses the wire as an exact decimal string, never a float (docs/archive/plan.md
 * §2.3); the domain re-parses via `Money.fromMajor`.
 */

export const voucherTypeSchema = z.enum([
  "customer_collection",
  "supplier_payment",
  "customer_refund",
  "customer_advance",
  "supplier_refund",
  "other_income",
  "other_expense",
  "capital_injection",
  "capital_withdrawal",
  "tax_payment",
  "inter_treasury_transfer",
]);

export const voucherDirectionSchema = z.enum(["receipt", "payment", "transfer"]);
export const voucherPaymentMethodSchema = z.enum(["cash", "bank", "cheque", "card", "wallet"]);
export const voucherStatusSchema = z.enum(["draft", "pending", "confirmed", "posted", "cancelled", "reversed"]);
export const allocationInvoiceKindSchema = z.enum(["sales", "purchase"]);
export const allocationStatusSchema = z.enum(["active", "reversed"]);

/** A voucher as it crosses the wire. */
export const voucherSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  voucherType: voucherTypeSchema,
  direction: voucherDirectionSchema,
  status: voucherStatusSchema,
  date: z.string().min(1),
  memo: z.string(),
  amount: z.string(),
  currency: z.string(),
  branchId: z.string(),
  paymentMethod: voucherPaymentMethodSchema,
  treasuryAccountId: z.string(),
  treasuryGlAccountId: z.string(),
  counterpartyGlAccountId: z.string().nullable(),
  counterTreasuryAccountId: z.string().nullable(),
  counterTreasuryGlAccountId: z.string().nullable(),
  customerId: z.string().nullable(),
  supplierId: z.string().nullable(),
  referenceNo: z.string().nullable(),
  costCenterId: z.string().nullable(),
  withholdingAmount: z.string().nullable(),
  withholdingRatePercent: z.number().nullable(),
  /** What actually leaves the treasury: amount − withholdingAmount. */
  netPaidAmount: z.string(),
  journalEntryId: z.string().nullable(),
  confirmedAt: z.string().nullable(),
});

/** Create a voucher draft. */
export const createVoucherSchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().min(1),
  memo: z.string().optional(),
  voucherType: voucherTypeSchema,
  amount: z.string(),
  currency: z.string().optional(),
  branchId: z.string().min(1),
  paymentMethod: voucherPaymentMethodSchema,
  treasuryAccountId: z.string().min(1),
  treasuryGlAccountId: z.string().min(1),
  counterpartyGlAccountId: z.string().nullish(),
  counterTreasuryAccountId: z.string().nullish(),
  counterTreasuryGlAccountId: z.string().nullish(),
  customerId: z.string().nullish(),
  supplierId: z.string().nullish(),
  referenceNo: z.string().nullish(),
  costCenterId: z.string().nullish(),
  /** Tax withheld from this payment and owed to the authority instead of to the payee. */
  withholdingAmount: z.string().nullish(),
  withholdingRatePercent: z.number().min(0).max(100).nullish(),
  withholdingGlAccountId: z.string().nullish(),
});

/** Confirm a draft voucher (posts GL, stamps CV- number). */
export const confirmVoucherSchema = z.object({
  requestId: z.string().min(1).optional(),
});

/** Reverse a confirmed voucher. */
export const reverseVoucherSchema = z.object({
  reversalId: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  memo: z.string().optional(),
});

/** A thin open-invoice sub-ledger record for the allocation UI. */
export const openInvoiceSchema = z.object({
  id: z.string(),
  invoiceNo: z.string(),
  kind: allocationInvoiceKindSchema,
  partyId: z.string(),
  date: z.string(),
  total: z.string(),
  allocated: z.string(),
  outstanding: z.string(),
});

/** One voucher→invoice allocation as it crosses the wire. */
export const voucherAllocationSchema = z.object({
  id: z.string(),
  voucherId: z.string(),
  invoiceId: z.string(),
  amount: z.string(),
  status: allocationStatusSchema,
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});

/** Apply an allocation of part of a voucher onto one invoice. */
export const createAllocationSchema = z.object({
  allocationId: z.string().min(1).optional(),
  invoiceId: z.string().min(1),
  amount: z.string(),
});

/** The allocation summary returned alongside a voucher. */
export const allocationSummarySchema = z.object({
  voucherAmount: z.string(),
  allocated: z.string(),
  unallocated: z.string(),
  fullyAllocated: z.boolean(),
  needsAllocation: z.boolean(),
});

export const voucherListQuerySchema = z.object({
  type: voucherTypeSchema.optional(),
  status: voucherStatusSchema.optional(),
  branchId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  /** Free text over the voucher number and its external reference. */
  search: z.string().optional(),
  /**
   * محتاج تخصيص — confirmed, allocatable vouchers with money still unapplied
   * (R8.3). Split by intent: `receipt` is cash taken from customers waiting to
   * be applied to their invoices, `payment` is cash paid to suppliers waiting
   * to be applied to theirs. They are two different people's work queues.
   */
  needsAllocation: z.enum(["any", "receipt", "payment"]).optional(),
});

export type VoucherTypeDTO = z.infer<typeof voucherTypeSchema>;
export type VoucherDirectionDTO = z.infer<typeof voucherDirectionSchema>;
export type VoucherPaymentMethodDTO = z.infer<typeof voucherPaymentMethodSchema>;
export type VoucherStatusDTO = z.infer<typeof voucherStatusSchema>;
export type AllocationInvoiceKindDTO = z.infer<typeof allocationInvoiceKindSchema>;
export type AllocationStatusDTO = z.infer<typeof allocationStatusSchema>;
export type VoucherDTO = z.infer<typeof voucherSchema>;
export type CreateVoucherDTO = z.infer<typeof createVoucherSchema>;
export type ConfirmVoucherDTO = z.infer<typeof confirmVoucherSchema>;
export type ReverseVoucherDTO = z.infer<typeof reverseVoucherSchema>;
export type OpenInvoiceDTO = z.infer<typeof openInvoiceSchema>;
export type VoucherAllocationDTO = z.infer<typeof voucherAllocationSchema>;
export type CreateAllocationDTO = z.infer<typeof createAllocationSchema>;
export type AllocationSummaryDTO = z.infer<typeof allocationSummarySchema>;
export type VoucherListQueryDTO = z.infer<typeof voucherListQuerySchema>;
