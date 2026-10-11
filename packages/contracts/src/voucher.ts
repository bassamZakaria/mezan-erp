import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./paging.js";
import { moneyString } from "./money-string.js";
import { costCategorySchema } from "./contracting.js";
import { isoDateOrInstant } from "./iso-date.js";

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
/** An allocation requested with a collection the workflow held; `amount` null takes the voucher's remainder. */
export const heldAllocationSchema = z.object({
  allocationId: z.string(),
  invoiceId: z.string(),
  amount: moneyString.nullable(),
});

export const treasuryLegFxSchema = z.object({
  currency: z.string(),
  fxRate: z.string(),
  foreignAmount: moneyString,
  /** What the money that left a foreign-currency account was carried at, in base. */
  carryingBase: z.string().optional(),
  /** فروق عملة محققة posted in the voucher's entry: positive is a gain. */
  realised: z.string().optional(),
  realisedAccountId: z.string().optional(),
});

export const voucherSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  voucherType: voucherTypeSchema,
  direction: voucherDirectionSchema,
  status: voucherStatusSchema,
  date: z.string().min(1),
  memo: z.string(),
  /** The figure the voucher states, in `currency` — not necessarily base. */
  amount: moneyString,
  currency: z.string(),
  /**
   * Base units per one unit of `currency`, stamped from the approved rate table
   * at confirm; null on a base-currency voucher. Without it a foreign voucher's
   * digits posted as base and the settlement was invisible to FX revaluation
   * (B-4/B-5).
   */
  fxRate: z.string().nullable(),
  /** What the movement is in a foreign-currency treasury account's own currency, stamped at confirm; null on a base-currency account. */
  treasuryFx: treasuryLegFxSchema.nullable().optional(),
  /** The same for the destination account of a transfer. */
  counterTreasuryFx: treasuryLegFxSchema.nullable().optional(),
  /** `amount` converted at `fxRate` — what the GL, the treasury and every allocation hold. */
  baseAmount: z.string(),
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
  /** بُعد المشروع — the contracting project this voucher belongs to (D-01). */
  projectId: z.string().nullable(),
  /** فئة التكلفة — only meaningful with `projectId`. */
  costCategory: costCategorySchema.nullable(),
  withholdingAmount: moneyString.nullable(),
  withholdingRatePercent: z.number().nullable(),
  /** What actually leaves the treasury: amount − withholdingAmount. */
  netPaidAmount: z.string(),
  journalEntryId: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  /**
   * On a reversal's mirror: the voucher it reverses. The mirror is saved
   * confirmed with the same line, so a figure summing confirmed vouchers must
   * skip it (D197, D200). Optional so older payloads still parse.
   */
  reversesDocId: z.string().nullish(),
  /** Allocations a collection carries while held for approval; the approved confirm applies them (D344). */
  heldAllocations: z.array(heldAllocationSchema).optional(),
});

/** Create a voucher draft. */
export const createVoucherSchema = z.object({
  id: z.string().min(1).optional(),
  date: isoDateOrInstant,
  memo: z.string().optional(),
  voucherType: voucherTypeSchema,
  amount: moneyString,
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
  /** بُعد المشروع — the contracting project this voucher belongs to (D-01). */
  projectId: z.string().nullish(),
  /** فئة التكلفة — only meaningful with `projectId`. */
  costCategory: costCategorySchema.nullish(),
  /** Tax withheld from this payment and owed to the authority instead of to the payee. */
  withholdingAmount: moneyString.nullish(),
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
  date: isoDateOrInstant.optional(),
  memo: z.string().optional(),
});

/** A thin open-invoice sub-ledger record for the allocation UI. */
export const openInvoiceSchema = z.object({
  id: z.string(),
  invoiceNo: z.string(),
  kind: allocationInvoiceKindSchema,
  partyId: z.string(),
  date: z.string(),
  total: moneyString,
  allocated: z.string(),
  /** What confirmed returns took off the invoice; `outstanding` is net of it (D242). */
  returned: z.string().optional(),
  outstanding: z.string(),
});

/** One voucher→invoice allocation as it crosses the wire. */
export const voucherAllocationSchema = z.object({
  id: z.string(),
  voucherId: z.string(),
  invoiceId: z.string(),
  amount: moneyString,
  /** What the invoice was relieved of at its booked rate; differs from `amount` by the realised exchange difference (D221). */
  invoiceAmount: z.string().optional(),
  fxDifference: z.string().optional(),
  fxEntryId: z.string().nullable().optional(),
  status: allocationStatusSchema,
  createdAt: z.string(),
  reversedAt: z.string().nullable(),
});

/** Apply an allocation of part of a voucher onto one invoice. */
export const createAllocationSchema = z.object({
  allocationId: z.string().min(1).optional(),
  invoiceId: z.string().min(1),
  amount: moneyString,
});

/**
 * «تحصيل» in one call (D338): create, confirm and allocate a customer
 * collection atomically. The voucher takes the treasury account's currency;
 * `amount` is in that currency. Each allocation's `amount` is in BASE, as on
 * `POST /vouchers/:id/allocations`; omitted, it takes what is left of the
 * voucher.
 */
export const createCollectionSchema = z.object({
  /** The currency the collection is stated in: the treasury account's own when omitted, or the base currency on a foreign-currency account. */
  currency: z.string().optional(),
  id: z.string().min(1).optional(),
  date: isoDateOrInstant.optional(),
  memo: z.string().optional(),
  customerId: z.string().min(1),
  branchId: z.string().min(1),
  treasuryAccountId: z.string().min(1),
  amount: moneyString,
  paymentMethod: voucherPaymentMethodSchema,
  referenceNo: z.string().nullish(),
  costCenterId: z.string().nullish(),
  projectId: z.string().nullish(),
  costCategory: costCategorySchema.nullish(),
  withholdingAmount: moneyString.nullish(),
  withholdingRatePercent: z.number().min(0).max(100).nullish(),
  withholdingGlAccountId: z.string().nullish(),
  requestId: z.string().min(1).optional(),
  allocations: z
    .array(
      z.object({
        allocationId: z.string().min(1).optional(),
        invoiceId: z.string().min(1),
        amount: moneyString.optional(),
      }),
    )
    .default([]),
});

export const collectionResultSchema = z.object({
  voucher: voucherSchema,
  held: z.boolean(),
  allocations: z.array(voucherAllocationSchema),
  heldAllocations: z.array(heldAllocationSchema).optional(),
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
  /** One page of rows, 1-based. Both carry a default, so an omitted page never means the whole book (Q-8). */
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
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
export type CreateCollectionDTO = z.input<typeof createCollectionSchema>;
export type CollectionResultDTO = z.infer<typeof collectionResultSchema>;
export type VoucherListQueryDTO = z.infer<typeof voucherListQuerySchema>;
