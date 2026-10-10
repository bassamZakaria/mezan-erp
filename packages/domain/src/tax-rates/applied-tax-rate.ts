import {
  InactiveTaxRateError,
  TaxRateNotFoundError,
  TaxRatePercentMismatchError,
  TaxRateUnverifiableError,
} from "./errors.js";
import { TaxRateStatusCode, type TaxRate } from "./tax-rate.js";
import { systemNotSubjectRateIn } from "./system-tax-rates.js";

export interface AppliedTaxRate {
  readonly taxRateId: string | null;
  readonly taxRatePercent: number;
}

export interface AppliedTaxRateRequest {
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

// INVARIANT: this is not inference from the percent. Policy made the line
// 0% — the customer is tax-exempt, or VAT is off — so the SYSTEM raised it,
// and a line the system raised at 0% is filed as not subject. A 0% the caller
// typed goes through `resolveAppliedTaxRate` and still has to name its rate.
export function resolveZeroRatedTaxRate(
  taxRates: readonly RateIdentity[],
  request: AppliedTaxRateRequest,
): AppliedTaxRate {
  if (typeof request.taxRateId === "string") {
    const rate = requireNamedRate(taxRates, request.taxRateId);
    if (rate.rate === 0) return { taxRateId: rate.id, taxRatePercent: 0 };
  }
  return { taxRateId: systemNotSubjectRateIn(taxRates)?.id ?? null, taxRatePercent: 0 };
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

// INVARIANT: an inherited rate is neither re-checked for being active nor
// repriced — the source document was accepted under it. A source that stored
// NO rate is carried as it is: a NULL cannot say whether it predates the
// column or answered "no rate", so nothing is resolved for it a second time.
export function resolveInheritedTaxRate(
  taxRates: readonly RateIdentity[] | null,
  inherited: AppliedTaxRate,
): AppliedTaxRate {
  if (inherited.taxRateId === null) return inherited;
  if (taxRates === null) throw new TaxRateUnverifiableError(inherited.taxRateId);
  if (!taxRates.some((r) => r.id === inherited.taxRateId)) throw new TaxRateNotFoundError(inherited.taxRateId);
  return inherited;
}
