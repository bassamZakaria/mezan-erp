import { EtaVatSubTypeCode } from "./tax-rate.js";

// EXTERNAL CONTRACT: the ONE reading of what a rate tells the tax authority.
// `auto` files a taxed line as basic sales and a 0% one as not subject; a
// named sub-type is filed as named. The e-invoice, the reserved-rate check and
// the "does this edit restate a filed document" check all read it here.
export function resolveEtaVatSubType(configured: string | null | undefined, taxRatePercent: number): string {
  if (configured && configured !== EtaVatSubTypeCode.Auto) return configured;
  return taxRatePercent > 0 ? EtaVatSubTypeCode.BasicSales : EtaVatSubTypeCode.NotSubject;
}
