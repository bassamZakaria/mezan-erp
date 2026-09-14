/**
 * النظام الضريبي المبسط للمشروعات الصغيرة — the statutory table behind Law
 * 6/2025, held as effective-dated data rather than as constants inside the
 * arithmetic.
 *
 * WHY THIS SHAPE. Every figure here is somebody else's decision: a band rate,
 * a turnover ceiling, a concentration test, a grace window. A constant written
 * into a calculation asserts the figure as fact and loses the two things that
 * actually matter when a number turns out to be wrong — WHEN it applied, and
 * WHERE it came from. So each value is a {@link StatutoryValue}: the number,
 * the article it is read from, and the window it is in force for. A later
 * amendment is a new {@link SimplifiedRegimeSchedule} with its own
 * `effectiveFrom`, and every figure Mezan ever showed can still be explained
 * by the table that was in force on the day it was shown.
 *
 * NOT COMPLIANCE. Nothing in this module is signed off by a محاسب قانوني. The
 * liability it computes is an ESTIMATE for an owner to take to their
 * accountant, and every surface that renders it says so.
 */

import { Money } from "../money/index.js";

/** A statutory figure, the article it comes from, and nothing implied beyond it. */
export interface StatutoryValue<T> {
  readonly value: T;
  /** The law, decree and article this figure is read from. Never a paraphrase of the rule. */
  readonly source: string;
}

export interface SimplifiedRegimeBand {
  /** Inclusive lower bound of annual turnover. */
  readonly from: Money;
  /** Exclusive upper bound; `null` on the top band. */
  readonly to: Money | null;
  /** Percent of GROSS TURNOVER — not of profit. */
  readonly ratePercent: number;
  readonly source: string;
}

export type VatPeriodMode = "monthly" | "quarterly";

export interface ConcentrationTest {
  /** The revenue share, in percent, at or above which the exclusion may bite. */
  readonly sharePercent: number;
  /** How many clients that share is measured across. */
  readonly clientCount: number;
}

export interface OvershootGrace {
  /** How far above the ceiling turnover may go and still be granted the grace. */
  readonly overshootPercent: number;
  readonly years: number;
  /** The band the grace year is charged at. */
  readonly ratePercent: number;
}

export interface VatFilingRule {
  readonly mode: VatPeriodMode;
  /** Months after the period's last day that the return falls due. */
  readonly dueWithinMonths: number;
}

/**
 * An obligation the regime lifts. Mezan names them and cites them; it does not
 * price them — a figure for "stamp duty avoided" would be invented, and an
 * invented number is indistinguishable from a bug.
 */
export interface RegimeExemption {
  readonly key: string;
  readonly labelAr: string;
  readonly labelEn: string;
  readonly source: string;
}

export interface SimplifiedRegimeSchedule {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly bands: readonly SimplifiedRegimeBand[];
  readonly turnoverCeiling: StatutoryValue<Money>;
  readonly concentration: StatutoryValue<ConcentrationTest>;
  readonly overshootGrace: StatutoryValue<OvershootGrace>;
  readonly irrevocableYears: StatutoryValue<number>;
  readonly vatFiling: StatutoryValue<VatFilingRule>;
  readonly exemptions: StatutoryValue<readonly RegimeExemption[]>;
  /** The rate the SAME profit would bear outside the regime, for the comparison report. */
  readonly normalIncomeTaxPercent: StatutoryValue<number>;
  readonly electionFormRef: StatutoryValue<string>;
  readonly withdrawalFormRef: StatutoryValue<string>;
  readonly annualReturnFormRef: StatutoryValue<string>;
}

const LAW = "قانون 6 لسنة 2025 — تيسيرات ضريبية للمشروعات الصغيرة";

/**
 * The table in force from 1 March 2025. The bands are read as
 * inclusive-lower / exclusive-upper, so turnover of exactly 500,000 sits in
 * the 0.5% band — see the caveat in the sibling tests: the statute's own
 * wording at the boundary has NOT been verified against the Arabic gazette
 * text, only against secondary summaries.
 */
