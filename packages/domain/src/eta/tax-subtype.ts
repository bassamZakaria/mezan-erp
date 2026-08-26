/**
 * Which VAT sub-type a submitted line carries. The tax rate master already
 * classifies itself (`TaxRate.etaSubType`); "auto" — its default — defers the
 * choice to submission time, where the authority expects V009 (basic sales tax)
 * on a taxed line and V004 (not subject) on a zero-rated one.
 */
export function resolveEtaVatSubType(configured: string | null | undefined, taxRatePercent: number): string {
  if (configured && configured !== "auto") return configured;
  return taxRatePercent > 0 ? "V009" : "V004";
}
