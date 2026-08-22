import { InvalidLeadTransitionError } from "./errors.js";
import { canTransitionLead, type Lead, type LeadStatus } from "./lead.js";

/**
 * Applies a lead status transition per the lead state machine
 * (`ALLOWED_LEAD_TRANSITIONS`). Pure — the caller (API layer) persists the
 * result via `repo.update`.
 */
export function transitionLead(lead: Lead, toStatus: LeadStatus): Lead {
  if (!canTransitionLead(lead.status, toStatus)) {
    throw new InvalidLeadTransitionError(lead.status, toStatus);
  }
  return { ...lead, status: toStatus };
}
