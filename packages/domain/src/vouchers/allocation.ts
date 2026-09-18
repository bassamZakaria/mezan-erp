/**
 * Invoice allocation subsystem (docs/archive/catalog/04 §"تخصيص على الفواتير").
 *
 * A customer-collection or supplier-payment voucher can be APPLIED across the
 * counterparty's open invoices — the cash-application step that matches money
 * received/paid against specific AR/AP invoices. Allocation is:
 *   - PARTIAL: a voucher may be split across several invoices, and an invoice
 *     may be paid by several vouchers; any voucher with an unallocated remainder
 *     is "بحاجة لتخصيص" (needs allocation).
 *   - REVERSIBLE: an allocation can be undone ("عكس التخصيص"), restoring both
 *     the voucher's unallocated remainder and the invoice's outstanding balance.
 *
 * Invoices are modelled here as a thin {@link AllocatableInvoice} sub-ledger
 * record (id, kind, party, total, allocated) — the full invoice documents are a
 * later phase, but allocation only needs the outstanding balance to apply money
 * against, so this stays decoupled from any invoice document.
 */

import { Money } from "../money/index.js";
import { convertFromBase, convertToBase } from "../exchange-rates/convert.js";
import {
  AllocationAlreadyReversedError,
  AllocationExceedsError,
  AllocationMismatchError,
  AllocationNotFoundError,
  InvoiceNotFoundError,
} from "./errors.js";
import type { AllocationInvoiceKind } from "./voucher-types.js";

/** A thin open-invoice sub-ledger record allocations apply against. */
export interface AllocatableInvoice {
  readonly id: string;
  readonly invoiceNo: string;
  readonly kind: AllocationInvoiceKind;
  /** Customer id (sales) or supplier id (purchase). */
  readonly partyId: string;
  readonly date: string;
  readonly total: Money;
  /** Sum of active allocations applied so far. */
  readonly allocated: Money;
}

export type AllocationStatus = "active" | "reversed";

/** One application of a voucher amount against one invoice. */
export interface VoucherAllocation {
  readonly id: string;
  readonly voucherId: string;
  readonly invoiceId: string;
  /** What the voucher gave, in base: the part of the voucher this allocation used up. */
  readonly amount: Money;
  /**
   * What the invoice was relieved of, in base at the rate it was booked at.
   * Differs from {@link amount} only when a foreign invoice was settled at
   * another rate; the difference is the realised exchange difference (D221).
   * Absent means equal to `amount`.
   */
  readonly invoiceAmount?: Money | null;
  /** The settlement entry this allocation posted, if any: its realised difference (D221) and the move of the money into the invoice's currency (D260). */
  readonly fxEntryId?: string | null;
  readonly status: AllocationStatus;
  readonly createdAt: string;
  readonly reversedAt: string | null;
  /** The day it took effect (D265); its settlement entry carries the same date. Absent before D265. */
  readonly date?: string | null;
  /** The day it was undone (D265); the settlement entry's mirror carries the same date. */
  readonly reversedOn?: string | null;
}

export function laterDay(a: string, b: string | null | undefined): string {
  return b && b > a ? b : a;
}

/** What an allocation relieved its invoice of, in base at the invoice's own rate. */
export function allocationInvoiceAmount(allocation: VoucherAllocation): Money {
  return allocation.invoiceAmount ?? allocation.amount;
}

/** The realised exchange difference an allocation carries: what the voucher gave less what the invoice was relieved of. */
export function allocationFxDifference(allocation: VoucherAllocation): Money {
  return Money.fromScaled(allocation.amount.scaled - allocationInvoiceAmount(allocation).scaled);
}

/** Outstanding balance of an invoice (total − allocated). */
export function invoiceOutstanding(invoice: AllocatableInvoice): Money {
  return Money.fromScaled(invoice.total.scaled - invoice.allocated.scaled);
}

/**
 * What confirmed returns have already taken off each invoice, in base — the
 * same credit the ledger posted to the party's control account (D242).
 */
export interface InvoiceReturnCreditPort {
  returnedByIds(ids: readonly string[], kind: AllocationInvoiceKind): Promise<ReadonlyMap<string, Money>>;
}

/**
 * What money can still settle on an invoice: its total less what is allocated
 * and what returns cleared, never below zero. A return is not an allocation,
 * so the sub-ledger row does not carry it; without netting it a voucher could
 * be applied to debt a return had already taken off (D242).
 */
export function invoiceOpenBalance(invoice: AllocatableInvoice, returned: Money = Money.zero()): Money {
  const open = invoice.total.scaled - invoice.allocated.scaled - returned.scaled;
  return Money.fromScaled(open > 0n ? open : 0n);
}

/** Each invoice's return credit, or an empty map when no returns module is wired. */
export async function returnedByInvoice(
  returns: InvoiceReturnCreditPort | undefined,
  invoices: readonly AllocatableInvoice[],
): Promise<ReadonlyMap<string, Money>> {
  if (!returns || invoices.length === 0) return new Map();
  const out = new Map<string, Money>();
  for (const kind of ["sales", "purchase"] as const) {
    const ids = invoices.filter((invoice) => invoice.kind === kind).map((invoice) => invoice.id);
    if (ids.length === 0) continue;
    for (const [id, credit] of await returns.returnedByIds(ids, kind)) out.set(id, credit);
  }
  return out;
}

