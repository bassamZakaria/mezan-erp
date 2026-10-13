import type { Customer, CustomerRepository } from "@mezan/domain";

export type CustomerTaxProfile = Pick<Customer, "taxExempt" | "taxExemptionRateId">;

export type CustomerTaxProfileSource = (customerId: string) => Promise<CustomerTaxProfile | null>;

const NOT_EXEMPT: CustomerTaxProfile = { taxExempt: false, taxExemptionRateId: null };

export function customerTaxProfileFrom(customers: Pick<CustomerRepository, "findById">): CustomerTaxProfileSource {
  return async (customerId) => {
    const customer = await customers.findById(customerId);
    return customer ? { taxExempt: customer.taxExempt, taxExemptionRateId: customer.taxExemptionRateId } : null;
  };
}

// SECURITY: whether a sale is zero-rated is read off the customer RECORD. A
// request body claiming exemption is never believed, and with no customer
// source wired nobody is exempt.
export async function customerTaxProfileOf(
  source: CustomerTaxProfileSource | undefined,
  customerId: string,
): Promise<CustomerTaxProfile> {
  return (await source?.(customerId)) ?? NOT_EXEMPT;
}
