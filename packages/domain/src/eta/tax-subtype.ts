import { TaxRateStatusCode } from "../tax-rates/tax-rate.js";

/**
 * Which VAT sub-type a submitted line carries. The tax rate master already
 * classifies itself (`TaxRate.etaSubType`); "auto" — its default — defers the
 * choice to submission time, where the authority expects V009 (basic sales tax)
 * on a taxed line and V004 (not subject) on a zero-rated one.
 *
 * The RATE CANNOT DECIDE between the zero-rated classifications (D79). Exempt
 * (V003), export of goods (V001), export of services (V002) and not-subject
 * (V004) are all 0%, and they are not interchangeable to the authority: filing
 * an exempt sale as an export is a misdeclaration. So a 0% line resolves to
 * V004 ONLY when nothing more specific is configured — `auto` means "I was not
 * told", not "it is not subject".
 */

/** Sub-types that are 0% and mean different things — never inferred from the rate. */
export const ZERO_RATED_SUBTYPES = ["V001", "V002", "V003", "V004"] as const;

export function resolveEtaVatSubType(configured: string | null | undefined, taxRatePercent: number): string {
  if (configured && configured !== "auto") return configured;
  return taxRatePercent > 0 ? "V009" : "V004";
}

/**
 * Picks the tax rate a line was charged at.
 *
 * Matching on the rate VALUE alone is what made D79 possible: a tenant with
 * both "معفى" (V003) and "تصدير" (V001) configured has two active 0% rates, and
 * `find` returned whichever was defined first — so an exempt sale could be
 * filed as an export, and the next tenant's data would flip it back. When the
 * value is ambiguous this returns null rather than a coin flip, and the caller
 * falls back to `auto`, which files the neutral V004 instead of a specific
 * claim the books never made.
 *
 * LEGACY ONLY: a line posted since D79 was closed carries its `taxRateId`, and
 * `resolveLineTaxRate` reads the classification off that row. This matcher is
 * reached only for a line whose stored id is NULL.
 */
export function findLineTaxRate<T extends { readonly status: string; readonly rate: number; readonly etaSubType: string }>(
  taxRates: readonly T[],
  taxRatePercent: number,
): T | null {
  const matches = taxRates.filter((r) => r.status === TaxRateStatusCode.Active && r.rate === taxRatePercent);
  if (matches.length === 1) return matches[0] ?? null;
  if (matches.length === 0) return null;
  // Several rates share the value. If they all classify the same way the
  // ambiguity is only in the name, so the answer is still safe.
  const distinct = new Set(matches.map((r) => r.etaSubType));
  return distinct.size === 1 ? (matches[0] ?? null) : null;
}

export function isZeroRatedClassificationAmbiguous<
  T extends { readonly id: string; readonly status: string; readonly rate: number; readonly etaSubType: string },
>(taxRates: readonly T[], line: LineTaxIdentity): boolean {
  if (line.taxRatePercent !== 0 || resolveLineTaxRate(taxRates, line) !== null) return false;
  const classifications = new Set(
    taxRates.filter((r) => r.status === TaxRateStatusCode.Active && r.rate === 0).map((r) => r.etaSubType),
  );
  return classifications.size > 1;
}

export interface LineTaxIdentity {
  readonly taxRateId?: string | null;
  readonly taxRatePercent: number;
}

/**
 * The tax rate a line was charged at, read from the id the line stored. An
 * inactive rate still answers: a posted line keeps the classification that
 * applied when it was raised. Only a line with no stored id (or whose row is
 * gone) falls back to matching the percent.
 */
export function resolveLineTaxRate<
  T extends { readonly id: string; readonly status: string; readonly rate: number; readonly etaSubType: string },
>(taxRates: readonly T[], line: LineTaxIdentity): T | null {
  const storedId = line.taxRateId ?? null;
  if (storedId !== null) {
    const stored = taxRates.find((r) => r.id === storedId);
    if (stored) return stored;
  }
  return findLineTaxRate(taxRates, line.taxRatePercent);
}
