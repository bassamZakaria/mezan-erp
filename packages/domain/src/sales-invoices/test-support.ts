import type { SalesInvoiceServiceDeps } from "./service.js";

export const PLAIN_SALES_TAX_DEPS: Pick<SalesInvoiceServiceDeps, "taxPolicy" | "taxRates" | "taxRerating"> = {
  taxPolicy: () => ({ enabled: true, defaultRatePercent: 0, inclusive: false }),
  taxRates: { list: async () => [] },
  taxRerating: { customerExemptionRateId: async () => null, itemTax: async () => null },
};
