import { Money, type Qty } from "../../money/index.js";
import type { VatBasis, WorksContractTerms } from "../contracts/contract.js";
import type {
  CertificateComputation,
  CertificateDeductionKey,
  CertificateDeductionRow,
  CertificateMaterialLine,
  CertificateWorkLine,
} from "./certificate.js";

/**
 * The certificate's arithmetic — all of it, and pure.
 *
 * Everything is computed CUMULATIVELY first and then differenced against the
 * previous certificate's stored cumulative. That ordering is the point: a
 * deduction struck on each period separately drifts by a piastre per
 * certificate and the deduction column stops tying to the cumulative one,
 * which is exactly the argument an employer's finance department will have.
 *
 * Exact scaled integers only. Every percentage is an exact decimal STRING
 * multiplied through bigints and rounded HALF_UP to the currency minor unit at
 * a named boundary (LINE_EXTENSION / TAX_COMPUTATION, docs/archive/plan.md §2.3).
 */

const SCALE = 1_000_000n;
const MINOR_STEP = 10_000n; // 1e-6 → 1e-2
const PERCENT_DIVISOR = 100_000_000n; // 100 × 1e6

/** The general VAT rate construction moved to on 2025-07-18 (Law 157/2025). */
export const EGYPT_VAT_RATE_PERCENT = "14";
/** The transitional basis: 14% is charged on 36% of the value (MoF Decree 418/2025). */
export const VAT_TRANSITIONAL_BASIS_PERCENT = "36";

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function roundMinor(scaled: bigint): bigint {
  return divHalfUp(scaled, MINOR_STEP) * MINOR_STEP;
}

/** An exact decimal percentage as a scaled integer at 1e-6 — never a float. */
export function parsePercent(percent: string | null | undefined): bigint {
  if (percent === null || percent === undefined || percent.trim() === "") return 0n;
  return Money.fromMajor(percent).scaled;
}

/**
 * One percentage OF another, as a scaled percentage: 20% × 18.75% = 3.75%.
 * Both operands are at 1e-6, so the product is at 1e-12 and dividing by
 * 100 × 1e6 lands back on 1e-6.
 */
function multiplyPercents(a: string, b: string): bigint {
  return divHalfUp(parsePercent(a) * parsePercent(b), PERCENT_DIVISOR);
}

/** amount × percent ÷ 100, rounded HALF_UP to the minor unit. `percent` is an exact decimal string. */
export function percentOf(amount: Money, percent: string | null | undefined): Money {
  const pct = parsePercent(percent);
  if (pct === 0n) return Money.zero();
  return Money.fromScaled(roundMinor(divHalfUp(amount.scaled * pct, PERCENT_DIVISOR)));
}

/** qty × unitRate, rounded HALF_UP to the minor unit (LINE_EXTENSION). */
export function extendQty(qty: Qty, unitRate: Money): Money {
  return Money.fromScaled(roundMinor(divHalfUp(qty.scaled * unitRate.scaled, SCALE)));
}

/** a − b as Money, with no intermediate rounding. */
export function subtract(a: Money, b: Money): Money {
  return Money.fromScaled(a.scaled - b.scaled);
}

/** The rate the invoice is actually raised at: 14, or 14 × 36% = 5.04 on the transitional basis. */
export function vatEffectiveRatePercent(basis: VatBasis): string {
  if (basis === "standard") return EGYPT_VAT_RATE_PERCENT;
  return Money.fromScaled(multiplyPercents(EGYPT_VAT_RATE_PERCENT, VAT_TRANSITIONAL_BASIS_PERCENT)).toString();
}

/** A ratio as a percentage with ONE decimal place, exactly: 10,200 / 12,000 → "85.0". */
function ratioPercent(part: bigint, whole: bigint): string {
  if (whole === 0n) return "0.0";
  const tenths = divHalfUp(part * 1_000n, whole); // percent × 10
  const negative = tenths < 0n;
  const abs = negative ? -tenths : tenths;
  return `${negative ? "-" : ""}${abs / 10n}.${abs % 10n}`;
}

