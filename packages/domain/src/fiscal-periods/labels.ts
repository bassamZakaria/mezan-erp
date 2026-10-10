import type { FiscalPeriod, FiscalPeriodStatus } from "./fiscal-period.js";

export type FiscalPeriodRef = Pick<FiscalPeriod, "id" | "year" | "periodNumber">;

export enum FiscalPeriodTransition {
  Close = "close",
  Reopen = "reopen",
  Lock = "lock",
}

export interface BilingualText {
  readonly ar: string;
  readonly en: string;
}

const MONTHS: readonly BilingualText[] = [
  { ar: "يناير", en: "January" },
  { ar: "فبراير", en: "February" },
  { ar: "مارس", en: "March" },
  { ar: "أبريل", en: "April" },
  { ar: "مايو", en: "May" },
  { ar: "يونيو", en: "June" },
  { ar: "يوليو", en: "July" },
  { ar: "أغسطس", en: "August" },
  { ar: "سبتمبر", en: "September" },
  { ar: "أكتوبر", en: "October" },
  { ar: "نوفمبر", en: "November" },
  { ar: "ديسمبر", en: "December" },
];

export const FISCAL_PERIOD_STATUS_LABEL: Readonly<Record<FiscalPeriodStatus, BilingualText>> = {
  open: { ar: "مفتوحة", en: "open" },
  closed: { ar: "مغلقة", en: "closed" },
  locked: { ar: "مقفلة", en: "locked" },
};

export function fiscalPeriodLabel(period: FiscalPeriodRef): BilingualText {
  const month = MONTHS[period.periodNumber - 1];
  if (!month) return { ar: `الفترة ${period.periodNumber} لسنة ${period.year}`, en: `period ${period.periodNumber} of ${period.year}` };
  return { ar: `${month.ar} ${period.year}`, en: `${month.en} ${period.year}` };
}

const GENERATED_PERIOD_ID = /^fp-(\d{4})-(\d{2})$/;

/** A caller that holds only the period's id still gets the month named, when the id is a generated one. */
export function fiscalPeriodRefOf(period: FiscalPeriodRef | string): FiscalPeriodRef | null {
  if (typeof period !== "string") return period;
  const match = GENERATED_PERIOD_ID.exec(period);
  return match ? { id: period, year: Number(match[1]), periodNumber: Number(match[2]) } : null;
}

export function quotedFiscalPeriod(period: FiscalPeriodRef): BilingualText {
  const label = fiscalPeriodLabel(period);
  return { ar: `الفترة المحاسبية «${label.ar}»`, en: `fiscal period ${label.en}` };
}

export const FISCAL_PERIOD_TRANSITION_REFUSAL: Readonly<Record<FiscalPeriodTransition, (period: FiscalPeriodRef, status: FiscalPeriodStatus) => BilingualText>> = {
  [FiscalPeriodTransition.Close]: (period, status) => ({
    ar: `لا يمكن إقفال ${quotedFiscalPeriod(period).ar} وهي ${FISCAL_PERIOD_STATUS_LABEL[status].ar}.`,
    en: `Fiscal period ${fiscalPeriodLabel(period).en} cannot be closed while it is ${FISCAL_PERIOD_STATUS_LABEL[status].en}.`,
  }),
  [FiscalPeriodTransition.Reopen]: (period, status) => ({
    ar: `لا يمكن إعادة فتح ${quotedFiscalPeriod(period).ar} وهي ${FISCAL_PERIOD_STATUS_LABEL[status].ar}.`,
    en: `Fiscal period ${fiscalPeriodLabel(period).en} cannot be reopened while it is ${FISCAL_PERIOD_STATUS_LABEL[status].en}.`,
  }),
  [FiscalPeriodTransition.Lock]: (period, status) => ({
    ar: `لا يمكن قفل ${quotedFiscalPeriod(period).ar} نهائياً وهي ${FISCAL_PERIOD_STATUS_LABEL[status].ar}.`,
    en: `Fiscal period ${fiscalPeriodLabel(period).en} cannot be locked while it is ${FISCAL_PERIOD_STATUS_LABEL[status].en}.`,
  }),
};
