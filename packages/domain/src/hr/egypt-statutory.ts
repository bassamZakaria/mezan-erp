import { Money } from "../money/index.js";
import { StatutoryRulesUnavailableError } from "./errors.js";

/**
 * Egyptian statutory payroll rules as VERSIONED DATED DATA.
 *
 * docs/archive/plan.md §6.2 — "model legal constants as versioned, dated data,
 * never as hardcoded logic". Every rate, threshold and cap below carries the
 * date it took effect and the law it comes from, so an accountant can read this
 * file top to bottom against the gazette and a run for any past period computes
 * with the rules that were in force THEN, not the rules in force today.
 *
 * The social-insurance floor and ceiling rise 15% every 1 January for seven
 * years from 2021 (Law 148/2019, PM Resolution 2473/2021). A hard-coded
 * ceiling is therefore wrong the following January by construction — which is
 * exactly why a table with no row covering the period makes the run REFUSE
 * (`resolveEgyptStatutoryRules` throws) rather than fall back to a stale
 * figure. Adding next year's row is a data edit, not a code change.
 *
 * Only years whose published figures could be verified are present. A year is
 * absent rather than interpolated: an invented threshold is indistinguishable
 * from a bug.
 */

/**
 * Rates are basis points of a percent — 1 bp = 0.01%. Integers throughout, so
 * 27.5% is 2750 and 0.05% is 5; no rate is ever a float.
 */
export type BasisPoints = number;

export const BASIS_POINTS_PER_UNIT = 10_000;

// --- Income tax (ضريبة كسب العمل) ------------------------------------------

export interface IncomeTaxBracket {
  /** Upper bound of the band in annual EGP, exact decimal string; null = unbounded. */
  readonly upToAnnual: string | null;
  readonly rateBp: BasisPoints;
}

/**
 * Above certain annual incomes the lowest bands stop being available: the
 * income that would have fallen in them is taxed at the lowest SURVIVING rate
 * instead. `dropsLowestBrackets` is how many of the lowest bands are folded
 * upward at that income level.
 */
export interface BracketEliminationTier {
  /** Applies when annual taxable income exceeds this, exact decimal string. */
  readonly aboveAnnual: string;
  /** …and does not exceed this; null = no upper bound. */
  readonly upToAnnual: string | null;
  readonly dropsLowestBrackets: number;
}

export interface IncomeTaxTable {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  /** الإعفاء الشخصي السنوي — deducted from annual taxable income before the brackets. */
  readonly annualPersonalExemption: string;
  readonly brackets: readonly IncomeTaxBracket[];
  readonly eliminationTiers: readonly BracketEliminationTier[];
}

export const EGYPT_INCOME_TAX_TABLES: readonly IncomeTaxTable[] = [
  {
    code: "EG_SALARY_TAX_2025",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    citationAr: "قانون الضريبة على الدخل 91 لسنة 2005 وتعديلاته — الشرائح بالقانون 30 لسنة 2023، والإعفاء الشخصي 20,000 جنيه بالقانون 7 لسنة 2024",
    annualPersonalExemption: "20000",
    brackets: [
      { upToAnnual: "40000", rateBp: 0 },
      { upToAnnual: "55000", rateBp: 1000 },
      { upToAnnual: "70000", rateBp: 1500 },
      { upToAnnual: "200000", rateBp: 2000 },
      { upToAnnual: "400000", rateBp: 2250 },
      { upToAnnual: "1200000", rateBp: 2500 },
      { upToAnnual: null, rateBp: 2750 },
    ],
    eliminationTiers: [
      { aboveAnnual: "600000", upToAnnual: "700000", dropsLowestBrackets: 1 },
      { aboveAnnual: "700000", upToAnnual: "800000", dropsLowestBrackets: 2 },
      { aboveAnnual: "800000", upToAnnual: "900000", dropsLowestBrackets: 3 },
      { aboveAnnual: "900000", upToAnnual: "1200000", dropsLowestBrackets: 4 },
      { aboveAnnual: "1200000", upToAnnual: null, dropsLowestBrackets: 5 },
    ],
  },
] as const;

// --- Social insurance (التأمينات الاجتماعية) --------------------------------

/** One named sub-fund of a contribution, so a payslip can say WHAT the money bought. */
export interface ContributionShare {
  readonly code: string;
  readonly labelAr: string;
  readonly rateBp: BasisPoints;
}

export interface SocialInsuranceTable {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  /** الحد الأدنى للأجر التأميني الشهري. */
  readonly monthlyWageFloor: string;
  /** الحد الأقصى للأجر التأميني الشهري. */
  readonly monthlyWageCeiling: string;
  readonly employeeShares: readonly ContributionShare[];
  readonly employerShares: readonly ContributionShare[];
}

const EMPLOYEE_SHARES_148_2019: readonly ContributionShare[] = [
  { code: "pension", labelAr: "الشيخوخة والعجز والوفاة", rateBp: 900 },
  { code: "end_of_service", labelAr: "مكافأة نهاية الخدمة", rateBp: 100 },
  { code: "sickness", labelAr: "المرض", rateBp: 100 },
] as const;

