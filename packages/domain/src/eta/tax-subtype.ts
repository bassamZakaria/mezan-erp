import { EtaVatSubTypeCode, TaxRateStatusCode } from "../tax-rates/tax-rate.js";

// INVARIANT: the rate cannot decide between the 0% classifications. Exempt,
// export of goods, export of services and not-subject are all 0% and are not
// interchangeable to the authority, so `auto` at 0% means "not told", and
// resolves to not-subject only because nothing more specific was named.
export const ZERO_RATED_SUBTYPES: readonly EtaVatSubTypeCode[] = [
  EtaVatSubTypeCode.ExportGoods,
  EtaVatSubTypeCode.ExportServices,
  EtaVatSubTypeCode.Exempt,
  EtaVatSubTypeCode.NotSubject,
];

export { resolveEtaVatSubType } from "../tax-rates/eta-vat-sub-type.js";

// INVARIANT: reached only for a line whose stored id is NULL. Several rates
// sharing a percent answer only when they all classify the same way — the
// first match would file an exempt sale as an export on one tenant and flip
// it back on the next.
export function findLineTaxRate<T extends { readonly status: string; readonly rate: number; readonly etaSubType: string }>(
  taxRates: readonly T[],
  taxRatePercent: number,
): T | null {
  // INVARIANT: nothing is inferred at 0% on the read side either. One 0% rate
  // on the tenant does not make every unnamed 0% line that rate.
  if (!(taxRatePercent > 0)) return null;
  const matches = taxRates.filter((r) => r.status === TaxRateStatusCode.Active && r.rate === taxRatePercent);
  if (matches.length === 1) return matches[0] ?? null;
  if (matches.length === 0) return null;
  // Several rates share the value. If they all classify the same way the
  // ambiguity is only in the name, so the answer is still safe.
  const distinct = new Set(matches.map((r) => r.etaSubType));
  return distinct.size === 1 ? (matches[0] ?? null) : null;
}

const UNSPECIFIC_ZERO_SUBTYPES: ReadonlySet<string> = new Set([EtaVatSubTypeCode.Auto, EtaVatSubTypeCode.NotSubject]);

export function isZeroRatedLineUnclassified<
  T extends { readonly id: string; readonly status: string; readonly rate: number; readonly etaSubType: string },
>(taxRates: readonly T[], line: LineTaxIdentity): boolean {
  if (line.taxRatePercent !== 0 || resolveLineTaxRate(taxRates, line) !== null) return false;
  return taxRates.some(
    (r) => r.status === TaxRateStatusCode.Active && r.rate === 0 && !UNSPECIFIC_ZERO_SUBTYPES.has(r.etaSubType),
  );
}

// INVARIANT: a line whose stored percent is missing takes the percent of the rate it names; with neither, the
// answer is null — never 0%. Filing an unknown rate as 0% is a classification the books never made.
export function lineTaxPercent<T extends { readonly id: string; readonly rate: number }>(
  taxRates: readonly T[],
  line: { readonly taxRateId?: string | null; readonly taxRatePercent?: number | null },
): number | null {
  if (line.taxRatePercent !== null && line.taxRatePercent !== undefined) return line.taxRatePercent;
  const named = line.taxRateId ? taxRates.find((r) => r.id === line.taxRateId) : undefined;
  return named ? named.rate : null;
}

export interface LineTaxIdentity {
  readonly taxRateId?: string | null;
  readonly taxRatePercent: number;
}

// INVARIANT: an inactive rate still answers by id — a posted line keeps the
// classification it was raised under.
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