/** The rate a foreign invoice was booked at and the rate it is being settled at, both base units per foreign unit. */
export interface SettlementRates {
  readonly invoiceRate: string;
  readonly settlementRate: string;
}

export interface SettlementSplit {
  /** What the invoice is relieved of, at its booked rate. */
  readonly relief: Money;
  /** What the voucher gives less `relief`: positive when the settlement is worth more base than the booking. */
  readonly fxDifference: Money;
  /** The most voucher money this invoice can still absorb at the settlement rate. */
  readonly capacity: Money;
}

/**
 * How much of a foreign invoice a base amount settles (IAS 21 ¶28): the amount
 * buys `amount ÷ settlementRate` of the invoice's currency, and the invoice is
 * relieved of that at the rate it was booked at. Settling the whole foreign
 * remainder relieves exactly what is outstanding, so a paid invoice never keeps
 * a rounding residue. Without rates, or at the booked rate, relief is the
 * amount itself.
 */
export function settlementSplit(amount: Money, outstanding: Money, rates?: SettlementRates | null): SettlementSplit {
  if (!rates || Money.fromMajor(rates.invoiceRate).scaled === Money.fromMajor(rates.settlementRate).scaled) {
    return { relief: amount, fxDifference: Money.zero(), capacity: outstanding };
  }
  const foreignOutstanding = convertFromBase(outstanding, rates.invoiceRate);
  const capacity = convertToBase(foreignOutstanding, rates.settlementRate);
  let relief: Money;
  if (amount.scaled >= capacity.scaled) {
    relief = outstanding;
  } else {
    const converted = convertToBase(convertFromBase(amount, rates.settlementRate), rates.invoiceRate);
    relief = converted.scaled > outstanding.scaled ? outstanding : converted;
  }
  return { relief, fxDifference: Money.fromScaled(amount.scaled - relief.scaled), capacity };
}

/** Persistence port for allocations. */
export interface AllocationRepository {
  save(alloc: VoucherAllocation): Promise<void>;
  update(alloc: VoucherAllocation): Promise<void>;
  findById(id: string): Promise<VoucherAllocation | null>;
  listByVoucher(voucherId: string): Promise<readonly VoucherAllocation[]>;
  listByInvoice(invoiceId: string): Promise<readonly VoucherAllocation[]>;
}

/** Persistence port for the open-invoice sub-ledger. */
export interface AllocatableInvoiceRepository {
  findById(id: string): Promise<AllocatableInvoice | null>;
  save(invoice: AllocatableInvoice): Promise<void>;
  /** Open invoices (outstanding > 0) for a party, optionally filtered by kind. */
  listOpen(filter: { kind?: AllocationInvoiceKind; partyId?: string }): Promise<readonly AllocatableInvoice[]>;
  /**
   * How much of each of these invoices the allocation sub-ledger records as
   * settled. Exists so a report over N documents costs ONE lookup rather than
   * an awaited `findById` per row inside a loop — an id with no sub-ledger row
   * is simply absent from the map.
   */
  allocatedByIds(ids: readonly string[]): Promise<ReadonlyMap<string, Money>>;
}

/** Sum of ACTIVE allocation amounts. */
export function sumActive(allocations: readonly VoucherAllocation[]): Money {
  return Money.sum(allocations.filter((a) => a.status === "active").map((a) => a.amount));
}

export interface AllocationSummary {
  readonly voucherAmount: Money;
  readonly allocated: Money;
  readonly unallocated: Money;
  readonly fullyAllocated: boolean;
  /** True when the voucher is allocatable and still has an unallocated remainder (بحاجة لتخصيص). */
  readonly needsAllocation: boolean;
}

/** Compute the allocation summary for an allocatable voucher. */
export function summarize(
  voucherAmount: Money,
  allocations: readonly VoucherAllocation[],
  allocatable: boolean,
): AllocationSummary {
  const allocated = sumActive(allocations);
  const unallocated = Money.fromScaled(voucherAmount.scaled - allocated.scaled);
  const fullyAllocated = unallocated.scaled <= 0n;
  return {
    voucherAmount,
    allocated,
    unallocated,
    fullyAllocated,
    needsAllocation: allocatable && unallocated.scaled > 0n,
  };
}

/** What the caller supplies to apply an allocation. */
export interface AllocateInput {
  readonly allocationId: string;
  readonly voucherId: string;
  readonly voucherAmount: Money;
  readonly voucherPartyId: string;
  readonly expectedKind: AllocationInvoiceKind;
  readonly invoiceId: string;
  readonly amount: Money;
  readonly now: string;
  /** The day the allocation is made (D265); lifted to the invoice's date if that is later. */
  readonly date?: string;
  /**
   * Resolves the booked and settlement rates once the invoice is known; null
   * for a base-currency invoice. Supplied, a foreign invoice is relieved at its
   * booked rate and the difference is returned for posting (D221).
   */
  readonly rates?: (invoice: AllocatableInvoice) => Promise<SettlementRates | null>;
  /**
   * Runs after every check and before anything is written, with the split;
   * returns the realised-FX entry it posted. A refusal here (a closed period)
   * leaves the sub-ledger untouched.
   */
  readonly beforeSave?: (invoice: AllocatableInvoice, split: SettlementSplit, date: string | null) => Promise<{ fxEntryId: string | null }>;
}