const EMPLOYER_SHARES_148_2019: readonly ContributionShare[] = [
  { code: "pension", labelAr: "الشيخوخة والعجز والوفاة", rateBp: 1200 },
  { code: "end_of_service", labelAr: "مكافأة نهاية الخدمة", rateBp: 100 },
  { code: "sickness", labelAr: "المرض", rateBp: 325 },
  { code: "unemployment", labelAr: "التعطل", rateBp: 100 },
  { code: "work_injury", labelAr: "إصابة العمل", rateBp: 150 },
] as const;

export const EGYPT_SOCIAL_INSURANCE_TABLES: readonly SocialInsuranceTable[] = [
  {
    code: "EG_SOCIAL_INSURANCE_2024",
    effectiveFrom: "2024-01-01",
    effectiveTo: "2024-12-31",
    citationAr: "قانون التأمينات الاجتماعية والمعاشات 148 لسنة 2019 — حدود الأجر التأميني لعام 2024",
    monthlyWageFloor: "2000",
    monthlyWageCeiling: "12600",
    employeeShares: EMPLOYEE_SHARES_148_2019,
    employerShares: EMPLOYER_SHARES_148_2019,
  },
  {
    code: "EG_SOCIAL_INSURANCE_2025",
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-12-31",
    citationAr: "قانون التأمينات الاجتماعية والمعاشات 148 لسنة 2019 — حدود الأجر التأميني لعام 2025",
    monthlyWageFloor: "2300",
    monthlyWageCeiling: "14500",
    employeeShares: EMPLOYEE_SHARES_148_2019,
    employerShares: EMPLOYER_SHARES_148_2019,
  },
  {
    code: "EG_SOCIAL_INSURANCE_2026",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    citationAr: "قانون التأمينات الاجتماعية والمعاشات 148 لسنة 2019 — حدود الأجر التأميني لعام 2026 (الحد الأدنى 2,700 والحد الأقصى 16,700)",
    monthlyWageFloor: "2700",
    monthlyWageCeiling: "16700",
    employeeShares: EMPLOYEE_SHARES_148_2019,
    employerShares: EMPLOYER_SHARES_148_2019,
  },
] as const;

// --- Payroll levies (الرسوم والاقتطاعات) -----------------------------------

export type LevyBase = "gross" | "insurable";
export type LevySide = "employee" | "employer";

export interface PayrollLevy {
  readonly code: string;
  readonly labelAr: string;
  readonly rateBp: BasisPoints;
  readonly base: LevyBase;
  readonly side: LevySide;
}

export interface PayrollLevyTable {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  readonly levies: readonly PayrollLevy[];
}

export const EGYPT_PAYROLL_LEVY_TABLES: readonly PayrollLevyTable[] = [
  {
    code: "EG_PAYROLL_LEVIES_2024",
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    citationAr: "صندوق تكريم شهداء وضحايا ومصابي العمليات الحربية والإرهابية — 0.05% من إجمالي الأجر الشهري يستقطعها صاحب العمل",
    levies: [{ code: "martyrs_fund", labelAr: "صندوق تكريم الشهداء", rateBp: 5, base: "gross", side: "employee" }],
  },
] as const;

// --- Overtime (الأجر الإضافي) ----------------------------------------------

export interface OvertimeTable {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  /** Premium ON TOP of the normal hourly rate: 3500 bp = paid at 135%. */
  readonly dayPremiumBp: BasisPoints;
  readonly nightPremiumBp: BasisPoints;
  readonly restDayPremiumBp: BasisPoints;
  /** Hours from this (inclusive) to `nightEndHour` (exclusive) count as night work. */
  readonly nightStartHour: number;
  readonly nightEndHour: number;
  readonly standardDailyHours: number;
  readonly standardWeeklyHours: number;
}

export const EGYPT_OVERTIME_TABLES: readonly OvertimeTable[] = [
  {
    code: "EG_OVERTIME_12_2003",
    effectiveFrom: "2003-07-08",
    effectiveTo: "2025-08-31",
    citationAr: "قانون العمل 12 لسنة 2003 — 35% نهاراً و70% ليلاً، ويوم الراحة بالمثل",
    dayPremiumBp: 3500,
    nightPremiumBp: 7000,
    restDayPremiumBp: 10_000,
    nightStartHour: 19,
    nightEndHour: 7,
    standardDailyHours: 8,
    standardWeeklyHours: 48,
  },
  {
    code: "EG_OVERTIME_14_2025",
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    citationAr: "قانون العمل 14 لسنة 2025 — 35% نهاراً و70% ليلاً، ويوم الراحة بالمثل؛ ساعات العمل 8 يومياً و48 أسبوعياً",
    dayPremiumBp: 3500,
    nightPremiumBp: 7000,
    restDayPremiumBp: 10_000,
    nightStartHour: 19,
    nightEndHour: 7,
    standardDailyHours: 8,
    standardWeeklyHours: 48,
  },
] as const;

