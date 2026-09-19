import { Money, roundMoney } from "../money/index.js";
import {
  BASIS_POINTS_PER_UNIT,
  tableAmount,
  totalShareBp,
  type BasisPoints,
  type ContributionShare,
  type EndOfServiceTable,
  type IncomeTaxTable,
  type LevyPayBasis,
  type OvertimeTable,
  type PayrollLevyTable,
  type ResolvedSocialInsuranceTable,
} from "./egypt-statutory.js";
import type { PeriodOvertimeHours } from "./payroll-run.js";

/**
 * The statutory calculators. Pure functions over the dated tables in
 * `egypt-statutory.ts` — no repository, no clock, no settings. Every one takes
 * the table it computes against as an argument, so a run for March 2025
 * computes on the March 2025 rules and nothing here has to know what today is.
 *
 * ROUNDING. Statutory amounts are filed and paid to the piastre, so each one
 * rounds HALF_UP to 2 decimals once, at the end, as a tax computation
 * (the TAX_COMPUTATION boundary): the bracket walk and the contribution split
 * accumulate at full scale, so a sum of parts never drifts from the whole.
 */

/** Piastres. Statutory figures are filed at two decimals. */
const STATUTORY_DECIMALS = 2;

const BP = BigInt(BASIS_POINTS_PER_UNIT);

/** `amount × rateBp`, exact, still at full scale — round at the call site's boundary. */
function timesRateExact(amount: Money, rateBp: BasisPoints): bigint {
  return amount.scaled * BigInt(rateBp);
}