/** cumulative ÷ contracted as a percentage, one decimal place, zero-safe. */
export function completionPercentOf(cumulative: Qty, contracted: Qty): string {
  return ratioPercent(cumulative.scaled, contracted.scaled);
}

export interface CertificateDeductionInputs {
  readonly penalties: Money;
  readonly suspended: Money;
  readonly employerMaterials: Money;
  readonly waterElectricity: Money;
}

export interface CertificateComputationInput {
  readonly terms: Pick<
    WorksContractTerms,
    | "tenderDiscountPercent"
    | "retentionPercent"
    | "retentionCapPercent"
    | "advanceRecoveryPercent"
    | "deemedWagePercent"
    | "socialInsuranceRatePercent"
    | "withholdingTaxPercent"
    | "stampDutyPercent"
    | "vatBasis"
  >;
  readonly workLines: readonly CertificateWorkLine[];
  readonly materialLines: readonly CertificateMaterialLine[];
  readonly manual: CertificateDeductionInputs;
  /** The previous certificate's stored block; null for serial 1. */
  readonly previous: CertificateComputation | null;
  readonly contractValueAfterVariations: Money;
  /** Σ credits to the customer-advances account for this project — the recovery ceiling. */
  readonly advanceReceived: Money;
  /** Σ credits − debits on the same account: what is still owed back. */
  readonly advanceOutstanding: Money;
}

const DEDUCTION_LABELS: Readonly<Record<CertificateDeductionKey, string>> = {
  retention: "المحتجزات الضمانية",
  advanceRecovery: "خصم الدفعة المقدمة",
  socialInsurance: "التأمينات الاجتماعية",
  withholdingTax: "ضريبة الخصم والتحصيل",
  penalties: "غرامة التأخير",
  suspended: "التعليات",
  employerMaterials: "استهلاك عهدة المواد",
  waterElectricity: "استهلاك المياه والكهرباء",
  stampDuty: "دمغات ورسوم",
};

function previousOf(previous: CertificateComputation | null, key: CertificateDeductionKey): Money {
  return previous?.deductions.find((d) => d.key === key)?.cumulative ?? Money.zero();
}

function row(
  key: CertificateDeductionKey,
  percent: string | null,
  cumulative: Money,
  previous: CertificateComputation | null,
  posted: boolean,
  capped = false,
): CertificateDeductionRow {
  const prev = previousOf(previous, key);
  return {
    key,
    labelAr: DEDUCTION_LABELS[key],
    percent,
    cumulative,
    previous: prev,
    thisCertificate: subtract(cumulative, prev),
    posted,
    capped,
  };
}

function capAt(value: Money, ceiling: Money | null): { value: Money; capped: boolean } {
  if (ceiling === null || value.scaled <= ceiling.scaled) return { value, capped: false };
  return { value: ceiling, capped: true };
}

/**
 * The whole block. Deductions are struck on the CUMULATIVE net certified value
 * and then differenced, which is why a cap (D-08, forward only) can bite on one
 * certificate and leave every earlier one untouched.
 */