const SCHEDULE_2025_03: SimplifiedRegimeSchedule = {
  id: "eg-law-6-2025",
  effectiveFrom: "2025-03-01",
  effectiveTo: null,
  bands: [
    { from: Money.fromMajor("0"), to: Money.fromMajor("500000"), ratePercent: 0.4, source: `${LAW} — جدول شرائح حجم الأعمال` },
    { from: Money.fromMajor("500000"), to: Money.fromMajor("2000000"), ratePercent: 0.5, source: `${LAW} — جدول شرائح حجم الأعمال` },
    { from: Money.fromMajor("2000000"), to: Money.fromMajor("3000000"), ratePercent: 0.75, source: `${LAW} — جدول شرائح حجم الأعمال` },
    { from: Money.fromMajor("3000000"), to: Money.fromMajor("10000000"), ratePercent: 1.0, source: `${LAW} — جدول شرائح حجم الأعمال` },
    { from: Money.fromMajor("10000000"), to: Money.fromMajor("20000000"), ratePercent: 1.5, source: `${LAW} — جدول شرائح حجم الأعمال` },
  ],
  turnoverCeiling: { value: Money.fromMajor("20000000"), source: `${LAW} — حد الأهلية السنوي` },
  concentration: { value: { sharePercent: 90, clientCount: 2 }, source: `${LAW} — استبعاد التركّز في العملاء` },
  overshootGrace: { value: { overshootPercent: 20, years: 1, ratePercent: 1.5 }, source: `${LAW} — مهلة تجاوز الحد` },
  irrevocableYears: { value: 5, source: `${LAW} — إلزامية الاختيار لمدة خمس سنوات` },
  vatFiling: { value: { mode: "quarterly", dueWithinMonths: 1 }, source: `${LAW} — الإقرار الربع سنوي لضريبة القيمة المضافة` },
  exemptions: {
    value: [
      { key: "withholding", labelAr: "الإعفاء من الخصم والتحصيل تحت حساب الضريبة", labelEn: "Exempt from withholding tax", source: LAW },
      { key: "advancePayments", labelAr: "الإعفاء من نظام الدفعات المقدمة", labelEn: "Exempt from advance payments", source: LAW },
      { key: "stampDuty", labelAr: "الإعفاء من ضريبة الدمغة", labelEn: "Exempt from stamp duty", source: LAW },
      { key: "developmentFee", labelAr: "الإعفاء من رسم تنمية الموارد", labelEn: "Exempt from the development fee", source: LAW },
      { key: "dividendTax", labelAr: "الإعفاء من ضريبة توزيعات الأرباح", labelEn: "Exempt from dividend tax", source: LAW },
      { key: "capitalGains", labelAr: "الإعفاء من ضريبة الأرباح الرأسمالية", labelEn: "Exempt from capital-gains tax", source: LAW },
      { key: "auditDeferral", labelAr: "تأجيل الفحص الضريبي خمس سنوات", labelEn: "Tax audit deferred five years", source: LAW },
      { key: "payrollAnnual", labelAr: "تسوية ضريبة كسب العمل سنوياً بدلاً من شهرياً", labelEn: "Payroll tax settled annually", source: LAW },
    ],
    source: LAW,
  },
  normalIncomeTaxPercent: { value: 22.5, source: "قانون الضريبة على الدخل 91 لسنة 2005 — سعر ضريبة أرباح الأشخاص الاعتبارية" },
  electionFormRef: { value: "1/10", source: `${LAW} — نموذج الاختيار` },
  withdrawalFormRef: { value: "1/11", source: `${LAW} — نموذج التخارج` },
  annualReturnFormRef: { value: "20", source: `${LAW} — الإقرار السنوي` },
};

/** Every published table, newest last. An amendment is appended, never edited in place. */
export const SIMPLIFIED_REGIME_SCHEDULES: readonly SimplifiedRegimeSchedule[] = [SCHEDULE_2025_03];

/** The table in force on `day`, or null for a day before the regime existed. */
export function simplifiedRegimeScheduleOn(day: string): SimplifiedRegimeSchedule | null {
  const candidates = SIMPLIFIED_REGIME_SCHEDULES.filter(
    (schedule) => schedule.effectiveFrom <= day && (schedule.effectiveTo === null || day <= schedule.effectiveTo),
  );
  return candidates[candidates.length - 1] ?? null;
}

/** The band `turnover` falls in, or null when it is above the top band's ceiling. */
export function bandForTurnover(schedule: SimplifiedRegimeSchedule, turnover: Money): SimplifiedRegimeBand | null {
  return (
    schedule.bands.find(
      (band) => turnover.scaled >= band.from.scaled && (band.to === null || turnover.scaled < band.to.scaled),
    ) ?? null
  );
}
