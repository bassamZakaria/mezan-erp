import { Money, roundMoney } from "../money/index.js";
import {
  BASIS_POINTS_PER_UNIT,
  tableAmount,
  totalShareBp,
  type BasisPoints,
  type ContributionShare,
  type EndOfServiceTable,
  type IncomeTaxTable,
  type OvertimeTable,
  type PayrollLevyTable,
  type SocialInsuranceTable,
} from "./egypt-statutory.js";

/**
 * The statutory calculators. Pure functions over the dated tables in
 * `egypt-statutory.ts` — no repository, no clock, no settings. Every one takes
 * the table it computes against as an argument, so a run for March 2025
 * computes on the March 2025 rules and nothing here has to know what today is.
 *
 * ROUNDING. Statutory amounts are filed and paid to the piastre, so each one
 * rounds HALF_UP to 2 decimals at the `PAYROLL_STATUTORY` boundary and nowhere
 * else: the bracket walk and the contribution split accumulate at full scale
 * and round once, at the end, so a sum of parts never drifts from the whole.
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
export function insurableWage(contractualWage: Money, table: SocialInsuranceTable): { wage: Money; cappedByCeiling: boolean; raisedToFloor: boolean } {
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

export function socialInsuranceFor(contractualWage: Money, table: SocialInsuranceTable): SocialInsuranceResult {
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
  const exemption = tableAmount(table.annualPersonalExemption).scaled;
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

export function payrollLevies(gross: Money, insurable: Money, table: PayrollLevyTable): readonly LevyLine[] {
  return table.levies
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

export type OvertimeKind = "day" | "night" | "rest_day";

export interface OvertimeHours {
  readonly day: number;
  readonly night: number;
  readonly restDay: number;
}

export const NO_OVERTIME_HOURS: OvertimeHours = { day: 0, night: 0, restDay: 0 };

export interface OvertimeLine {
  readonly kind: OvertimeKind;
  readonly labelAr: string;
  readonly hours: number;
  readonly premiumBp: BasisPoints;
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
  rest_day: "أجر إضافي في يوم الراحة",
};

/** Overtime pay per kind: hours × hourly rate × (100% + the kind's statutory premium). */
export function overtimePay(rate: Money, hours: OvertimeHours, table: OvertimeTable): readonly OvertimeLine[] {
  const entries: readonly { kind: OvertimeKind; hours: number; premiumBp: BasisPoints }[] = [
    { kind: "day", hours: hours.day, premiumBp: table.dayPremiumBp },
    { kind: "night", hours: hours.night, premiumBp: table.nightPremiumBp },
    { kind: "rest_day", hours: hours.restDay, premiumBp: table.restDayPremiumBp },
  ];
  return entries
    .filter((e) => e.hours > 0)
    .map((e) => {
      const hourUnits = BigInt(Math.round(e.hours * 1000));
      const base = (rate.scaled * hourUnits) / 1000n;
      const withPremium = base + divRoundHalfUp(base * BigInt(e.premiumBp), BP);
      return {
        kind: e.kind,
        labelAr: `${OVERTIME_LABELS[e.kind]} (${formatHours(e.hours)} ساعة)`,
        hours: e.hours,
        premiumBp: e.premiumBp,
        amount: roundMoney(Money.fromScaled(withPremium), STATUTORY_DECIMALS, "HALF_UP"),
      };
    });
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/\.?0+$/, "");
}

/** Which statutory premium a worked hour attracts, from the clock time it was worked at. */
export function overtimeKindForHour(hourOfDay: number, isRestDay: boolean, table: OvertimeTable): OvertimeKind {
  if (isRestDay) return "rest_day";
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
}

/**
 * مكافأة نهاية الخدمة. Service years include `priorServiceYears` carried from a
 * previous employer where the contract recognises them; partial years count pro
 * rata on completed months, never rounded up to a whole year.
 */
export function endOfServiceGratuity(monthlyWage: Money, serviceYears: number, table: EndOfServiceTable): EndOfServiceResult {
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