export function computeCertificate(input: CertificateComputationInput): CertificateComputation {
  const { terms, previous } = input;

  const grossWorks = Money.sum(input.workLines.map((l) => l.cumulativeValue));
  const materialsOnSite = Money.sum(input.materialLines.map((l) => l.value));
  const certificateTotal = grossWorks.add(materialsOnSite);
  const tenderDiscount = percentOf(certificateTotal, terms.tenderDiscountPercent);
  const netCertified = subtract(certificateTotal, tenderDiscount);

  const previousNetCertified = previous?.netCertified ?? Money.zero();
  const thisCertificateNetCertified = subtract(netCertified, previousNetCertified);

  const retentionCeiling =
    terms.retentionCapPercent === null
      ? null
      : percentOf(input.contractValueAfterVariations, terms.retentionCapPercent);
  const retention = capAt(percentOf(netCertified, terms.retentionPercent), retentionCeiling);
  const advance = capAt(percentOf(netCertified, terms.advanceRecoveryPercent), input.advanceReceived);
  const socialInsurance = percentOf(
    percentOf(netCertified, terms.deemedWagePercent),
    terms.socialInsuranceRatePercent,
  );
  const withholdingTax = percentOf(netCertified, terms.withholdingTaxPercent);
  const stampDuty = percentOf(netCertified, terms.stampDutyPercent);

  const socialInsuranceEffective = Money.fromScaled(
    multiplyPercents(terms.deemedWagePercent, terms.socialInsuranceRatePercent),
  ).toString();

  const deductions: CertificateDeductionRow[] = [
    row("retention", terms.retentionPercent, retention.value, previous, true, retention.capped),
    row("advanceRecovery", terms.advanceRecoveryPercent, advance.value, previous, true, advance.capped),
    row("socialInsurance", socialInsuranceEffective, socialInsurance, previous, true),
    row("withholdingTax", terms.withholdingTaxPercent, withholdingTax, previous, true),
    row("penalties", null, input.manual.penalties, previous, true),
    row("suspended", null, input.manual.suspended, previous, false),
    row("employerMaterials", null, input.manual.employerMaterials, previous, true),
    row("waterElectricity", null, input.manual.waterElectricity, previous, true),
    row("stampDuty", terms.stampDutyPercent, stampDuty, previous, true),
  ];

  const posted = deductions.filter((d) => d.posted);
  const deductionsThisCertificate = Money.sum(posted.map((d) => d.thisCertificate));
  const deductionsCumulative = Money.sum(posted.map((d) => d.cumulative));

  const suspendedRow = deductions.find((d) => d.key === "suspended");
  const suspendedDelta = suspendedRow?.thisCertificate ?? Money.zero();
  const invoiceBase = subtract(thisCertificateNetCertified, suspendedDelta);

  const effectiveRate = vatEffectiveRatePercent(terms.vatBasis);
  const vat = percentOf(invoiceBase, effectiveRate);

  const previousPayments = previous?.cumulativeNetPayable ?? Money.zero();
  const netPayableThisCertificate = subtract(invoiceBase, deductionsThisCertificate).add(vat);

  return {
    grossWorks,
    materialsOnSite,
    certificateTotal,
    tenderDiscountPercent: terms.tenderDiscountPercent,
    tenderDiscount,
    netCertified,
    previousNetCertified,
    thisCertificateNetCertified,
    deductions,
    deductionsThisCertificate,
    deductionsCumulative,
    suspendedBalance: input.manual.suspended,
    invoiceBase,
    vatBasis: terms.vatBasis,
    vatStatutoryRatePercent: EGYPT_VAT_RATE_PERCENT,
    vatEffectiveRatePercent: effectiveRate,
    vat,
    previousPayments,
    netPayableThisCertificate,
    cumulativeNetPayable: previousPayments.add(netPayableThisCertificate),
    contractValueAfterVariations: input.contractValueAfterVariations,
    completionPercent: completionPercentOfMoney(netCertified, input.contractValueAfterVariations),
    retentionHeldCumulative: retention.value,
    advanceReceived: input.advanceReceived,
    advanceOutstanding: input.advanceOutstanding,
  };
}

/** The same one-decimal ratio as {@link completionPercentOf}, over money rather than quantity. */
export function completionPercentOfMoney(part: Money, whole: Money): string {
  return ratioPercent(part.scaled, whole.scaled);
}

/** An empty block, for a certificate whose lines have not been entered yet. */
export function emptyComputation(
  terms: CertificateComputationInput["terms"],
  contractValueAfterVariations: Money,
): CertificateComputation {
  return computeCertificate({
    terms,
    workLines: [],
    materialLines: [],
    manual: {
      penalties: Money.zero(),
      suspended: Money.zero(),
      employerMaterials: Money.zero(),
      waterElectricity: Money.zero(),
    },
    previous: null,
    contractValueAfterVariations,
    advanceReceived: Money.zero(),
    advanceOutstanding: Money.zero(),
  });
}
