import type { Money } from "../money/index.js";
import { renderTemplate } from "../notifications/template.js";
import type { DunningStep } from "./types.js";

export function formatMoneyLabel(money: Money, currency: string): string {
  const negative = money.scaled < 0n;
  const abs = negative ? -money.scaled : money.scaled;
  const cents = (abs + 5_000n) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction} ${currency}`;
}

const ARABIC_CURRENCY_LABELS: Readonly<Record<string, string>> = {
  EGP: "ج.م",
  USD: "دولار أمريكي",
  EUR: "يورو",
  SAR: "ر.س",
  AED: "د.إ",
  KWD: "د.ك",
  GBP: "جنيه إسترليني",
};

export function currencyLabelAr(currency: string): string {
  return ARABIC_CURRENCY_LABELS[currency] ?? currency;
}

export interface DunningMessageValues {
  readonly customerName: string;
  readonly companyName: string;
  readonly documentNumber: string;
  readonly amount: string;
  readonly dueDate: string;
  readonly daysOverdue: string;
  readonly daysOverdueLabel: string;
  readonly totalOverdue: string;
}

export interface RenderedMessage {
  readonly subject: string;
  readonly body: string;
}

export const LANGUAGE_SEPARATOR = "\n\n— — —\n\n";

export function renderBilingual(
  subjectAr: string,
  subjectEn: string | null,
  bodyAr: string,
  bodyEn: string | null,
  values: Readonly<Record<string, unknown>>,
  valuesEn: Readonly<Record<string, unknown>> = values,
): RenderedMessage {
  const arSubject = renderTemplate(subjectAr, values).trim();
  const enSubject = subjectEn && subjectEn.trim() !== "" ? renderTemplate(subjectEn, valuesEn).trim() : "";
  const arBody = renderTemplate(bodyAr, values).trim();
  const enBody = bodyEn && bodyEn.trim() !== "" ? renderTemplate(bodyEn, valuesEn).trim() : "";
  return {
    subject: enSubject && arSubject ? `${arSubject} | ${enSubject}` : arSubject || enSubject,
    body: enBody ? `${arBody}${LANGUAGE_SEPARATOR}${enBody}` : arBody,
  };
}

export function renderDunningMessage(step: DunningStep, values: DunningMessageValues, valuesEn: DunningMessageValues = values): RenderedMessage {
  return renderBilingual(step.subjectAr, step.subjectEn, step.bodyAr, step.bodyEn, { ...values }, { ...valuesEn });
}

export function whatsAppNumber(phone: string | null | undefined, defaultCountryCode = "20"): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `${defaultCountryCode}${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith("1") && defaultCountryCode === "20") digits = `20${digits}`;
  digits = digits.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function whatsAppLink(phone: string | null | undefined, text: string): string | null {
  const number = whatsAppNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
