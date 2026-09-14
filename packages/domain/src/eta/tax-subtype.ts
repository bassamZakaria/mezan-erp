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
 * The real fix is a `taxRateId` on the invoice line so the identity is never
 * re-derived; that is a schema change and is recorded in the roadmap.
 */
export function findLineTaxRate<T extends { readonly status: string; readonly rate: number; readonly etaSubType: string }>(
  taxRates: readonly T[],
  taxRatePercent: number,
): T | null {
  const matches = taxRates.filter((r) => r.status === "active" && r.rate === taxRatePercent);
  if (matches.length === 1) return matches[0] ?? null;
  if (matches.length === 0) return null;
  // Several rates share the value. If they all classify the same way the
  // ambiguity is only in the name, so the answer is still safe.
  const distinct = new Set(matches.map((r) => r.etaSubType));
  return distinct.size === 1 ? (matches[0] ?? null) : null;
}
