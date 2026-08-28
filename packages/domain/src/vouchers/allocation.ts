/**
 * Invoice allocation subsystem (docs/catalog/04 §"تخصيص على الفواتير").
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
  readonly amount: Money;
  readonly status: AllocationStatus;
  readonly createdAt: string;
  readonly reversedAt: string | null;
}

/** Outstanding balance of an invoice (total − allocated). */
export function invoiceOutstanding(invoice: AllocatableInvoice): Money {
  return Money.fromScaled(invoice.total.scaled - invoice.allocated.scaled);
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
}

/**
 * Apply an allocation: validates kind/party match and that the amount does not
 * exceed the voucher's unallocated remainder nor the invoice's outstanding
 * balance, then persists the allocation and bumps the invoice's allocated total.
 * Pure orchestration over the two repository ports.
 */
export async function allocate(
  input: AllocateInput,
  deps: { allocations: AllocationRepository; invoices: AllocatableInvoiceRepository },
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
  const outstanding = invoiceOutstanding(invoice);
  if (input.amount.scaled > outstanding.scaled) {
    throw new AllocationExceedsError(
      `مبلغ التخصيص (${input.amount.toString()}) يتجاوز المتبقي على الفاتورة (${outstanding.toString()}).`,
    );
  }

  const allocation: VoucherAllocation = {
    id: input.allocationId,
    voucherId: input.voucherId,
    invoiceId: input.invoiceId,
    amount: input.amount,
    status: "active",
    createdAt: input.now,
    reversedAt: null,
  };
  const updatedInvoice: AllocatableInvoice = {
    ...invoice,
    allocated: Money.fromScaled(invoice.allocated.scaled + input.amount.scaled),
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
): Promise<{ allocation: VoucherAllocation; invoice: AllocatableInvoice | null }> {
  const allocation = await deps.allocations.findById(allocationId);
  if (!allocation) throw new AllocationNotFoundError(allocationId);
  if (allocation.status === "reversed") {
    throw new AllocationAlreadyReversedError(allocationId);
  }
  const reversed: VoucherAllocation = { ...allocation, status: "reversed", reversedAt: now };
  await deps.allocations.update(reversed);

  const invoice = await deps.invoices.findById(allocation.invoiceId);
  let updatedInvoice: AllocatableInvoice | null = null;
  if (invoice) {
    updatedInvoice = {
      ...invoice,
      allocated: Money.fromScaled(invoice.allocated.scaled - allocation.amount.scaled),
    };
    await deps.invoices.save(updatedInvoice);
  }
  return { allocation: reversed, invoice: updatedInvoice };
}