/**
 * Apply an allocation: validates kind/party match and that the amount does not
 * exceed the voucher's unallocated remainder nor the invoice's outstanding
 * balance, then persists the allocation and bumps the invoice's allocated total.
 * Pure orchestration over the two repository ports.
 */
export async function allocate(
  input: AllocateInput,
  deps: { allocations: AllocationRepository; invoices: AllocatableInvoiceRepository; returns?: InvoiceReturnCreditPort },
): Promise<{ allocation: VoucherAllocation; invoice: AllocatableInvoice }> {
  if (input.amount.scaled <= 0n) {
    throw new AllocationExceedsError("مبلغ التخصيص يجب أن يكون أكبر من صفر.");
  }
  const invoice = await deps.invoices.findById(input.invoiceId);
  if (!invoice) throw new InvoiceNotFoundError(input.invoiceId);
  if (invoice.kind !== input.expectedKind) {
    throw new AllocationMismatchError(
      `نوع الفاتورة (${invoice.kind}) لا يطابق نوع السند (${input.expectedKind}).`,
    );
  }
  if (invoice.partyId !== input.voucherPartyId) {
    throw new AllocationMismatchError("الفاتورة تخص طرفاً مختلفاً عن طرف السند.");
  }

  const existing = await deps.allocations.listByVoucher(input.voucherId);
  const unallocated = Money.fromScaled(input.voucherAmount.scaled - sumActive(existing).scaled);
  if (input.amount.scaled > unallocated.scaled) {
    throw new AllocationExceedsError(
      `مبلغ التخصيص (${input.amount.toString()}) يتجاوز المتبقي غير المخصص من السند (${unallocated.toString()}).`,
    );
  }
  const returned = (await returnedByInvoice(deps.returns, [invoice])).get(invoice.id) ?? Money.zero();
  const outstanding = invoiceOpenBalance(invoice, returned);
  const split = settlementSplit(input.amount, outstanding, input.rates ? await input.rates(invoice) : null);
  if (input.amount.scaled > split.capacity.scaled) {
    throw new AllocationExceedsError(
      `مبلغ التخصيص (${input.amount.toString()}) يتجاوز المتبقي على الفاتورة (${split.capacity.toString()}).`,
    );
  }
  if (split.relief.scaled <= 0n) {
    throw new AllocationExceedsError("مبلغ التخصيص أصغر من أن يسدد أي جزء من الفاتورة بسعر الصرف.");
  }
  const date = input.date ? laterDay(input.date, invoice.date) : null;
  const posted = input.beforeSave ? await input.beforeSave(invoice, split, date) : { fxEntryId: null };

  const allocation: VoucherAllocation = {
    id: input.allocationId,
    voucherId: input.voucherId,
    invoiceId: input.invoiceId,
    amount: input.amount,
    ...(split.fxDifference.scaled !== 0n ? { invoiceAmount: split.relief } : {}),
    ...(posted.fxEntryId ? { fxEntryId: posted.fxEntryId } : {}),
    status: "active",
    createdAt: input.now,
    reversedAt: null,
    ...(date ? { date } : {}),
  };
  const updatedInvoice: AllocatableInvoice = {
    ...invoice,
    allocated: Money.fromScaled(invoice.allocated.scaled + split.relief.scaled),
  };
  await deps.allocations.save(allocation);
  await deps.invoices.save(updatedInvoice);
  return { allocation, invoice: updatedInvoice };
}

/**
 * Reverse an allocation ("عكس التخصيص"): mark it reversed and restore the
 * invoice's outstanding balance. Idempotency is refused — reversing twice throws.
 */
export async function reverseAllocation(
  allocationId: string,
  now: string,
  deps: { allocations: AllocationRepository; invoices: AllocatableInvoiceRepository },
  reversedOn?: string,
): Promise<{ allocation: VoucherAllocation; invoice: AllocatableInvoice | null }> {
  const allocation = await deps.allocations.findById(allocationId);
  if (!allocation) throw new AllocationNotFoundError(allocationId);
  if (allocation.status === "reversed") {
    throw new AllocationAlreadyReversedError(allocationId);
  }
  const reversed: VoucherAllocation = { ...allocation, status: "reversed", reversedAt: now, ...(reversedOn ? { reversedOn } : {}) };
  await deps.allocations.update(reversed);

  const invoice = await deps.invoices.findById(allocation.invoiceId);
  let updatedInvoice: AllocatableInvoice | null = null;
  if (invoice) {
    updatedInvoice = {
      ...invoice,
      allocated: Money.fromScaled(invoice.allocated.scaled - allocationInvoiceAmount(allocation).scaled),
    };
    await deps.invoices.save(updatedInvoice);
  }
  return { allocation: reversed, invoice: updatedInvoice };
}