/** Divides an exact `scaled × bp` product back to a Money, rounding HALF_UP to the piastre. */
function fromRateProduct(product: bigint): Money {
  return roundMoney(Money.fromScaled(divRoundHalfUp(product, BP)), STATUTORY_DECIMALS, "HALF_UP");
}

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function minScaled(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function maxScaled(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** A percentage of an amount, rounded to the piastre. */
export function applyRateBp(amount: Money, rateBp: BasisPoints): Money {
  return fromRateProduct(timesRateExact(amount, rateBp));
}

// --- Social insurance -------------------------------------------------------

export interface ContributionLine {
  readonly code: string;
  readonly labelAr: string;
  readonly rateBp: BasisPoints;
  readonly amount: Money;
}

export interface SocialInsuranceResult {
  /** The wage the contribution was actually computed on, after floor and ceiling. */
  readonly insurableWage: Money;
  /** True when the ceiling bound the wage — the payslip says so rather than showing a silently smaller figure. */
  readonly cappedByCeiling: boolean;
  readonly raisedToFloor: boolean;
  readonly employeeTotal: Money;
  readonly employerTotal: Money;
  readonly employeeShares: readonly ContributionLine[];
  readonly employerShares: readonly ContributionLine[];
}

/**
 * الأجر التأميني — the contractual insurable wage clamped between the year's
 * floor and ceiling. This is NOT gross pay: allowances above the ceiling carry
 * no contribution, which is the single most common payroll arithmetic error.
 */
export function insurableWage(contractualWage: Money, table: ResolvedSocialInsuranceTable): { wage: Money; cappedByCeiling: boolean; raisedToFloor: boolean } {
  const floor = tableAmount(table.monthlyWageFloor);
  const ceiling = tableAmount(table.monthlyWageCeiling);
  if (contractualWage.scaled > ceiling.scaled) return { wage: ceiling, cappedByCeiling: true, raisedToFloor: false };
  if (contractualWage.scaled < floor.scaled) return { wage: floor, cappedByCeiling: false, raisedToFloor: true };
  return { wage: contractualWage, cappedByCeiling: false, raisedToFloor: false };
}

/**
 * Splits a contribution across its named sub-funds so the parts sum EXACTLY to
 * the total: each sub-fund is rounded to the piastre, and the residue from
 * rounding lands on the largest share (deterministic, largest-first then lowest
 * index). The employee is never charged a piastre the sub-funds do not account for.
 */
function splitShares(wage: Money, shares: readonly ContributionShare[]): { total: Money; lines: readonly ContributionLine[] } {
  const total = applyRateBp(wage, totalShareBp(shares));
  const lines = shares.map((share) => ({
    code: share.code,
    labelAr: share.labelAr,
    rateBp: share.rateBp,
    amount: applyRateBp(wage, share.rateBp),
  }));
  const summed = Money.sum(lines.map((l) => l.amount));
  const residue = total.scaled - summed.scaled;
  if (residue === 0n || lines.length === 0) return { total, lines };
  let targetIndex = 0;
  for (let i = 1; i < shares.length; i++) {
    if ((shares[i]?.rateBp ?? 0) > (shares[targetIndex]?.rateBp ?? 0)) targetIndex = i;
  }
  const adjusted = lines.map((line, i) => (i === targetIndex ? { ...line, amount: Money.fromScaled(line.amount.scaled + residue) } : line));
  return { total, lines: adjusted };
}

export function socialInsuranceFor(contractualWage: Money, table: ResolvedSocialInsuranceTable): SocialInsuranceResult {
  const { wage, cappedByCeiling, raisedToFloor } = insurableWage(contractualWage, table);
  const employee = splitShares(wage, table.employeeShares);
  const employer = splitShares(wage, table.employerShares);
  return {
    insurableWage: wage,
    cappedByCeiling,
    raisedToFloor,
    employeeTotal: employee.total,
    employerTotal: employer.total,
    employeeShares: employee.lines,
    employerShares: employer.lines,
  };
}

// --- Income tax -------------------------------------------------------------

export interface IncomeTaxResult {
  /** Annual taxable income the brackets were walked on: annualised gross − insurance − personal exemption. */
  readonly annualTaxableIncome: Money;
  readonly annualTax: Money;
  readonly monthlyTax: Money;
  /** How many of the lowest bands the elimination tiers folded upward, 0 for most employees. */
  readonly eliminatedBrackets: number;
  readonly effectiveRateBp: BasisPoints;
}

/**
 * Walks the annual brackets.
 *
 * ASSUMPTION, stated once here so an accountant can move it in one place: the
 * elimination tier is selected on the SAME figure the brackets are walked on —
 * annual income after the social-insurance deduction and after the personal
 * exemption. The tiers only bite above EGP 600,000 a year, so this choice is
 * invisible to the overwhelming majority of Egyptian payslips, but it is a
 * choice and not a derivation.
 */
export function annualIncomeTax(annualTaxable: Money, table: IncomeTaxTable): { tax: Money; eliminatedBrackets: number } {
  if (annualTaxable.scaled <= 0n) return { tax: Money.zero(), eliminatedBrackets: 0 };

  const tier = table.eliminationTiers.find(
    (t) => annualTaxable.scaled > tableAmount(t.aboveAnnual).scaled && (t.upToAnnual === null || annualTaxable.scaled <= tableAmount(t.upToAnnual).scaled),
  );
  const drop = Math.min(tier?.dropsLowestBrackets ?? 0, Math.max(table.brackets.length - 1, 0));
  const survivingRateBp = table.brackets[drop]?.rateBp ?? 0;

  let product = 0n;
  let lower = 0n;
  for (let i = 0; i < table.brackets.length; i++) {
    const bracket = table.brackets[i];
    if (!bracket) break;
    const upper = bracket.upToAnnual === null ? null : tableAmount(bracket.upToAnnual).scaled;
    const bandTop = upper === null ? annualTaxable.scaled : minScaled(annualTaxable.scaled, upper);
    const inBand = maxScaled(bandTop - lower, 0n);
    if (inBand > 0n) product += inBand * BigInt(i < drop ? survivingRateBp : bracket.rateBp);
    if (upper === null || annualTaxable.scaled <= upper) break;
    lower = upper;
  }
  return { tax: fromRateProduct(product), eliminatedBrackets: drop };
}

export interface MonthlyIncomeTaxInput {
  /** Gross earnings for the month that are subject to salary tax. */
  readonly monthlyTaxableGross: Money;
  /** The employee's own social-insurance contribution for the month — deductible before tax. */
  readonly monthlyEmployeeInsurance: Money;
  /** Months the annualisation spans; 12 for a normal monthly payroll. */
  readonly monthsPerYear?: number;
  /** The employee qualifies for the raised personal exemption of a person with a disability. */
  readonly disabilityExemption?: boolean;
}

/**
 * Egyptian salary tax is assessed annually and withheld monthly: the month's
 * taxable pay is annualised, the personal exemption and the year's brackets are
 * applied to that annual figure, and the result is divided back down. Computing
 * the brackets on one month's pay directly would put every employee in the 0%
 * band and withhold nothing.
 */
export function monthlyIncomeTax(input: MonthlyIncomeTaxInput, table: IncomeTaxTable): IncomeTaxResult {
  const months = BigInt(input.monthsPerYear ?? 12);
  const monthlyNet = input.monthlyTaxableGross.scaled - input.monthlyEmployeeInsurance.scaled;
  const annualised = maxScaled(monthlyNet, 0n) * months;
  const ordinary = tableAmount(table.annualPersonalExemption).scaled;
  const exemption = input.disabilityExemption ? divRoundHalfUp(ordinary * BigInt(table.disabilityExemptionMultiplierBp), BP) : ordinary;
  const annualTaxable = Money.fromScaled(maxScaled(annualised - exemption, 0n));

  const { tax, eliminatedBrackets } = annualIncomeTax(annualTaxable, table);
  const monthlyTax = roundMoney(Money.fromScaled(divRoundHalfUp(tax.scaled, months)), STATUTORY_DECIMALS, "HALF_UP");
  const effectiveRateBp =
    annualised === 0n ? 0 : Number(divRoundHalfUp(tax.scaled * BP, annualised));

  return { annualTaxableIncome: annualTaxable, annualTax: tax, monthlyTax, eliminatedBrackets, effectiveRateBp };
}

// --- Levies -----------------------------------------------------------------

export interface LevyLine {
  readonly code: string;
  readonly labelAr: string;
  readonly rateBp: BasisPoints;
  readonly side: "employee" | "employer";
  readonly amount: Money;
}

export function payrollLevies(gross: Money, insurable: Money, table: PayrollLevyTable, payBasis: LevyPayBasis = "monthly"): readonly LevyLine[] {
  return table.levies
    .filter((levy) => !levy.exemptPayBases.includes(payBasis))
    .map((levy) => ({
      code: levy.code,
      labelAr: levy.labelAr,
      rateBp: levy.rateBp,
      side: levy.side,
      amount: applyRateBp(levy.base === "gross" ? gross : insurable, levy.rateBp),
    }))
    .filter((line) => line.amount.scaled !== 0n);
}

// --- Overtime ---------------------------------------------------------------

export type OvertimeKind = "day" | "night" | "rest_day" | "holiday";

export interface OvertimeLine {
  readonly kind: OvertimeKind;
  readonly labelAr: string;
  /** Hours for day/night overtime; whole days for a rest day or a holiday. */
  readonly quantity: number;
  /** The dated overtime row the line was priced by. */
  readonly tableCode: string;
  readonly amount: Money;
}

/**
 * The normal hourly rate. `dayDivisor` is the tenant's payroll day basis — 30
 * for the conventional FIXED_30, or the period's real calendar days — and is
 * passed in rather than assumed, because the two give different answers in
 * February and both are defensible.
 */
export function hourlyRate(monthlySalary: Money, dayDivisor: number, dailyHours: number): Money {
  if (dayDivisor <= 0 || dailyHours <= 0) return Money.zero();
  const denominator = BigInt(Math.round(dayDivisor * dailyHours * 1000));
  return Money.fromScaled(divRoundHalfUp(monthlySalary.scaled * 1000n, denominator));
}

const OVERTIME_LABELS: Record<OvertimeKind, string> = {
  day: "أجر إضافي نهاري",
  night: "أجر إضافي ليلي",
  rest_day: "تعويض العمل في يوم الراحة الأسبوعية",
  holiday: "تعويض العمل في عطلة رسمية",
};

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

export interface OvertimePayInput {
  readonly monthlyWage: Money;
  /** The payroll day basis — the same divisor the hourly rate and unpaid leave use. */
  readonly dayDivisor: number;
  /** The employee's standard day; the hourly rate is the day's wage over it. */
  readonly standardDailyHours: number;
}

/**
 * Overtime pay, one line per kind per dated table:
 *
 *   - day / night: hours × hourly rate × (100% + the table's premium);
 *   - rest day / holiday: days × the day's wage × the table's extra-day
 *     multiple — the day's own pay is already inside the monthly wage.
 */
export function overtimePay(input: OvertimePayInput, worked: Pick<PeriodOvertimeHours, "byTable">): readonly OvertimeLine[] {
  const rate = hourlyRate(input.monthlyWage, input.dayDivisor, input.standardDailyHours);
  const lines: OvertimeLine[] = [];
  for (const { table, day, night, restDays, holidays } of worked.byTable) {
    for (const [kind, hours, premiumBp] of [
      ["day", day, table.dayPremiumBp],
      ["night", night, table.nightPremiumBp],
    ] as const) {
      if (hours <= 0) continue;
      const base = (rate.scaled * BigInt(Math.round(hours * 1000))) / 1000n;
      const withPremium = base + divRoundHalfUp(base * BigInt(premiumBp), BP);
      lines.push({
        kind,
        labelAr: `${OVERTIME_LABELS[kind]} (${formatQuantity(hours)} ساعة، +${formatPercentBp(premiumBp)}%)`,
        quantity: hours,
        tableCode: table.code,
        amount: roundMoney(Money.fromScaled(withPremium), STATUTORY_DECIMALS, "HALF_UP"),
      });
    }
    for (const [kind, days, multipleBp] of [
      ["rest_day", restDays, table.restDayExtraDayWageBp],
      ["holiday", holidays, table.holidayExtraDayWageBp],
    ] as const) {
      if (days <= 0 || input.dayDivisor <= 0) continue;
      const amount = divRoundHalfUp(input.monthlyWage.scaled * BigInt(days) * BigInt(multipleBp), BigInt(Math.round(input.dayDivisor)) * BP);
      lines.push({
        kind,
        labelAr: `${OVERTIME_LABELS[kind]} (${formatQuantity(days)} يوم × ${formatQuantity(multipleBp / BASIS_POINTS_PER_UNIT)} أجر يوم)`,
        quantity: days,
        tableCode: table.code,
        amount: roundMoney(Money.fromScaled(amount), STATUTORY_DECIMALS, "HALF_UP"),
      });
    }
  }
  return lines;
}

function formatPercentBp(bp: BasisPoints): string {
  return formatQuantity(bp / 100);
}

/** Whether an hour of overtime on a working day is day or night work, from the clock time it was worked at. */
export function overtimeKindForHour(hourOfDay: number, table: OvertimeTable): "day" | "night" {
  const night = table.nightStartHour > table.nightEndHour ? hourOfDay >= table.nightStartHour || hourOfDay < table.nightEndHour : hourOfDay >= table.nightStartHour && hourOfDay < table.nightEndHour;
  return night ? "night" : "day";
}

// --- End of service ---------------------------------------------------------

export interface EndOfServiceResult {
  readonly serviceYears: number;
  readonly monthsEarned: string;
  readonly monthlyWage: Money;
  readonly gratuity: Money;
  readonly tierBreakdown: readonly { readonly labelAr: string; readonly years: number; readonly monthsPerYear: string; readonly amount: Money }[];
  readonly eligible: boolean;
  /** Why the gratuity is zero, in Arabic, when it is not payable; null when it is. */
  readonly ineligibleReasonAr: string | null;
}

export interface EndOfServiceEligibilityInput {
  /** "YYYY-MM-DD"; null when the register does not hold it. */
  readonly birthDate: string | null;
  /** The day the service ends, "YYYY-MM-DD". */
  readonly onDate: string;
  /** Null = never recorded on the employee, which blocks the gratuity rather than assuming either answer. */
  readonly hasPensionEntitlement: boolean | null;
}

/** Completed years of age on a date; null when the birth date is unknown or malformed. */
export function ageOn(birthDate: string | null, onDate: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return null;
  const [by, bm, bd] = birthDate.split("-").map((n) => Number.parseInt(n, 10)) as [number, number, number];
  const [oy, om, od] = onDate.split("-").map((n) => Number.parseInt(n, 10)) as [number, number, number];
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

/**
 * The gratuity is payable ONLY to an employee who has reached the table's
 * minimum age and holds no pension entitlement covering the service; anyone
 * else is compensated by the pension, and paying both double-counts it.
 */
export function endOfServiceEligibility(input: EndOfServiceEligibilityInput, table: EndOfServiceTable): { eligible: boolean; reasonAr: string | null } {
  if (input.hasPensionEntitlement === null) {
    return { eligible: false, reasonAr: "لا تُحتسب المكافأة: لم يُسجَّل على الموظف ما إذا كان يستحق معاشاً عن مدة الخدمة." };
  }
  if (input.hasPensionEntitlement) {
    return { eligible: false, reasonAr: "لا تُستحق المكافأة: الموظف يستحق معاشاً عن مدة الخدمة." };
  }
  const age = ageOn(input.birthDate, input.onDate);
  if (age === null) {
    return { eligible: false, reasonAr: "لا تُحتسب المكافأة: تاريخ ميلاد الموظف غير مسجّل، فلا يمكن التحقق من بلوغ السن." };
  }
  if (age < table.minimumAge) {
    return { eligible: false, reasonAr: `لا تُستحق المكافأة: سن الموظف ${age} سنة، وتُستحق عند بلوغ ${table.minimumAge} سنة.` };
  }
  return { eligible: true, reasonAr: null };
}

/**
 * مكافأة نهاية الخدمة. Service years include `priorServiceYears` carried from a
 * previous employer where the contract recognises them; partial years count pro
 * rata on completed months, never rounded up to a whole year.
 */
export function endOfServiceGratuity(
  monthlyWage: Money,
  serviceYears: number,
  table: EndOfServiceTable,
  eligibility: EndOfServiceEligibilityInput,
): EndOfServiceResult {
  const verdict = endOfServiceEligibility(eligibility, table);
  if (!verdict.eligible) {
    return {
      serviceYears,
      monthsEarned: "0",
      monthlyWage,
      gratuity: Money.zero(),
      tierBreakdown: [],
      eligible: false,
      ineligibleReasonAr: verdict.reasonAr,
    };
  }
  const totalMonthUnits = BigInt(Math.max(Math.round(serviceYears * 1000), 0));
  let remaining = totalMonthUnits;
  let consumed = 0n;
  let gratuityScaled = 0n;
  let monthsEarnedUnits = 0n;
  const breakdown: { labelAr: string; years: number; monthsPerYear: string; amount: Money }[] = [];

  for (const tier of table.tiers) {
    if (remaining <= 0n) break;
    const tierCapUnits = tier.throughYears === null ? remaining : BigInt(Math.round(tier.throughYears * 1000)) - consumed;
    const yearsInTier = tierCapUnits <= 0n ? 0n : minScaled(remaining, tierCapUnits);
    if (yearsInTier <= 0n) continue;
    const monthsPerYearUnits = BigInt(Math.round(Number(tier.monthsPerYear) * 1000));
    const monthsUnits = (yearsInTier * monthsPerYearUnits) / 1000n;
    const amount = Money.fromScaled(divRoundHalfUp(monthlyWage.scaled * monthsUnits, 1000n));
    gratuityScaled += amount.scaled;
    monthsEarnedUnits += monthsUnits;
    breakdown.push({
      labelAr:
        tier.throughYears === null
          ? `ما بعد ${consumed / 1000n} سنة — ${tier.monthsPerYear} شهر عن كل سنة`
          : `حتى ${tier.throughYears} سنوات — ${tier.monthsPerYear} شهر عن كل سنة`,
      years: Number(yearsInTier) / 1000,
      monthsPerYear: tier.monthsPerYear,
      amount,
    });
    remaining -= yearsInTier;
    consumed += yearsInTier;
  }

  return {
    serviceYears,
    monthsEarned: (Number(monthsEarnedUnits) / 1000).toFixed(2).replace(/\.?0+$/, ""),
    monthlyWage,
    gratuity: roundMoney(Money.fromScaled(gratuityScaled), STATUTORY_DECIMALS, "HALF_UP"),
    tierBreakdown: breakdown,
    eligible: true,
    ineligibleReasonAr: null,
  };
}

/** Completed service years between two dates, to three decimal places of a year. */
export function serviceYearsBetween(hireDate: string, endDate: string, priorServiceYears = 0): number {
  const start = Date.parse(`${hireDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return Math.max(priorServiceYears, 0);
  const days = (end - start) / (24 * 60 * 60 * 1000);
  return Math.max(priorServiceYears, 0) + Math.round((days / 365.25) * 1000) / 1000;
}
