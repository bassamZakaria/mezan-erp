import { Money } from "../money/index.js";
import type { AllocationStatus, VoucherAllocation } from "../vouchers/allocation.js";
import { InvalidPromiseToPayError } from "./errors.js";
import { PromiseToPayStatus, type EvaluatedPromise, type PromiseToPay } from "./types.js";

const ACTIVE_ALLOCATION: AllocationStatus = "active";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface CreatePromiseInput {
  readonly id: string;
  readonly customerId: string;
  readonly promisedDate: string;
  readonly amount: Money;
  readonly invoiceIds: readonly string[];
  readonly note: string | null;
  readonly today: string;
  readonly now: string;
  readonly actor: string;
}

export function createPromiseToPay(input: CreatePromiseInput): PromiseToPay {
  if (!DAY.test(input.promisedDate)) throw new InvalidPromiseToPayError("تاريخ الوعد بالسداد غير صالح.", "The promised date is not valid.");
  if (input.promisedDate < input.today) throw new InvalidPromiseToPayError("تاريخ الوعد بالسداد لا يمكن أن يكون في الماضي.", "The promised date cannot be in the past.");
  if (input.amount.scaled <= 0n) throw new InvalidPromiseToPayError("مبلغ الوعد بالسداد يجب أن يكون أكبر من صفر.", "The promised amount must be greater than zero.");
  if (input.invoiceIds.length === 0) throw new InvalidPromiseToPayError("لا توجد فواتير متأخرة يغطيها هذا الوعد.", "This promise covers no overdue invoices.");
  return {
    id: input.id,
    customerId: input.customerId,
    promisedDate: input.promisedDate,
    amount: input.amount,
    invoiceIds: [...new Set(input.invoiceIds)],
    note: input.note && input.note.trim() !== "" ? input.note.trim() : null,
    createdOn: input.today,
    createdAt: input.now,
    createdBy: input.actor,
    cancelledAt: null,
    cancelledBy: null,
  };
}

function effectiveDay(allocation: VoucherAllocation): string {
  return allocation.date ?? allocation.createdAt.slice(0, 10);
}

export function collectedTowardPromise(
  promise: PromiseToPay,
  allocationsByInvoice: ReadonlyMap<string, readonly VoucherAllocation[]>,
  untilDay: string,
): Money {
  let scaled = 0n;
  for (const invoiceId of promise.invoiceIds) {
    for (const allocation of allocationsByInvoice.get(invoiceId) ?? []) {
      if (allocation.status !== ACTIVE_ALLOCATION) continue;
      const day = effectiveDay(allocation);
      if (day < promise.createdOn || day > untilDay) continue;
      scaled += (allocation.invoiceAmount ?? allocation.amount).scaled;
    }
  }
  return Money.fromScaled(scaled);
}

export function evaluatePromise(
  promise: PromiseToPay,
  allocationsByInvoice: ReadonlyMap<string, readonly VoucherAllocation[]>,
  today: string,
): EvaluatedPromise {
  const byDeadline = collectedTowardPromise(promise, allocationsByInvoice, promise.promisedDate);
  const soFar = collectedTowardPromise(promise, allocationsByInvoice, today > promise.promisedDate ? today : promise.promisedDate);
  if (promise.cancelledAt) return { ...promise, status: PromiseToPayStatus.Cancelled, collected: soFar };
  if (byDeadline.scaled >= promise.amount.scaled) return { ...promise, status: PromiseToPayStatus.Kept, collected: soFar };
  if (today > promise.promisedDate) return { ...promise, status: PromiseToPayStatus.Broken, collected: soFar };
  return { ...promise, status: PromiseToPayStatus.Pending, collected: soFar };
}
