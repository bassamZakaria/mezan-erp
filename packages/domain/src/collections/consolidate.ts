import { Money } from "../money/index.js";
import { LANGUAGE_SEPARATOR, currencyLabelAr, formatMoneyLabel, type RenderedMessage } from "./message.js";
import type { DunningReminder } from "./types.js";

const PRIOR_BALANCE_AR = "رصيد سابق";
const PRIOR_BALANCE_EN = "Prior balance";

export function consolidateReminders(reminders: readonly DunningReminder[], currency: string): RenderedMessage | null {
  const lead = [...reminders].sort((a, b) => b.stepLevel - a.stepLevel || b.daysOverdue - a.daysOverdue)[0];
  if (!lead) return null;
  if (reminders.length === 1) return { subject: lead.subject, body: lead.body };
  const ordered = [...reminders].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  const sum = Money.sum(ordered.map((r) => r.amount));
  const totalAr = formatMoneyLabel(sum, currencyLabelAr(currency));
  const totalEn = formatMoneyLabel(sum, currency);
  const ar = ordered
    .map((r) => `• ${r.reference ?? PRIOR_BALANCE_AR} — استحقاق ${r.dueDate} — ${formatMoneyLabel(r.amount, currencyLabelAr(currency))} (متأخر ${r.daysOverdue} يوماً)`)
    .join("\n");
  const en = ordered
    .map((r) => `• ${r.reference ?? PRIOR_BALANCE_EN} — due ${r.dueDate} — ${formatMoneyLabel(r.amount, currency)} (${r.daysOverdue} days overdue)`)
    .join("\n");
  const bilingual = lead.body.includes(LANGUAGE_SEPARATOR);
  const body = [
    lead.body,
    `\n\nالفواتير المشمولة بهذا التذكير (الإجمالي ${totalAr}):\n${ar}`,
    bilingual ? `\n\nInvoices covered by this reminder (total ${totalEn}):\n${en}` : "",
  ].join("");
  return { subject: lead.subject, body };
}
