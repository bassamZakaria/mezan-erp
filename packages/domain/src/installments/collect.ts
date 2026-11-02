/**
 * تحصيل قسط (docs/archive/catalog/05 §"خطط الأقساط") — applying a collected
 * payment to a plan's installments.
 *
 * The catalogue has defined `installments.collect` and
 * `installments.collection.create` since the module shipped, and nothing ever
 * wrote `InstallmentLine.paidAmount`: the follow-up queue chased money the
 * product had no way to receive (D119). This module is the pure half — it
 * decides which lines a payment settles and what the plan looks like
 * afterwards. The cash itself is a treasury customer-collection voucher,
 * raised by the route, because an installment plan posts nothing to the GL
 * on its own.
 */

import { Money } from "../money/index.js";
import type { InstallmentLine, InstallmentPlanDocument } from "./installment-plan-document.js";
import {
  InstallmentPlanNotCollectableError,
  InstallmentLineNotCollectableError,
  InstallmentOverpaymentError,
} from "./errors.js";

export interface CollectInstallmentCommand {
  /** The installment number to settle. Omitted, the payment runs down the schedule oldest-first. */
  readonly installmentNo?: number;
  readonly amount: Money;
}

export interface CollectInstallmentResult {
  readonly plan: InstallmentPlanDocument;
  /** Per-installment breakdown of what this payment settled, in the order it was applied. */
  readonly applied: readonly { readonly no: number; readonly amount: Money; readonly settled: boolean }[];
  /** The source invoice every line of the plan belongs to — what the voucher is allocated against. */
  readonly sourceInvoiceId: string;
  readonly customerId: string;
  readonly remaining: Money;
}

const COLLECTABLE_LINE_STATUSES = new Set(["pending", "overdue"]);

/** What a line still owes: its amount plus any late fee, less what is already paid. */
export function outstandingOf(line: InstallmentLine): Money {
  return line.amount.add(line.lateFeeAmount).add(line.paidAmount.negate());
}

/**
 * Applies `amount` to the plan and returns the updated document. Pure — the
 * input plan is never mutated.
 *
 * Without an explicit `installmentNo` the payment runs down the schedule
 * oldest-first, which is what a customer handing over a round sum means and
 * what every aging report downstream assumes. A payment larger than what the
 * plan still owes is REFUSED rather than parked as a credit: an installment
 * plan has no credit balance to hold it, and turning the excess into one
 * silently would put money on a document that cannot show it.
 */
export function collectInstallment(
  plan: InstallmentPlanDocument,
  cmd: CollectInstallmentCommand,
): CollectInstallmentResult {
  if (plan.status !== "confirmed") {
    throw new InstallmentPlanNotCollectableError(plan.id, plan.status);
  }
  if (cmd.amount.scaled <= 0n) {
    throw new InstallmentLineNotCollectableError(plan.id, "قيمة التحصيل يجب أن تكون أكبر من صفر.", "The collection amount must be greater than zero.");
  }

  const targets =
    cmd.installmentNo === undefined
      ? plan.lines.filter((l) => COLLECTABLE_LINE_STATUSES.has(l.status) && outstandingOf(l).scaled > 0n)
      : plan.lines.filter((l) => l.no === cmd.installmentNo);

  if (cmd.installmentNo !== undefined) {
    const line = targets[0];
    if (!line) {
      throw new InstallmentLineNotCollectableError(plan.id, `القسط رقم ${cmd.installmentNo} غير موجود في هذه الخطة.`, `Installment no. ${cmd.installmentNo} does not exist in this plan.`);
    }
    if (!COLLECTABLE_LINE_STATUSES.has(line.status)) {
      throw new InstallmentLineNotCollectableError(
        plan.id,
        `القسط رقم ${line.no} لا يقبل التحصيل — حالته ${line.status === "paid" ? "مسدد" : "ملغي"}.`,
        `Installment no. ${line.no} cannot be collected — its status is ${line.status === "paid" ? "paid" : "cancelled"}.`,
      );
    }
  }

  const collectable = Money.sum(targets.map(outstandingOf));
  if (cmd.amount.scaled > collectable.scaled) {
    throw new InstallmentOverpaymentError(plan.id, cmd.amount, collectable);
  }

  let left = cmd.amount;
  const applied: { no: number; amount: Money; settled: boolean }[] = [];
  const byNo = new Map<number, Money>();
  for (const line of targets) {
    if (left.scaled <= 0n) break;
    const owed = outstandingOf(line);
    if (owed.scaled <= 0n) continue;
    const take = left.scaled >= owed.scaled ? owed : left;
    byNo.set(line.no, take);
    applied.push({ no: line.no, amount: take, settled: take.scaled === owed.scaled });
    left = left.add(take.negate());
  }

  const lines = plan.lines.map((line) => {
    const take = byNo.get(line.no);
    if (!take) return line;
    const paidAmount = line.paidAmount.add(take);
    const settled = paidAmount.scaled >= line.amount.add(line.lateFeeAmount).scaled;
    return { ...line, paidAmount, status: settled ? ("paid" as const) : line.status };
  });

  const updated: InstallmentPlanDocument = { ...plan, lines };
  const first = plan.lines[0];
  return {
    plan: updated,
    applied,
    sourceInvoiceId: first?.sourceInvoiceId ?? "",
    customerId: first?.customerId ?? "",
    remaining: Money.sum(lines.map(outstandingOf)),
  };
}
