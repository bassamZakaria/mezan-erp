import type { Money } from "../money/index.js";
import { InvalidLeadError } from "./errors.js";
import type { Lead, LeadRepository, LeadSource } from "./lead.js";

export interface CreateLeadCommand {
  readonly id: string;
  readonly name: string;
  readonly company?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly source?: LeadSource;
  readonly expectedValue?: Money | null;
  readonly interest?: string | null;
  readonly notes?: string | null;
}

function validate(command: CreateLeadCommand): string[] {
  const reasons: string[] = [];
  if (command.name.trim().length === 0) {
    reasons.push("الاسم مطلوب");
  }
  return reasons;
}

/** Creates and persists a new lead. New leads always start `new` (docs/catalog/06 "العملاء المحتملون"). */
export async function createLead(command: CreateLeadCommand, repo: LeadRepository): Promise<Lead> {
  const reasons = validate(command);
  if (reasons.length > 0) throw new InvalidLeadError(reasons);

  const lead: Lead = {
    id: command.id,
    name: command.name,
    company: command.company ?? null,
    email: command.email ?? null,
    phone: command.phone ?? null,
    source: command.source ?? "other",
    expectedValue: command.expectedValue ?? null,
    interest: command.interest ?? null,
    notes: command.notes ?? null,
    status: "new",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: new Date().toISOString(),
  };

  await repo.create(lead);
  return lead;
}