// --- End of service (مكافأة نهاية الخدمة) -----------------------------------

export interface EndOfServiceTier {
  /** This tier covers service years up to and including this; null = every remaining year. */
  readonly throughYears: number | null;
  /** Months of wage earned per service year in this tier, exact decimal string. */
  readonly monthsPerYear: string;
}

export interface EndOfServiceTable {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  readonly tiers: readonly EndOfServiceTier[];
  /** الحد الأدنى للعلاوة الدورية السنوية — 3% of the insurable wage under Law 14/2025. */
  readonly minimumAnnualRaiseBp: BasisPoints;
}

export const EGYPT_END_OF_SERVICE_TABLES: readonly EndOfServiceTable[] = [
  {
    code: "EG_END_OF_SERVICE_14_2025",
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    citationAr: "قانون العمل 14 لسنة 2025 — نصف شهر عن كل سنة من السنوات الخمس الأولى، وشهر كامل عن كل سنة تالية",
    tiers: [
      { throughYears: 5, monthsPerYear: "0.5" },
      { throughYears: null, monthsPerYear: "1" },
    ],
    minimumAnnualRaiseBp: 300,
  },
] as const;

// --- Resolution -------------------------------------------------------------

export interface EgyptStatutoryRules {
  readonly onDate: string;
  readonly incomeTax: IncomeTaxTable;
  readonly socialInsurance: SocialInsuranceTable;
  readonly levies: PayrollLevyTable;
  readonly overtime: OvertimeTable;
  readonly endOfService: EndOfServiceTable;
}

interface DatedTable {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** The row in force on `onDate`; null when no row covers it. Latest `effectiveFrom` wins. */
function inForce<T extends DatedTable>(tables: readonly T[], onDate: string): T | null {
  const covering = tables.filter((t) => t.effectiveFrom <= onDate && (t.effectiveTo === null || t.effectiveTo >= onDate));
  if (covering.length === 0) return null;
  return [...covering].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0))[0] ?? null;
}

/**
 * The statutory rules in force on a date.
 *
 * Throws rather than falling back when any table has no row covering the date:
 * a payroll run computed on a superseded ceiling is a wrong net that looks
 * right, and the whole point of dating these tables is that it can never ship.
 * The error names every missing table so an admin knows exactly what to add.
 */
export function resolveEgyptStatutoryRules(onDate: string): EgyptStatutoryRules {
  const incomeTax = inForce(EGYPT_INCOME_TAX_TABLES, onDate);
  const socialInsurance = inForce(EGYPT_SOCIAL_INSURANCE_TABLES, onDate);
  const levies = inForce(EGYPT_PAYROLL_LEVY_TABLES, onDate);
  const overtime = inForce(EGYPT_OVERTIME_TABLES, onDate);
  const endOfService = inForce(EGYPT_END_OF_SERVICE_TABLES, onDate);

  const missing: string[] = [];
  if (!incomeTax) missing.push("شرائح ضريبة كسب العمل");
  if (!socialInsurance) missing.push("حدود ونسب التأمينات الاجتماعية");
  if (!levies) missing.push("الرسوم المستقطعة من الأجر");
  if (!overtime) missing.push("معاملات الأجر الإضافي");
  if (!endOfService) missing.push("قواعد مكافأة نهاية الخدمة");
  if (missing.length > 0 || !incomeTax || !socialInsurance || !levies || !overtime || !endOfService) {
    throw new StatutoryRulesUnavailableError(onDate, missing);
  }

  return { onDate, incomeTax, socialInsurance, levies, overtime, endOfService };
}

/** Every statutory table, for the settings screen that lists what the tenant is computing against. */
export function listEgyptStatutoryTables(): {
  readonly incomeTax: readonly IncomeTaxTable[];
  readonly socialInsurance: readonly SocialInsuranceTable[];
  readonly levies: readonly PayrollLevyTable[];
  readonly overtime: readonly OvertimeTable[];
  readonly endOfService: readonly EndOfServiceTable[];
} {
  return {
    incomeTax: EGYPT_INCOME_TAX_TABLES,
    socialInsurance: EGYPT_SOCIAL_INSURANCE_TABLES,
    levies: EGYPT_PAYROLL_LEVY_TABLES,
    overtime: EGYPT_OVERTIME_TABLES,
    endOfService: EGYPT_END_OF_SERVICE_TABLES,
  };
}

/** Total of a contribution's named sub-funds, in basis points. */
export function totalShareBp(shares: readonly ContributionShare[]): BasisPoints {
  return shares.reduce((sum, s) => sum + s.rateBp, 0);
}

/** Formats a basis-point rate as a percent string for Arabic labels: 1875 → "18.75". */
export function formatRateBp(rateBp: BasisPoints): string {
  const whole = Math.trunc(rateBp / 100);
  const frac = Math.abs(rateBp % 100);
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** Parses a table's exact decimal string into Money. Never `Number(...)`. */
export function tableAmount(value: string): Money {
  return Money.fromMajor(value);
}
