import { InactiveTaxRateError, TaxRateNotFoundError, TaxRatePercentMismatchError } from "./errors.js";
import type { TaxRate } from "./tax-rate.js";

export interface AppliedTaxRate {
  readonly taxRateId: string | null;
  readonly taxRatePercent: number;
}

export interface AppliedTaxRateRequest {
  readonly taxRateId?: string | null;
  readonly taxRatePercent?: number | null;
}

type RateIdentity = Pick<TaxRate, "id" | "rate" | "status">;

export function findSoleActiveTaxRateByPercent<T extends RateIdentity>(
  taxRates: readonly T[],
  taxRatePercent: number,
): T | null {
  const matches = taxRates.filter((r) => r.status === "active" && r.rate === taxRatePercent);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function resolveAppliedTaxRate(
  taxRates: readonly RateIdentity[],
  request: AppliedTaxRateRequest,
  defaultPercent: number,
): AppliedTaxRate {
  const requestedId = request.taxRateId ?? null;
  if (requestedId !== null) {
    const rate = taxRates.find((r) => r.id === requestedId);
    if (!rate) throw new TaxRateNotFoundError(requestedId);
    if (rate.status !== "active") throw new InactiveTaxRateError(requestedId);
    const claimed = request.taxRatePercent ?? null;
    if (claimed !== null && claimed !== rate.rate) {
      throw new TaxRatePercentMismatchError(requestedId, rate.rate, claimed);
    }
    return { taxRateId: rate.id, taxRatePercent: rate.rate };
  }
  const taxRatePercent = request.taxRatePercent ?? defaultPercent;
  return {
    taxRateId: findSoleActiveTaxRateByPercent(taxRates, taxRatePercent)?.id ?? null,
    taxRatePercent,
  };
}

export function resolveZeroRatedTaxRate(
  taxRates: readonly RateIdentity[],
  request: AppliedTaxRateRequest,
): AppliedTaxRate {
  const requestedId = request.taxRateId ?? null;
  if (requestedId !== null) {
    const requested = resolveAppliedTaxRate(taxRates, { taxRateId: requestedId }, 0);
    if (requested.taxRatePercent === 0) return requested;
  }
  return resolveAppliedTaxRate(taxRates, { taxRatePercent: 0 }, 0);
}
