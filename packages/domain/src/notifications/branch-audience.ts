import { ALL_SCOPE, type ScopeSelection } from "../permissions/auth-context.js";

/** The payload field every published event states its document's branches under; empty for a company-level event. */
export const EVENT_BRANCH_IDS_KEY = "branchIds";

export const COMPANY_LEVEL_EVENT_PERMISSION = "accounting.reports.view_unattributed";

/**
 * SECURITY: an event that does not state its branches is read as a
 * company-level one, so a publisher that forgets the field reaches fewer
 * people, never more.
 */
export function eventBranchIdsOf(payload: unknown): readonly string[] {
  if (payload === null || typeof payload !== "object") return [];
  const stated = (payload as Record<string, unknown>)[EVENT_BRANCH_IDS_KEY];
  return Array.isArray(stated) ? stated.filter((id): id is string => typeof id === "string" && id !== "") : [];
}

/**
 * Whether a recipient's branch grant covers an event. A notification carries
 * its document's number, amount and party, so it goes only where the document
 * itself may be read.
 */
export function branchGrantCoversEvent(branchScope: ScopeSelection, holdsCompanyLevelPermission: boolean, eventBranchIds: readonly string[]): boolean {
  if (branchScope === ALL_SCOPE) return true;
  if (eventBranchIds.length === 0) return holdsCompanyLevelPermission;
  return eventBranchIds.every((id) => branchScope.includes(id));
}
