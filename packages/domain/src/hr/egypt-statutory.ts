import { Money } from "../money/index.js";
import { StatutoryRulesUnavailableError } from "./errors.js";

/**
 * Egyptian statutory payroll rules as VERSIONED DATED DATA.
 *
 * docs/archive/plan.md §6.2 — "model legal constants as versioned, dated data,
 * never as hardcoded logic". Every row carries the date it took effect, the law
 * it comes from (`source`, `citationAr`) and whether that figure has been
 * checked against the primary text (`verified`, DEC-6). A run for any past
 * period computes with the rules that were in force THEN.
 *
 * A row nobody has checked against the gazette is `verified: false`, and every
 * screen that prints a figure computed from it says «غير مُتحقَّق منه». No row
 * here has been through the legal review DEC-12 makes a prerequisite, so none
 * is marked verified; flipping one is a reviewed data edit, not a code change.
 *
 * A period no row covers makes the run REFUSE (`resolveEgyptStatutoryRules`
 * throws) rather than fall back to a superseded figure.
 */

/**
 * Rates are basis points of a percent — 1 bp = 0.01%. Integers throughout, so
 * 27.5% is 2750 and 0.05% is 5; no rate is ever a float.
 */
export type BasisPoints = number;

export const BASIS_POINTS_PER_UNIT = 10_000;

/** Where a row's figures come from, and whether anyone has checked them against the primary text. */
export interface StatutoryProvenance {
  readonly source: string;
  readonly verified: boolean;
}

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

export interface IncomeTaxTable extends StatutoryProvenance {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  /** الإعفاء الشخصي السنوي — deducted from annual taxable income before the brackets. */
  readonly annualPersonalExemption: string;
  /** The personal exemption for an employee with a disability, as a multiple of the ordinary one: 15000 bp = ×1.5. */
  readonly disabilityExemptionMultiplierBp: BasisPoints;
  readonly brackets: readonly IncomeTaxBracket[];
  readonly eliminationTiers: readonly BracketEliminationTier[];
}

