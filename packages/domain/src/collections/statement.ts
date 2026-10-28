import { ArabicCase, arabicDays } from "../text/counted-noun.js";
import { Money } from "../money/index.js";
import { currencyLabelAr, formatMoneyLabel, type RenderedMessage } from "./message.js";
import type { CollectionWorkItem } from "./types.js";

export interface OpenItemStatementInput {
  readonly customerName: string;
  readonly companyName: string;
  readonly asOfDate: string;
  readonly currency: string;
  readonly items: readonly CollectionWorkItem[];
  readonly balance: Money;
}

export enum StatementPlaceholder {
  CustomerName = "customerName",
  CompanyName = "companyName",
  AsOfDate = "asOfDate",
  OpenItems = "openItems",
  OpenItemsEn = "openItemsEn",
  BalanceDue = "balanceDue",
  BalanceDueEn = "balanceDueEn",
  OverdueAmount = "overdueAmount",
  OverdueAmountEn = "overdueAmountEn",
}

export interface StatementEmailTemplate {
  readonly subject: string;
  readonly body: string;
}

export const DEFAULT_STATEMENT_EMAIL_SUBJECT = "كشف حساب حتى {{asOfDate}} — {{companyName}} | Statement of account";

export const DEFAULT_STATEMENT_EMAIL_BODY = [
  "السادة {{customerName}}،",
  "",
  "كشف حساب بالبنود المفتوحة حتى {{asOfDate}}:",
  "{{openItems}}",
  "",
  "الرصيد المستحق: {{balanceDue}}",
  "منه متأخر: {{overdueAmount}}",
  "",
  "{{companyName}}",
  "",
  "— — —",
  "",
  "Dear {{customerName}},",
  "",
  "Open-item statement as of {{asOfDate}}:",
  "{{openItemsEn}}",
  "",
  "Balance due: {{balanceDueEn}}",
  "Of which overdue: {{overdueAmountEn}}",
  "",
  "{{companyName}}",
].join("\n");

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function fill(template: string, values: Readonly<Record<StatementPlaceholder, string>>): string {
  return template.replace(TOKEN, (_match, key: string) => values[key as StatementPlaceholder] ?? "");
}

/** SECURITY: the subject is a mail header — no value may carry a line break into it. */
function subjectLine(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+—\s*(\||$)/g, " $1")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function renderOpenItemStatement(input: OpenItemStatementInput, template?: StatementEmailTemplate): RenderedMessage {
  const overdue = Money.sum(input.items.filter((i) => i.daysOverdue > 0).map((i) => i.amount));
  const ordered = [...input.items].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const arLines = ordered.map(
    (item) =>
      `• ${item.reference ?? "رصيد سابق"} — استحقاق ${item.dueDate} — ${formatMoneyLabel(item.amount, currencyLabelAr(input.currency))}` +
      (item.daysOverdue > 0 ? ` (متأخر ${arabicDays(item.daysOverdue, ArabicCase.Oblique)})` : ""),
  );
  const enLines = ordered.map(
    (item) =>
      `• ${item.reference ?? "Prior balance"} — due ${item.dueDate} — ${formatMoneyLabel(item.amount, input.currency)}` +
      (item.daysOverdue > 0 ? ` (${item.daysOverdue} days overdue)` : ""),
  );
  const values: Record<StatementPlaceholder, string> = {
    [StatementPlaceholder.CustomerName]: input.customerName,
    [StatementPlaceholder.CompanyName]: input.companyName.trim(),
    [StatementPlaceholder.AsOfDate]: input.asOfDate,
    [StatementPlaceholder.OpenItems]: arLines.length > 0 ? arLines.join("\n") : "لا توجد بنود مفتوحة.",
    [StatementPlaceholder.OpenItemsEn]: enLines.length > 0 ? enLines.join("\n") : "No open items.",
    [StatementPlaceholder.BalanceDue]: formatMoneyLabel(input.balance, currencyLabelAr(input.currency)),
    [StatementPlaceholder.BalanceDueEn]: formatMoneyLabel(input.balance, input.currency),
    [StatementPlaceholder.OverdueAmount]: formatMoneyLabel(overdue, currencyLabelAr(input.currency)),
    [StatementPlaceholder.OverdueAmountEn]: formatMoneyLabel(overdue, input.currency),
  };
  const subject = template?.subject.trim() ? template.subject : DEFAULT_STATEMENT_EMAIL_SUBJECT;
  const body = template?.body.trim() ? template.body : DEFAULT_STATEMENT_EMAIL_BODY;
  return { subject: subjectLine(fill(subject, values)), body: bodyText(fill(body, values)) };
}
