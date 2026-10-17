import { Money } from "../money/index.js";
import { formatMoneyLabel, type RenderedMessage } from "./message.js";
import type { CollectionWorkItem } from "./types.js";

export interface OpenItemStatementInput {
  readonly customerName: string;
  readonly companyName: string;
  readonly asOfDate: string;
  readonly currency: string;
  readonly items: readonly CollectionWorkItem[];
  readonly balance: Money;
}

export function renderOpenItemStatement(input: OpenItemStatementInput): RenderedMessage {
  const overdue = Money.sum(input.items.filter((i) => i.daysOverdue > 0).map((i) => i.amount));
  const ordered = [...input.items].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const arLines = ordered.map(
    (item) =>
      `• ${item.reference ?? "رصيد سابق"} — استحقاق ${item.dueDate} — ${formatMoneyLabel(item.amount, input.currency)}` +
      (item.daysOverdue > 0 ? ` (متأخر ${item.daysOverdue} يوماً)` : ""),
  );
  const enLines = ordered.map(
    (item) =>
      `• ${item.reference ?? "Prior balance"} — due ${item.dueDate} — ${formatMoneyLabel(item.amount, input.currency)}` +
      (item.daysOverdue > 0 ? ` (${item.daysOverdue} days overdue)` : ""),
  );
  const company = input.companyName.trim();
  const ar = [
    `السادة ${input.customerName}،`,
    "",
    `كشف حساب بالبنود المفتوحة حتى ${input.asOfDate}:`,
    ...(arLines.length > 0 ? arLines : ["لا توجد بنود مفتوحة."]),
    "",
    `الرصيد المستحق: ${formatMoneyLabel(input.balance, input.currency)}`,
    `منه متأخر: ${formatMoneyLabel(overdue, input.currency)}`,
    ...(company ? ["", company] : []),
  ].join("\n");
  const en = [
    `Dear ${input.customerName},`,
    "",
    `Open-item statement as of ${input.asOfDate}:`,
    ...(enLines.length > 0 ? enLines : ["No open items."]),
    "",
    `Balance due: ${formatMoneyLabel(input.balance, input.currency)}`,
    `Of which overdue: ${formatMoneyLabel(overdue, input.currency)}`,
    ...(company ? ["", company] : []),
  ].join("\n");
  return {
    subject: `كشف حساب حتى ${input.asOfDate}${company ? ` — ${company}` : ""} | Statement of account`,
    body: `${ar}\n\n— — —\n\n${en}`,
  };
}
