import { isKnownModule } from "./module-catalog.js";
import { dedupeModules, type PlanRepository } from "./plan.js";
import { isCount, isoTimestamp } from "./validation.js";
import {
  InvalidSubscriptionError,
  InvalidSubscriptionTransitionError,
  PlanNotFoundError,
  PlanRetiredError,
  SubscriptionNotFoundError,
  TenantAlreadySubscribedError,
} from "./errors.js";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
export type BillingCycle = "monthly" | "yearly";

export interface Subscription {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  readonly billingCycle: BillingCycle;
  readonly addOnModules: readonly string[];
  readonly extraSeats: number;
  readonly extraBranches: number;
  readonly extraWarehouses: number;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly trialEndsAt: string | null;
  readonly graceDays: number;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  findLiveByTenant(tenantId: string): Promise<Subscription | null>;
  listByTenant(tenantId: string): Promise<Subscription[]>;
  hasLiveByPlan(planId: string): Promise<boolean>;
  save(subscription: Subscription): Promise<void>;
}

export const DEFAULT_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function addPeriod(startIso: string, cycle: BillingCycle): string {
  const d = new Date(startIso);
  const year = d.getUTCFullYear() + (cycle === "yearly" ? 1 : 0);
  const month = d.getUTCMonth() + (cycle === "monthly" ? 1 : 0);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString();
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export interface StartSubscriptionCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly billingCycle: BillingCycle;
  readonly trial?: boolean;
  readonly addOnModules?: readonly string[];
  readonly extraSeats?: number;
  readonly extraBranches?: number;
  readonly extraWarehouses?: number;
  readonly graceDays?: number;
  readonly now: string;
}

function validateExtras(s: Pick<Subscription, "addOnModules" | "extraSeats" | "extraBranches" | "extraWarehouses" | "graceDays">): string[] {
  const reasons: string[] = [];
  for (const m of s.addOnModules) if (!isKnownModule(m)) reasons.push(`unknown add-on module "${m}"`);
  if (!isCount(s.extraSeats, 0)) reasons.push("extraSeats must be an integer of at least 0");
  if (!isCount(s.extraBranches, 0)) reasons.push("extraBranches must be an integer of at least 0");
  if (!isCount(s.extraWarehouses, 0)) reasons.push("extraWarehouses must be an integer of at least 0");
  if (!isCount(s.graceDays, 0)) reasons.push("graceDays must be an integer of at least 0");
  return reasons;
}

async function activePlan(planId: string, plans: PlanRepository) {
  const plan = await plans.findById(planId);
  if (!plan) throw new PlanNotFoundError(planId);
  if (plan.status === "retired") throw new PlanRetiredError(planId);
  return plan;
}

export async function startSubscription(
  cmd: StartSubscriptionCommand,
  repo: SubscriptionRepository,
  plans: PlanRepository,
): Promise<Subscription> {
  const now = isoTimestamp(cmd.now);
  const addOnModules = dedupeModules(cmd.addOnModules ?? []);
  const extraSeats = cmd.extraSeats ?? 0;
  const extraBranches = cmd.extraBranches ?? 0;
  const extraWarehouses = cmd.extraWarehouses ?? 0;
  const graceDays = cmd.graceDays ?? DEFAULT_GRACE_DAYS;
  const reasons: string[] = [];
  if (cmd.id.trim() === "" || cmd.tenantId.trim() === "") reasons.push("id and tenantId are required");
  if (!now) reasons.push("now must be an ISO-8601 timestamp");
  reasons.push(...validateExtras({ addOnModules, extraSeats, extraBranches, extraWarehouses, graceDays }));
  if (!now || reasons.length > 0) throw new InvalidSubscriptionError(reasons);
  const plan = await activePlan(cmd.planId, plans);
  if (await repo.findLiveByTenant(cmd.tenantId)) throw new TenantAlreadySubscribedError(cmd.tenantId);
  const trial = cmd.trial === true && plan.trialDays > 0;
  const candidate: Subscription = {
    id: cmd.id,
    tenantId: cmd.tenantId,
    planId: plan.id,
    status: trial ? "trialing" : "active",
    billingCycle: cmd.billingCycle,
    addOnModules,
    extraSeats,
    extraBranches,
    extraWarehouses,
    currentPeriodStart: now,
    currentPeriodEnd: addPeriod(now, cmd.billingCycle),
    trialEndsAt: trial ? addDays(now, plan.trialDays) : null,
    graceDays,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await repo.save(candidate);
  return candidate;
}

export interface SubscriptionCommand {
  readonly id: string;
  readonly now: string;
}

async function load(id: string, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await repo.findById(id);
  if (!s) throw new SubscriptionNotFoundError(id);
  return s;
}

function assertFrom(s: Subscription, allowed: readonly SubscriptionStatus[], to: SubscriptionStatus): void {
  if (!allowed.includes(s.status)) throw new InvalidSubscriptionTransitionError(s.status, to);
}

function requireNow(cmd: SubscriptionCommand): string {
  const now = isoTimestamp(cmd.now);
  if (!now) throw new InvalidSubscriptionError(["now must be an ISO-8601 timestamp"]);
  return now;
}

export async function renewSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const now = requireNow(cmd);
  assertFrom(s, ["trialing", "active", "past_due"], "active");
  const lapsed = s.currentPeriodEnd < now;
  const periodStart = lapsed ? now : s.currentPeriodEnd;
  const next: Subscription = {
    ...s,
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: periodStart,
    currentPeriodEnd: addPeriod(periodStart, s.billingCycle),
    updatedAt: now,
  };
  await repo.save(next);
  return next;
}

export async function markPastDue(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const now = requireNow(cmd);
  assertFrom(s, ["active"], "past_due");
  if (now < s.currentPeriodEnd) {
    throw new InvalidSubscriptionError([`period has not ended (ends ${s.currentPeriodEnd})`]);
  }
  const next: Subscription = { ...s, status: "past_due", updatedAt: now };
  await repo.save(next);
  return next;
}

export async function suspendSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const now = requireNow(cmd);
  assertFrom(s, ["active", "past_due"], "suspended");
  const next: Subscription = { ...s, status: "suspended", updatedAt: now };
  await repo.save(next);
  return next;
}

export async function resumeSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const now = requireNow(cmd);
  assertFrom(s, ["suspended"], "active");
  const next: Subscription = { ...s, status: "active", updatedAt: now };
  await repo.save(next);
  return next;
}

export async function cancelSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const now = requireNow(cmd);
  assertFrom(s, ["trialing", "active", "past_due", "suspended"], "cancelled");
  const next: Subscription = { ...s, status: "cancelled", cancelledAt: now, updatedAt: now };
  await repo.save(next);
  return next;
}

export interface ChangePlanCommand extends SubscriptionCommand {
  readonly planId: string;
}

export async function changePlan(
  cmd: ChangePlanCommand,
  repo: SubscriptionRepository,
  plans: PlanRepository,
): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const now = requireNow(cmd);
  assertFrom(s, ["trialing", "active", "past_due"], "active");
  const plan = await activePlan(cmd.planId, plans);
  const next: Subscription = {
    ...s,
    planId: plan.id,
    status: s.status === "trialing" ? "active" : s.status,
    trialEndsAt: null,
    updatedAt: now,
  };
  await repo.save(next);
  return next;
}
