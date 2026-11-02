/**
 * Installment schedule generation (docs/archive/catalog/05 §"خطط الأقساط" — "معاينة
 * الجدول"): splits an invoice's remaining balance (total − down payment) into
 * N equal installments at a fixed frequency, first one due on the plan's own
 * start date (verified example: INV-000014, 375.00 ج.م, 6 monthly
 * installments, no down payment, start 2026-08-21 → 6× 62.50 ج.م due
 * 21/08/2026 … 21/01/2027). Pure; no I/O.
 */

import { Money, allocate } from "../money/index.js";
import { InvalidInstallmentScheduleError } from "./errors.js";

/** docs/archive/catalog/05 §"التكرار *" — full option set observed on the create form. */
export const INSTALLMENT_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"] as const;
export type InstallmentFrequency = (typeof INSTALLMENT_FREQUENCIES)[number];

export interface GenerateInstallmentScheduleInput {
  readonly invoiceTotal: Money;
  readonly downPayment: Money;
  readonly installmentCount: number;
  readonly frequency: InstallmentFrequency;
  /** ISO date (YYYY-MM-DD) the FIRST installment is due on (not the down-payment date). */
  readonly startDate: string;
}

export interface GeneratedInstallment {
  readonly no: number;
  readonly dueDate: string;
  readonly amount: Money;
  /** Running "المبلغ المتبقي" balance after this installment — 0.00 on the last one. */
  readonly remainingAfter: Money;
}

export interface GeneratedSchedule {
  readonly totalAmount: Money;
  readonly downPayment: Money;
  /** `totalAmount − downPayment` — what the schedule below sums to. */
  readonly remainingAmount: Money;
  readonly installments: readonly GeneratedInstallment[];
}

/**
 * Advance `iso` by `periods` × the frequency's step. MONTHLY/QUARTERLY use
 * calendar-month arithmetic (`Date.UTC` normalizes overflow, e.g. Jan 31 + 1
 * month → Mar 3 when February is short) — acceptable for this pass; a
 * "clamp to month-end" policy is a follow-up if product wants one.
 */
function advanceDate(iso: string, frequency: InstallmentFrequency, periods: number): string {
  const parts = iso.split("-").map(Number);
  const y = parts[0] as number;
  const m = parts[1] as number;
  const d = parts[2] as number;
  const date = new Date(Date.UTC(y, m - 1, d));
  switch (frequency) {
    case "WEEKLY":
      date.setUTCDate(date.getUTCDate() + 7 * periods);
      break;
    case "BIWEEKLY":
      date.setUTCDate(date.getUTCDate() + 14 * periods);
      break;
    case "MONTHLY":
      date.setUTCMonth(date.getUTCMonth() + periods);
      break;
    case "QUARTERLY":
      date.setUTCMonth(date.getUTCMonth() + 3 * periods);
      break;
  }
  return date.toISOString().slice(0, 10);
}

export function generateInstallmentSchedule(input: GenerateInstallmentScheduleInput): GeneratedSchedule {
  if (input.installmentCount < 1) {
    throw new InvalidInstallmentScheduleError("عدد الأقساط يجب أن يكون 1 على الأقل.", "The number of installments must be at least 1.");
  }
  if (input.invoiceTotal.scaled < 0n) {
    throw new InvalidInstallmentScheduleError("إجمالي الفاتورة لا يمكن أن يكون سالباً.", "The invoice total cannot be negative.");
  }
  if (input.downPayment.scaled < 0n) {
    throw new InvalidInstallmentScheduleError("الدفعة المقدمة لا يمكن أن تكون سالبة.", "The down payment cannot be negative.");
  }
  if (input.downPayment.scaled > input.invoiceTotal.scaled) {
    throw new InvalidInstallmentScheduleError("الدفعة المقدمة لا يمكن أن تتجاوز إجمالي الفاتورة.", "The down payment cannot exceed the invoice total.");
  }

  const remaining = input.invoiceTotal.add(input.downPayment.negate());
  const shares = allocate(remaining, new Array(input.installmentCount).fill(1) as number[]);

  let runningRemaining = remaining;
  const installments: GeneratedInstallment[] = shares.map((amount, i) => {
    runningRemaining = runningRemaining.add((amount as Money).negate());
    return {
      no: i + 1,
      dueDate: advanceDate(input.startDate, input.frequency, i),
      amount: amount as Money,
      remainingAfter: runningRemaining,
    };
  });

  return {
    totalAmount: input.invoiceTotal,
    downPayment: input.downPayment,
    remainingAmount: remaining,
    installments,
  };
}
