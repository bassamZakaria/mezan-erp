import {
  InactiveTaxRateError,
  SystemTaxRateOnlyError,
  TaxRateAlreadyClassifiedError,
  TaxRateClassificationPercentError,
  TaxRateNotFoundError,
  TaxRatePercentMismatchError,
  TaxRateUnverifiableError,
} from "./errors.js";
import { TaxRateStatusCode, type TaxRate } from "./tax-rate.js";
import { isSystemTaxRate, systemNotSubjectRateIn } from "./system-tax-rates.js";

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
 * only ONE of them would otherwise have every unnamed 0% line filed under it.
 * A 0% line carries a rate only when something NAMED one: the line, the
 * exempt customer's card, or the VAT-off policy.
 */
export function inferTaxRateByPercent<T extends Pick<TaxRate, "id" | "rate" | "status">>(
  taxRates: readonly T[],
  taxRatePercent: number,
): T | null {
  if (!(taxRatePercent > 0)) return null;
  const matches = taxRates.filter((r) => r.status === TaxRateStatusCode.Active && r.rate === taxRatePercent);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

// INVARIANT: the system's «غير خاضع» rate is never CHOSEN. It is named by the
// VAT-off policy alone, so a line, a customer card or a purchase that asks for
// it by id is refused — a tenant inside VAT declares 0% under a rate of its own.
function requireChosenRate(taxRates: readonly RateIdentity[], taxRateId: string): RateIdentity {
  const rate = requireNamedRate(taxRates, taxRateId);
  if (isSystemTaxRate(rate.id)) throw new SystemTaxRateOnlyError(rate.id, rate.name);
  return rate;
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
    const rate = requireChosenRate(taxRates, request.taxRateId);
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

export enum ZeroRatingCause {
  VatOff = "vat_off",
  ExemptCustomer = "exempt_customer",
}

export type ZeroRating =
  | { readonly cause: ZeroRatingCause.VatOff }
  | { readonly cause: ZeroRatingCause.ExemptCustomer; readonly exemptionTaxRateId: string | null };

function policyRateId(taxRates: readonly RateIdentity[], zeroRating: ZeroRating): string | null {
  switch (zeroRating.cause) {
    case ZeroRatingCause.VatOff:
      return systemNotSubjectRateIn(taxRates)?.id ?? null;
    case ZeroRatingCause.ExemptCustomer: {
      const rate = taxRates.find((r) => r.id === zeroRating.exemptionTaxRateId);
      return rate && rate.status === TaxRateStatusCode.Active && rate.rate === 0 && !isSystemTaxRate(rate.id) ? rate.id : null;
    }
  }
}

// INVARIANT: this is not inference from the percent. The system's
// «غير خاضع» rate is named in ONE case — the tenant's VAT is switched off,
// so the sale is out of scope. An exempt customer's line names the 0% rate
// the tenant put on that customer's card and nothing else: exempt, export
// and not-subject are different declarations, and a guess here is a wrong
// filing. With no such rate the line stores NULL and waits to be classified.
export function resolveZeroRatedTaxRate(
  taxRates: readonly RateIdentity[],
  request: AppliedTaxRateRequest,
  zeroRating: ZeroRating,
): AppliedTaxRate {
  if (typeof request.taxRateId === "string") {
    const rate = zeroRating.cause === ZeroRatingCause.VatOff ? requireNamedRate(taxRates, request.taxRateId) : requireChosenRate(taxRates, request.taxRateId);
    if (rate.rate === 0) return { taxRateId: rate.id, taxRatePercent: 0 };
  }
  return { taxRateId: policyRateId(taxRates, zeroRating), taxRatePercent: 0 };
}

export interface DocumentLineTaxPolicy {
  readonly defaultPercent: number;
  readonly zeroRating: ZeroRating | null;
}

export function resolveDocumentLineTax(
  taxRates: readonly RateIdentity[] | null,
  request: AppliedTaxRateRequest,
  policy: DocumentLineTaxPolicy,
): AppliedTaxRate {
  if (taxRates === null) {
    if (typeof request.taxRateId === "string") throw new TaxRateUnverifiableError(request.taxRateId);
    return { taxRateId: null, taxRatePercent: policy.zeroRating ? 0 : (request.taxRatePercent ?? policy.defaultPercent) };
  }
  return policy.zeroRating
    ? resolveZeroRatedTaxRate(taxRates, request, policy.zeroRating)
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

// INVARIANT: classification only ever goes NULL → rate, and only to a rate
// whose percent IS the stored percent. It names what the line was charged
// under; it can never reprice a line or move it from one rate to another.
export function classifyStoredTaxRate(
  taxRates: readonly RateIdentity[] | null,
  stored: AppliedTaxRate,
  taxRateId: string,
): AppliedTaxRate {
  if (stored.taxRateId === taxRateId) return stored;
  if (taxRates === null) throw new TaxRateUnverifiableError(taxRateId);
  if (stored.taxRateId !== null) {
    const current = taxRates.find((r) => r.id === stored.taxRateId);
    throw new TaxRateAlreadyClassifiedError(stored.taxRateId, current?.name ?? stored.taxRateId);
  }
  const rate = requireNamedRate(taxRates, taxRateId);
  if (rate.rate !== stored.taxRatePercent) {
    throw new TaxRateClassificationPercentError(rate.id, rate.name, rate.rate, stored.taxRatePercent);
  }
  return { taxRateId: rate.id, taxRatePercent: stored.taxRatePercent };
}
