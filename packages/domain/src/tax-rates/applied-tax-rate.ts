import {
  InactiveTaxRateError,
  TaxRateNotFoundError,
  TaxRatePercentMismatchError,
  TaxRateUnverifiableError,
} from "./errors.js";
import { TaxRateStatusCode, type TaxRate } from "./tax-rate.js";

export interface AppliedTaxRate {
  readonly taxRateId: string | null;
  readonly taxRatePercent: number;
}

export interface AppliedTaxRateRequest {
  /**
   * `null` and `undefined` are NOT the same answer. `null` says "this line
   * names no tax rate" and is stored as NULL whatever its percent. `undefined`
   * says nothing, and lets the server infer a rate from the percent.
   */
  readonly taxRateId?: string | null;
  readonly taxRatePercent?: number | null;
}

type RateIdentity = Pick<TaxRate, "id" | "name" | "rate" | "status">;

/**
 * INVARIANT: a rate is never inferred at 0%. Exempt, export and not-subject
 * are all 0% and mean different things to the authority, so a tenant holding
 * only ONE of them would otherwise have every unnamed 0% line — a retention
 * release, a tax-exempt customer's sale — filed under it. A 0% line carries a
 * rate only when the caller named one.
 */
export function inferTaxRateByPercent<T extends Pick<TaxRate, "id" | "rate" | "status">>(
  taxRates: readonly T[],
  taxRatePercent: number,
): T | null {
  if (!(taxRatePercent > 0)) return null;
  const matches = taxRates.filter((r) => r.status === TaxRateStatusCode.Active && r.rate === taxRatePercent);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function requireNamedRate(taxRates: readonly RateIdentity[], taxRateId: string): RateIdentity {
  const rate = taxRates.find((r) => r.id === taxRateId);
  if (!rate) throw new TaxRateNotFoundError(taxRateId);
  if (rate.status !== TaxRateStatusCode.Active) throw new InactiveTaxRateError(rate.id, rate.name);
  return rate;
}

export function resolveAppliedTaxRate(
  taxRates: readonly RateIdentity[],
  request: AppliedTaxRateRequest,
  defaultPercent: number,
): AppliedTaxRate {
  if (typeof request.taxRateId === "string") {
    const rate = requireNamedRate(taxRates, request.taxRateId);
    const claimed = request.taxRatePercent ?? null;
    if (claimed !== null && claimed !== rate.rate) {
      throw new TaxRatePercentMismatchError(rate.id, rate.name, rate.rate, claimed);
    }
    return { taxRateId: rate.id, taxRatePercent: rate.rate };
  }
  const taxRatePercent = request.taxRatePercent ?? defaultPercent;
  if (request.taxRateId === null) return { taxRateId: null, taxRatePercent };
  return { taxRateId: inferTaxRateByPercent(taxRates, taxRatePercent)?.id ?? null, taxRatePercent };
}

export function resolveZeroRatedTaxRate(
  taxRates: readonly RateIdentity[],
  request: AppliedTaxRateRequest,
): AppliedTaxRate {
  if (typeof request.taxRateId === "string") {
    const rate = requireNamedRate(taxRates, request.taxRateId);
    if (rate.rate === 0) return { taxRateId: rate.id, taxRatePercent: 0 };
  }
  return { taxRateId: null, taxRatePercent: 0 };
}

export interface DocumentLineTaxPolicy {
  readonly defaultPercent: number;
  readonly zeroRated: boolean;
}

export function resolveDocumentLineTax(
  taxRates: readonly RateIdentity[] | null,
  request: AppliedTaxRateRequest,
  policy: DocumentLineTaxPolicy,
): AppliedTaxRate {
  if (taxRates === null) {
    if (typeof request.taxRateId === "string") throw new TaxRateUnverifiableError(request.taxRateId);
    return { taxRateId: null, taxRatePercent: policy.zeroRated ? 0 : (request.taxRatePercent ?? policy.defaultPercent) };
  }
  return policy.zeroRated
    ? resolveZeroRatedTaxRate(taxRates, request)
    : resolveAppliedTaxRate(taxRates, request, policy.defaultPercent);
}

/**
 * A line copied from a document that already resolved its tax — a quote
 * converting into an invoice. The rate was valid when it was quoted, so it is
 * kept even if it has been deactivated since, and the line is not repriced. A
 * source that stored no rate (a quote written before quotes stored one) is
 * inferred from its percent, exactly as a new line would be.
 */
export function resolveInheritedTaxRate(
  taxRates: readonly RateIdentity[] | null,
  inherited: AppliedTaxRate,
): AppliedTaxRate {
  if (inherited.taxRateId === null) {
    const inferred = taxRates === null ? null : inferTaxRateByPercent(taxRates, inherited.taxRatePercent);
    return { taxRateId: inferred?.id ?? null, taxRatePercent: inherited.taxRatePercent };
  }
  if (taxRates === null) throw new TaxRateUnverifiableError(inherited.taxRateId);
  if (!taxRates.some((r) => r.id === inherited.taxRateId)) throw new TaxRateNotFoundError(inherited.taxRateId);
  return inherited;
}
