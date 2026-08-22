import { describe, it, expect } from "vitest";
import type { Customer, CustomerRepository } from "../customers/index.js";
import { Money } from "../money/index.js";
import {
  createInMemoryLeadRepository,
  createInMemoryOpportunityRepository,
} from "./test-helpers/in-memory-crm-repositories.js";
import { createLead } from "./create-lead.js";
import { transitionLead } from "./transition-lead.js";
import { convertLead, type ConvertLeadDeps } from "./convert-lead.js";
import { LeadNotConvertibleError, LeadNotFoundError } from "./errors.js";

function createInMemoryCustomerRepository(): Pick<CustomerRepository, "save" | "findAll"> {
  const rows = new Map<string, Customer>();
  return {
    async save(customer) {
      rows.set(customer.id, customer);
    },
    async findAll() {
      return [...rows.values()];
    },
  };
}

async function buildDeps(): Promise<ConvertLeadDeps> {
  return {
    leads: createInMemoryLeadRepository(),
    customers: createInMemoryCustomerRepository(),
    opportunities: createInMemoryOpportunityRepository(),
  };
}

async function qualifiedLead(deps: ConvertLeadDeps) {
  const lead = await createLead({ id: "lead-1", name: "أحمد محمد", company: "شركة الفا" }, deps.leads);
  const contacted = transitionLead(lead, "contacted");
  await deps.leads.update(contacted);
  const qualified = transitionLead(contacted, "qualified");
  await deps.leads.update(qualified);
  return qualified;
}

describe("convertLead", () => {
  it("converts a qualified lead into both a customer and an opportunity, linking them", async () => {
    const deps = await buildDeps();
    await qualifiedLead(deps);

    const result = await convertLead(
      {
        leadId: "lead-1",
        createCustomer: true,
        customer: { id: "cust-1", code: "CUST-001" },
        createOpportunity: true,
        opportunity: {
          id: "opp-1",
          title: "فرصة الفا",
          stageId: "stage-1",
          expectedValue: Money.fromMajor("5000.00"),
          probability: 40,
        },
      },
      deps,
    );

    expect(result.customerId).toBe("cust-1");
    expect(result.opportunityId).toBe("opp-1");
    expect(result.lead.status).toBe("converted");
    expect(result.lead.convertedCustomerId).toBe("cust-1");
    expect(result.lead.convertedOpportunityId).toBe("opp-1");

    const customers = await deps.customers.findAll();
    expect(customers).toHaveLength(1);
    expect(customers[0]?.id).toBe("cust-1");

    const opportunity = await deps.opportunities.findById("opp-1");
    expect(opportunity?.customerId).toBe("cust-1");
    expect(opportunity?.status).toBe("open");

    const persistedLead = await deps.leads.findById("lead-1");
    expect(persistedLead?.status).toBe("converted");
  });

  it("throws LeadNotConvertibleError when converting a lead that is not qualified", async () => {
    const deps = await buildDeps();
    await createLead({ id: "lead-2", name: "سارة علي" }, deps.leads);

    await expect(
      convertLead({ leadId: "lead-2", createCustomer: true, createOpportunity: false }, deps),
    ).rejects.toThrow(LeadNotConvertibleError);
  });

  it("throws LeadNotFoundError for an unknown lead id", async () => {
    const deps = await buildDeps();
    await expect(
      convertLead({ leadId: "does-not-exist", createCustomer: false, createOpportunity: false }, deps),
    ).rejects.toThrow(LeadNotFoundError);
  });

  it("cannot convert an already-converted lead again", async () => {
    const deps = await buildDeps();
    await qualifiedLead(deps);

    await convertLead({ leadId: "lead-1", createCustomer: true, createOpportunity: false }, deps);

    await expect(
      convertLead({ leadId: "lead-1", createCustomer: true, createOpportunity: false }, deps),
    ).rejects.toThrow(LeadNotConvertibleError);
  });
});
