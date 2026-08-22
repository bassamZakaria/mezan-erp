import type { Money } from "../money/index.js";

/**
 * Leads — core entity (docs/catalog/06-crm-hr.md "العملاء المحتملون"). A
 * `Lead` is a prospect captured before it becomes a sales opportunity and/or
 * customer; it moves through a small status state machine and, once
 * "qualified", may be converted into a `Customer` and/or `Opportunity`.
 */

export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost" | "unqualified";
export type LeadSource = "website" | "referral" | "phone" | "social" | "other";

export interface LeadStatusDefinition {
  readonly code: LeadStatus;
  readonly labelAr: string;
}

export const LEAD_STATUS_DEFINITIONS: readonly LeadStatusDefinition[] = [
  { code: "new", labelAr: "جديد" },
  { code: "contacted", labelAr: "تم التواصل" },
  { code: "qualified", labelAr: "مؤهل" },
  { code: "converted", labelAr: "محول" },
  { code: "lost", labelAr: "خسارة" },
  { code: "unqualified", labelAr: "غير مؤهل" },
] as const;

export function getLeadStatusLabel(status: LeadStatus): string {
  return LEAD_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export interface LeadSourceDefinition {
  readonly code: LeadSource;
  readonly labelAr: string;
}

export const LEAD_SOURCE_DEFINITIONS: readonly LeadSourceDefinition[] = [
  { code: "website", labelAr: "الموقع الإلكتروني" },
  { code: "referral", labelAr: "إحالة" },
  { code: "phone", labelAr: "هاتف" },
  { code: "social", labelAr: "وسائل التواصل" },
  { code: "other", labelAr: "أخرى" },
] as const;

export function getLeadSourceLabel(source: LeadSource): string {
  return LEAD_SOURCE_DEFINITIONS.find((d) => d.code === source)?.labelAr ?? source;
}

export interface Lead {
  readonly id: string;
  readonly name: string;
  readonly company: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly source: LeadSource;
  readonly expectedValue: Money | null;
  readonly interest: string | null;
  readonly notes: string | null;
  readonly status: LeadStatus;
  readonly convertedCustomerId: string | null;
  readonly convertedOpportunityId: string | null;
  readonly createdAt: string;
}

/** Persistence port for leads. The domain depends on this interface only — no SQL, no driver. */
export interface LeadRepository {
  findById(id: string): Promise<Lead | null>;
  list(): Promise<Lead[]>;
  create(lead: Lead): Promise<void>;
  update(lead: Lead): Promise<void>;
}

/**
 * The lead status state machine (docs/catalog/06 "العملاء المحتملون"
 * workflow chips): جديد → تم التواصل → مؤهل → محول, with خسارة/غير مؤهل as
 * terminal alternate states reachable from "new"/"contacted", and loss is
 * reachable from "qualified" too. "converted", "lost" and "unqualified" are
 * terminal — no further transitions out of them.
 */
export const ALLOWED_LEAD_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "unqualified", "lost"],
  contacted: ["qualified", "unqualified", "lost"],
  qualified: ["converted", "lost"],
  converted: [],
  lost: [],
  unqualified: [],
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return ALLOWED_LEAD_TRANSITIONS[from].includes(to);
}
