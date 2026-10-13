import type { Money } from "../money/index.js";

export function displayAmount(amount: Money): string {
  const text = amount.toString();
  const point = text.indexOf(".");
  return point === -1 ? `${text}.00` : text.slice(0, point + 3).padEnd(point + 3, "0");
}

export interface ApprovalLabelSubject {
  readonly type: string;
  readonly amount?: Money | null;
  readonly party?: string | null;
}

export function approvalLabel(subject: ApprovalLabelSubject): string {
  const amount = subject.amount ? ` بقيمة ${displayAmount(subject.amount)}` : "";
  const party = subject.party && subject.party.trim() !== "" ? ` — ${subject.party.trim()}` : "";
  return `${subject.type}${amount}${party}`;
}
