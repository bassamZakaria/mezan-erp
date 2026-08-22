import { createCustomer, type CustomerRepository } from "../customers/index.js";
import type { Money } from "../money/index.js";
import { LeadNotConvertibleError, LeadNotFoundError } from "./errors.js";
import type { Lead, LeadRepository } from "./lead.js";
import type { Opportunity, OpportunityRepository } from "./opportunity.js";

export interface ConvertLeadCommand {
  readonly leadId: string;
  readonly createCustomer: boolean;
  readonly customer?: { readonly id: string; readonly code: string };
  readonly createOpportunity: boolean;
  readonly opportunity?: {
    readonly id: string;
    readonly title: string;
    readonly stageId: string;
    readonly expectedValue: Money;
    readonly probability: number;
    readonly expectedCloseDate?: string | null;
  };
}

export interface ConvertLeadDeps {
  readonly leads: LeadRepository;
  readonly customers: Pick<CustomerRepository, "save" | "findAll">;
  readonly opportunities: OpportunityRepository;
}

export interface ConvertLeadResult {
  readonly lead: Lead;
  readonly customerId: string | null;
  readonly opportunityId: string | null;
}

/**
 * Converts a "qualified" lead into a real `Customer` and/or `Opportunity`
 * (docs/catalog/06 "العملاء المحتملون" — محول status). A lead must be
 * "qualified" to convert; once converted its status is "converted", which is
 * terminal, so it cannot be converted a second time (the same guard rejects
 * it, since "converted" !== "qualified").
 */
export async function convertLead(cmd: ConvertLeadCommand, deps: ConvertLeadDeps): Promise<ConvertLeadResult> {
  const lead = await deps.leads.findById(cmd.leadId);
  if (!lead) throw new LeadNotFoundError(cmd.leadId);
  if (lead.status !== "qualified") throw new LeadNotConvertibleError(cmd.leadId);

  let customerId: string | null = null;
  if (cmd.createCustomer) {
    const customerInput = cmd.customer;
    const id = customerInput?.id ?? lead.id;
    const code = customerInput?.code ?? lead.id;
    const customer = createCustomer({
      id,
      code,
      nameAr: lead.company ?? lead.name,
      phone: lead.phone,
      email: lead.email,
      contactPerson: lead.name,
    });
    await deps.customers.save(customer);
    customerId = customer.id;
  }

  let opportunityId: string | null = null;
  if (cmd.createOpportunity) {
    const opportunityInput = cmd.opportunity;
    if (!opportunityInput) {
      throw new TypeError("convertLead: createOpportunity is true but no opportunity details were supplied.");
    }
    const opportunity: Opportunity = {
      id: opportunityInput.id,
      title: opportunityInput.title,
      customerId: customerId ?? "",
      stageId: opportunityInput.stageId,
      expectedValue: opportunityInput.expectedValue,
      probability: opportunityInput.probability,
      expectedCloseDate: opportunityInput.expectedCloseDate ?? null,
      notes: lead.notes,
      status: "open",
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    await deps.opportunities.create(opportunity);
    opportunityId = opportunity.id;
  }

  const convertedLead: Lead = {
    ...lead,
    status: "converted",
    convertedCustomerId: customerId,
    convertedOpportunityId: opportunityId,
  };
  await deps.leads.update(convertedLead);

  return { lead: convertedLead, customerId, opportunityId };
}
