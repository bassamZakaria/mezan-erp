import { formatMoney } from "../currency/format-money.js";
import type { Money } from "../money/index.js";

const BASE_CURRENCY = "EGP";

export function displayAmount(amount: Money): string {
  return formatMoney(amount);
}

export interface ApprovalSubject {
  readonly type: string;
  readonly amount?: Money | null;
  readonly currency?: string | null;
  readonly party?: string | null;
  readonly reference?: string | null;
}

export function approvalLabel(subject: ApprovalSubject): string {
  const reference = subject.reference && subject.reference.trim() !== "" ? ` على ${subject.reference.trim()}` : "";
  const amount = subject.amount ? ` بقيمة ${formatMoney(subject.amount, subject.currency ?? BASE_CURRENCY)}` : "";
  const party = subject.party && subject.party.trim() !== "" ? ` — ${subject.party.trim()}` : "";
  return `${subject.type}${reference}${amount}${party}`;
}