export const EGYPT_INCOME_TAX_TABLES: readonly IncomeTaxTable[] = [
  {
    code: "EG_SALARY_TAX_2024",
    effectiveFrom: "2024-03-01",
    effectiveTo: null,
    citationAr: "قانون الضريبة على الدخل 91 لسنة 2005 وتعديلاته بالقانون 7 لسنة 2024 — الشرائح، والإعفاء الشخصي 20,000 جنيه، ويُزاد بنسبة 50% لذوي الإعاقة",
    source: "Law 91/2005 as amended by Law 7/2024",
    verified: false,
    annualPersonalExemption: "20000",
    disabilityExemptionMultiplierBp: 15_000,
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

export interface SocialInsuranceTable extends StatutoryProvenance {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  /** الحد الأدنى للأجر التأميني الشهري; null = not yet published, so a run must refuse until an admin enters it. */
  readonly monthlyWageFloor: string | null;
  /** الحد الأقصى للأجر التأميني الشهري; null = not yet published. */
  readonly monthlyWageCeiling: string | null;
  /** The shares are part of the dated row because the law moves them on a schedule (Art. 19). */
  readonly employeeShares: readonly ContributionShare[];
  readonly employerShares: readonly ContributionShare[];
}

function employeeShares(pensionBp: BasisPoints): readonly ContributionShare[] {
  return [
    { code: "pension", labelAr: "الشيخوخة والعجز والوفاة", rateBp: pensionBp },
    { code: "end_of_service", labelAr: "مكافأة نهاية الخدمة", rateBp: 100 },
    { code: "sickness", labelAr: "المرض", rateBp: 100 },
  ];
}

function employerShares(pensionBp: BasisPoints): readonly ContributionShare[] {
  return [
    { code: "pension", labelAr: "الشيخوخة والعجز والوفاة", rateBp: pensionBp },
    { code: "end_of_service", labelAr: "مكافأة نهاية الخدمة", rateBp: 100 },
    { code: "sickness", labelAr: "المرض", rateBp: 325 },
    { code: "unemployment", labelAr: "التعطل", rateBp: 100 },
    { code: "work_injury", labelAr: "إصابة العمل", rateBp: 150 },
  ];
}

export const EGYPT_SOCIAL_INSURANCE_TABLES: readonly SocialInsuranceTable[] = [
  {
    code: "EG_SOCIAL_INSURANCE_2024",
    effectiveFrom: "2024-01-01",
    effectiveTo: "2024-12-31",
    citationAr: "قانون التأمينات الاجتماعية والمعاشات 148 لسنة 2019 — حدود الأجر التأميني لعام 2024",
    source: "Law 148/2019; 2024 insurable-wage limits",
    verified: false,
    monthlyWageFloor: "2000",
    monthlyWageCeiling: "12600",
    employeeShares: employeeShares(900),
    employerShares: employerShares(1200),
  },
  {
    code: "EG_SOCIAL_INSURANCE_2025",
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-12-31",
    citationAr: "قانون التأمينات الاجتماعية والمعاشات 148 لسنة 2019 — حدود الأجر التأميني لعام 2025",
    source: "Law 148/2019; 2025 insurable-wage limits",
    verified: false,
    monthlyWageFloor: "2300",
    monthlyWageCeiling: "14500",
    employeeShares: employeeShares(900),
    employerShares: employerShares(1200),
  },
  {
    code: "EG_SOCIAL_INSURANCE_2026",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    citationAr: "قانون التأمينات الاجتماعية والمعاشات 148 لسنة 2019 — حدود الأجر التأميني لعام 2026 (الحد الأدنى 2,700 والحد الأقصى 16,700)",
    source: "Law 148/2019; 2026 insurable-wage limits",
    verified: false,
    monthlyWageFloor: "2700",
    monthlyWageCeiling: "16700",
    employeeShares: employeeShares(900),
    employerShares: employerShares(1200),
  },
  {
    // The old-age share steps up under the law's own schedule. The 2027 floor
    // and ceiling have not been published, so they are absent rather than
    // extrapolated: a 2027 run refuses until an admin enters them.
    code: "EG_SOCIAL_INSURANCE_2027",
    effectiveFrom: "2027-01-01",
    effectiveTo: null,
    citationAr: "قانون التأمينات الاجتماعية والمعاشات 148 لسنة 2019، المادة 19 — رفع اشتراك الشيخوخة والعجز والوفاة إلى 12.5% على صاحب العمل و9.5% على المؤمن عليه",
    source: "Law 148/2019 Art. 19",
    verified: false,
    monthlyWageFloor: null,
    monthlyWageCeiling: null,
    employeeShares: employeeShares(950),
    employerShares: employerShares(1250),
  },
] as const;

// --- Payroll levies (الرسوم والاقتطاعات) -----------------------------------

export type LevyBase = "gross" | "insurable";
export type LevySide = "employee" | "employer";
export type LevyPayBasis = "monthly" | "hourly" | "daily";

export interface PayrollLevy {
  readonly code: string;
  readonly labelAr: string;
  readonly rateBp: BasisPoints;
  readonly base: LevyBase;
  readonly side: LevySide;
  /** Pay bases the law excludes from the levy. */
  readonly exemptPayBases: readonly LevyPayBasis[];
}

export interface PayrollLevyTable extends StatutoryProvenance {
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
    citationAr:
      "صندوق تكريم شهداء وضحايا ومفقودي ومصابي العمليات الحربية والإرهابية والأمنية — القانون 16 لسنة 2018 المعدل بالقانون 4 لسنة 2021: 0.05% من إجمالي الأجر الشهري، ولا يسري على العمالة اليومية غير المنتظمة",
    source: "Law 16/2018 as amended by Law 4/2021",
    verified: false,
    levies: [{ code: "martyrs_fund", labelAr: "صندوق تكريم الشهداء", rateBp: 5, base: "gross", side: "employee", exemptPayBases: ["daily"] }],
  },
] as const;

// --- Overtime (الأجر الإضافي) ----------------------------------------------

export interface OvertimeTable extends StatutoryProvenance {
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
    source: "Labour Law 12/2003",
    verified: false,
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
    source: "Labour Law 14/2025",
    verified: false,
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

export interface EndOfServiceTable extends StatutoryProvenance {
  readonly code: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly citationAr: string;
  readonly tiers: readonly EndOfServiceTier[];
  /**
   * The gratuity is payable only to an employee who has reached this age AND
   * holds no pension entitlement covering the service — otherwise the pension
   * is what compensates the service, and paying both double-counts it.
   */
  readonly minimumAge: number;
  /** الحد الأدنى للعلاوة الدورية السنوية — 3% of the insurable wage under Law 14/2025. */
  readonly minimumAnnualRaiseBp: BasisPoints;
}

export const EGYPT_END_OF_SERVICE_TABLES: readonly EndOfServiceTable[] = [
  {
    code: "EG_END_OF_SERVICE_14_2025",
    effectiveFrom: "2025-09-01",
    effectiveTo: null,
    citationAr:
      "قانون العمل 14 لسنة 2025 — نصف شهر عن كل سنة من السنوات الخمس الأولى، وشهر كامل عن كل سنة تالية؛ وتُستحق لمن بلغ الستين ولا يستحق معاشاً عن مدة الخدمة",
    source: "Labour Law 14/2025",
    verified: false,
    tiers: [
      { throughYears: 5, monthsPerYear: "0.5" },
      { throughYears: null, monthsPerYear: "1" },
    ],
    minimumAge: 60,
    minimumAnnualRaiseBp: 300,
  },
] as const;

// --- Resolution -------------------------------------------------------------

/**
 * A year's insurance limits entered by an admin from the published decree.
 *
 * Only the floor and the ceiling move annually, so this is the ONE thing a
 * tenant can add without an application update. The shares are NOT taken from
 * the admin: they come from the shipped row in force on 1 January of that year,
 * so a year after a scheduled rate step is computed at the stepped rate.
 */
export interface SocialInsuranceYearOverride {
  readonly year: number;
  readonly monthlyWageFloor: string;
  readonly monthlyWageCeiling: string;
  readonly note: string | null;
  readonly enteredBy: string;
  readonly enteredAt: string;
}

export interface StatutoryOverrideRepository {
  list(): Promise<SocialInsuranceYearOverride[]>;
  findByYear(year: number): Promise<SocialInsuranceYearOverride | null>;
  upsert(override: SocialInsuranceYearOverride): Promise<void>;
  remove(year: number): Promise<void>;
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

/** The latest shipped row that took effect on or before `onDate`, whatever its end date. */
function preceding<T extends DatedTable>(tables: readonly T[], onDate: string): T | null {
  const earlier = tables.filter((t) => t.effectiveFrom <= onDate);
  return [...earlier].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0))[0] ?? null;
}

/**
 * Turns an admin-entered year into a table row the resolver can use. The shares
 * come from the shipped row preceding the year; null when no shipped row does.
 */
export function overrideToSocialInsuranceTable(
  override: SocialInsuranceYearOverride,
  shipped: readonly SocialInsuranceTable[] = EGYPT_SOCIAL_INSURANCE_TABLES,
): SocialInsuranceTable | null {
  const basis = preceding(shipped, `${override.year}-01-01`);
  if (!basis) return null;
  return {
    code: `EG_SOCIAL_INSURANCE_${override.year}_OVERRIDE`,
    effectiveFrom: `${override.year}-01-01`,
    effectiveTo: `${override.year}-12-31`,
    citationAr: `${basis.citationAr} — حدود الأجر التأميني لعام ${override.year} مُدخلة يدوياً${override.note ? ` (${override.note})` : ""}`,
    source: `${basis.source}; ${override.year} limits entered by ${override.enteredBy}`,
    verified: false,
    monthlyWageFloor: override.monthlyWageFloor,
    monthlyWageCeiling: override.monthlyWageCeiling,
    employeeShares: basis.employeeShares,
    employerShares: basis.employerShares,
  };
}

/** A social-insurance row whose floor and ceiling are both known. */
export type ResolvedSocialInsuranceTable = SocialInsuranceTable & { readonly monthlyWageFloor: string; readonly monthlyWageCeiling: string };

export interface EgyptStatutoryRules {
  readonly onDate: string;
  readonly incomeTax: IncomeTaxTable;
  readonly socialInsurance: ResolvedSocialInsuranceTable;
  readonly levies: PayrollLevyTable;
  readonly overtime: OvertimeTable;
  readonly endOfService: EndOfServiceTable;
}

function hasLimits(table: SocialInsuranceTable | null): table is ResolvedSocialInsuranceTable {
  return table !== null && table.monthlyWageFloor !== null && table.monthlyWageCeiling !== null;
}

/**
 * The statutory rules in force on a date.
 *
 * Throws rather than falling back when any table has no row covering the date,
 * or when the insurance row in force has no published limits: a payroll run
 * computed on a superseded ceiling is a wrong net that looks right. The error
 * names every missing table so an admin knows exactly what to add.
 */
export function resolveEgyptStatutoryRules(onDate: string, overrides: readonly SocialInsuranceYearOverride[] = []): EgyptStatutoryRules {
  const incomeTax = inForce(EGYPT_INCOME_TAX_TABLES, onDate);
  const overrideTables = overrides
    .map((o) => overrideToSocialInsuranceTable(o))
    .filter((t): t is SocialInsuranceTable => t !== null);
  const socialInsurance = inForce(overrideTables, onDate) ?? inForce(EGYPT_SOCIAL_INSURANCE_TABLES, onDate);
  const levies = inForce(EGYPT_PAYROLL_LEVY_TABLES, onDate);
  const overtime = inForce(EGYPT_OVERTIME_TABLES, onDate);
  const endOfService = inForce(EGYPT_END_OF_SERVICE_TABLES, onDate);

  const missing: string[] = [];
  if (!incomeTax) missing.push("شرائح ضريبة كسب العمل");
  if (!hasLimits(socialInsurance)) missing.push(`حدود الأجر التأميني لسنة ${onDate.slice(0, 4)}`);
  if (!levies) missing.push("الرسوم المستقطعة من الأجر");
  if (!overtime) missing.push("معاملات الأجر الإضافي");
  if (!endOfService) missing.push("قواعد مكافأة نهاية الخدمة");
  if (missing.length > 0 || !incomeTax || !hasLimits(socialInsurance) || !levies || !overtime || !endOfService) {
    throw new StatutoryRulesUnavailableError(onDate, missing);
  }

  return { onDate, incomeTax, socialInsurance, levies, overtime, endOfService };
}

/** The end-of-service row in force on a date; a settlement needs only this one. */
export function resolveEndOfServiceTable(onDate: string): EndOfServiceTable {
  const table = inForce(EGYPT_END_OF_SERVICE_TABLES, onDate);
  if (!table) throw new StatutoryRulesUnavailableError(onDate, ["قواعد مكافأة نهاية الخدمة"]);
  return table;
}

/** Every statutory table, for the screen that lists what the tenant is computing against. */
export function listEgyptStatutoryTables(overrides: readonly SocialInsuranceYearOverride[] = []): {
  readonly incomeTax: readonly IncomeTaxTable[];
  readonly socialInsurance: readonly SocialInsuranceTable[];
  readonly levies: readonly PayrollLevyTable[];
  readonly overtime: readonly OvertimeTable[];
  readonly endOfService: readonly EndOfServiceTable[];
} {
  return {
    incomeTax: EGYPT_INCOME_TAX_TABLES,
    socialInsurance: [
      ...EGYPT_SOCIAL_INSURANCE_TABLES,
      ...overrides.map((o) => overrideToSocialInsuranceTable(o)).filter((t): t is SocialInsuranceTable => t !== null),
    ],
    levies: EGYPT_PAYROLL_LEVY_TABLES,
    overtime: EGYPT_OVERTIME_TABLES,
    endOfService: EGYPT_END_OF_SERVICE_TABLES,
  };
}

/** Codes of every row — shipped or admin-entered — that has not been checked against the primary text. */
export function unverifiedStatutoryTableCodes(overrides: readonly SocialInsuranceYearOverride[] = []): readonly string[] {
  const tables = listEgyptStatutoryTables(overrides);
  return [...tables.incomeTax, ...tables.socialInsurance, ...tables.levies, ...tables.overtime, ...tables.endOfService]
    .filter((t) => !t.verified)
    .map((t) => t.code);
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
