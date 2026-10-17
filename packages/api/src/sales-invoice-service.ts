import { SalesInvoiceService, type SalesTaxReratingPort } from "@mezan/domain";
import { customerTaxProfileOf, type CustomerTaxProfileSource } from "./customer-tax-profile.js";
import type { SalesInvoiceRoutesDeps } from "./sales-invoices-routes.js";

export type SalesItemTaxSource = (itemId: string) => Promise<{ readonly taxRatePercent: number } | null>;

export type SalesInvoiceServiceWiring = Pick<
  SalesInvoiceRoutesDeps,
  | "repo"
  | "numbering"
  | "gl"
  | "stock"
  | "workflow"
  | "creditControl"
  | "promotions"
  | "pricing"
  | "pricingGuard"
  | "taxPolicy"
  | "taxRates"
  | "customerTax"
  | "itemTax"
  | "taxTags"
  | "taxFiling"
  | "taxDependents"
  | "exchangeRates"
  | "baseCurrency"
  | "contractBilling"
  | "audit"
  | "events"
  | "allocatable"
  | "now"
>;

export function salesTaxRerating(customerTax: CustomerTaxProfileSource | undefined, itemTax: SalesItemTaxSource | undefined): SalesTaxReratingPort {
  return {
    customerExemptionRateId: async (customerId) => {
      const profile = await customerTaxProfileOf(customerTax, customerId);
      return profile.taxExempt ? profile.taxExemptionRateId : null;
    },
    itemTax: async (itemId) => (await itemTax?.(itemId)) ?? null,
  };
}

// INVARIANT: the ONE place the app turns its sales-invoice wiring into a
// service. The invoice routes, a quote's conversion and the approval of a held
// invoice all build theirs here, so none of them can confirm under a different
// VAT policy, rate table, credit control, promotion or exchange rate than the
// others (`sales-invoice-service.structure.test.ts`).
export function buildSalesInvoiceService(wiring: SalesInvoiceServiceWiring, actor: string): SalesInvoiceService {
  return new SalesInvoiceService({
    repo: wiring.repo,
    numbering: wiring.numbering,
    gl: wiring.gl,
    stock: wiring.stock,
    workflow: wiring.workflow,
    creditControl: wiring.creditControl,
    promotions: wiring.promotions,
    pricing: wiring.pricing,
    pricingGuard: wiring.pricingGuard,
    taxPolicy: wiring.taxPolicy,
    taxRates: wiring.taxRates,
    taxRerating: salesTaxRerating(wiring.customerTax, wiring.itemTax),
    taxTags: wiring.taxTags,
    taxFiling: wiring.taxFiling,
    taxDependents: wiring.taxDependents,
    exchangeRates: wiring.exchangeRates,
    baseCurrency: wiring.baseCurrency,
    contractBilling: wiring.contractBilling,
    audit: wiring.audit,
    events: wiring.events,
    allocatable: wiring.allocatable,
    now: wiring.now,
    actor,
  });
}
