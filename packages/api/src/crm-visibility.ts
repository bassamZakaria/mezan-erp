import type { Context } from "hono";
import { can, type Activity, type Opportunity } from "@mezan/domain";
import { branchScopeOf, callerUserId, getAuthContext, withinScope } from "./permission-gate.js";

export const OPPORTUNITY_VIEW_ALL = "crm.opportunity.view";
export const OPPORTUNITY_VIEW_OWN = "crm.opportunity.view_own";
export const OPPORTUNITY_ASSIGN = "crm.opportunity.assign";

export interface CrmOwner {
  readonly id: string;
  readonly name: string;
}

export interface CrmOwnerDirectory {
  list(): Promise<readonly CrmOwner[]>;
  has(userId: string): Promise<boolean>;
}

export function seesEveryOpportunity(c: Context): boolean {
  const ctx = getAuthContext(c);
  return ctx ? can(ctx, OPPORTUNITY_VIEW_ALL) : false;
}

export function mayAssignOpportunities(c: Context): boolean {
  const ctx = getAuthContext(c);
  return ctx ? can(ctx, OPPORTUNITY_ASSIGN) : false;
}

/**
 * SECURITY: the one place that decides which deals a caller sees. Branch scope
 * narrows first; a caller holding only `view_own` is then cut to the deals they
 * own, and a deal nobody owns belongs to no rep. Every route that reads a deal
 * — list, detail, stage move, forecast, linked quotes — goes through this.
 */
export function visibleOpportunities(c: Context, rows: readonly Opportunity[]): readonly Opportunity[] {
  const scoped = withinScope(rows, branchScopeOf(c), (o) => o.branchId);
  if (seesEveryOpportunity(c)) return scoped;
  const me = callerUserId(c);
  return me ? scoped.filter((o) => o.ownerUserId === me) : [];
}

/**
 * Only the rep tier (`view_own` without `view`) is narrowed to its own
 * follow-ups. A caller holding neither tier works on leads and activities alone
 * and keeps the whole list, exactly as before the rep tier existed.
 */
export function seesEveryActivity(c: Context): boolean {
  const ctx = getAuthContext(c);
  return !ctx || can(ctx, OPPORTUNITY_VIEW_ALL) || !can(ctx, OPPORTUNITY_VIEW_OWN);
}

export function visibleActivities(c: Context, activities: readonly Activity[], opportunities: readonly Opportunity[]): readonly Activity[] {
  if (seesEveryActivity(c)) return activities;
  const me = callerUserId(c);
  if (!me) return [];
  const mine = new Set(opportunities.filter((o) => o.ownerUserId === me).map((o) => o.id));
  return activities.filter(
    (a) => a.assigneeUserId === me || (a.assigneeUserId === null && a.relatedOpportunityId !== null && mine.has(a.relatedOpportunityId)),
  );
}
