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

export enum SubscriptionStatusKind {
  Trialing = "trialing",
  Active = "active",
  PastDue = "past_due",
  Suspended = "suspended",
  Cancelled = "cancelled",
}

export type SubscriptionStatus = `${SubscriptionStatusKind}`;

export const RENEWABLE_SUBSCRIPTION_STATES: readonly SubscriptionStatus[] = [
  SubscriptionStatusKind.Trialing,
  SubscriptionStatusKind.Active,
  SubscriptionStatusKind.PastDue,
];

export enum SubscriptionTransition {
  TrialEndedToFree = "TRIAL_ENDED_TO_FREE",
  ModuleTrialStarted = "MODULE_TRIAL_STARTED",
  SeatsSelected = "SEATS_SELECTED",
}

export enum PlanChangeActor {
  ReverseTrial = "reverse-trial",
}
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
  /**
   * The plan this subscription was on before its last plan change.
   *
   * WITHOUT THIS THE DROP TO FREE ERASES ITS OWN HISTORY: the row is rewritten
   * in place, so after day 15 nothing in the platform database says the tenant
   * ever held the top plan — and DEC-31 rule 5 ("a module that leaves the plan
   * becomes read-only, not forbidden") has nothing to read. Every module the
   * tenant may still READ is derived from this.
   */
  readonly previousPlanId: string | null;
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
  /** Every live (non-cancelled) subscription on this plan, across all tenants. */
  listByPlan(planId: string): Promise<Subscription[]>;
  save(subscription: Subscription): Promise<void>;
}

export interface SubscriptionTransitionRepository extends SubscriptionRepository {
  /** Every live subscription still `trialing` whose trial ended at or before `nowIso`. */
  listEndedTrials(nowIso: string): Promise<Subscription[]>;
  /**
   * Writes `after` only if the stored row still equals `before` (status, plan and
   * `updatedAt`), then runs `sideEffect` in the SAME transaction. False when
   * another writer moved the row first; nothing is written then.
   */
  compareAndSet(before: Subscription, after: Subscription, sideEffect: () => Promise<void>): Promise<boolean>;
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

export function trialHasEnded(s: Subscription, nowIso: string): boolean {
  return s.status === "trialing" && s.trialEndsAt !== null && s.trialEndsAt <= nowIso;
}

/** The subscription after a reverse trial lands on the Free plan. Pure; the caller persists it with `compareAndSet`. */
export function applyTrialEndToFree(s: Subscription, freePlanId: string, nowIso: string): Subscription {
  if (!trialHasEnded(s, nowIso)) throw new InvalidSubscriptionTransitionError(s.status, "active");
  const endedAt = s.trialEndsAt!;
  return {
    ...s,
    planId: freePlanId,
    previousPlanId: s.planId,
    status: "active",
    trialEndsAt: null,
    billingCycle: "monthly",
    currentPeriodStart: endedAt,
    currentPeriodEnd: addPeriod(endedAt, "monthly"),
    updatedAt: nowIso,
  };
}

/**
 * INVARIANT — every reader of a subscription must go through this before deriving
 * entitlements or a licence state. The drop to Free is materialised lazily, so the
 * stored row can still say `trialing` after the trial ended; this function is the
 * single definition of what the subscription IS at `nowIso`, and persisting the
 * move is only caching what it already returns. A reader that skipped it would
 * hand a lapsed trial the top plan's modules.
 */
export function effectiveSubscription(
  s: Subscription | null,
  freePlanId: string | null,
  nowIso: string,
): Subscription | null {
  if (!s || freePlanId === null || !trialHasEnded(s, nowIso)) return s;
  return applyTrialEndToFree(s, freePlanId, nowIso);
}

/** True when the stored row still has to be written back to match `effectiveSubscription`. */
export function needsTrialEndMaterialised(s: Subscription | null, freePlanId: string | null, nowIso: string): boolean {
  return s !== null && freePlanId !== null && trialHasEnded(s, nowIso);
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
  for (const m of s.addOnModules) if (!isKnownModule(m)) reasons.push(`وحدة إضافية غير معروفة "${m}"`);
  if (!isCount(s.extraSeats, 0)) reasons.push("عدد المقاعد الإضافية يجب أن يكون رقمًا صحيحًا لا يقل عن 0");
  if (!isCount(s.extraBranches, 0)) reasons.push("عدد الفروع الإضافية يجب أن يكون رقمًا صحيحًا لا يقل عن 0");
  if (!isCount(s.extraWarehouses, 0)) reasons.push("عدد المخازن الإضافية يجب أن يكون رقمًا صحيحًا لا يقل عن 0");
  if (!isCount(s.graceDays, 0)) reasons.push("أيام السماح يجب أن تكون رقمًا صحيحًا لا يقل عن 0");
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
  if (cmd.id.trim() === "" || cmd.tenantId.trim() === "") reasons.push("المعرّف ومعرّف المنشأة مطلوبان");
  if (!now) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
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
    previousPlanId: null,
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
  if (!now) throw new InvalidSubscriptionError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  return now;
}

/** The subscription one paid period later — pure, so a caller can persist it inside its own transaction. */
export function applyRenewal(s: Subscription, nowIso: string): Subscription {
  const now = requireNow({ id: s.id, now: nowIso });
  assertFrom(s, RENEWABLE_SUBSCRIPTION_STATES, "active");
  const lapsed = s.currentPeriodEnd < now;
  const periodStart = lapsed ? now : s.currentPeriodEnd;
  return {
    ...s,
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: periodStart,
    currentPeriodEnd: addPeriod(periodStart, s.billingCycle),
    updatedAt: now,
  };
}

export async function renewSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const next = applyRenewal(s, cmd.now);
  await repo.save(next);
  return next;
}

export async function markPastDue(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  const now = requireNow(cmd);
  assertFrom(s, ["active"], "past_due");
  if (now < s.currentPeriodEnd) {
    throw new InvalidSubscriptionError([`الفترة الحالية لم تنتهِ بعد (تنتهي في ${s.currentPeriodEnd})`]);
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
    previousPlanId: plan.id === s.planId ? s.previousPlanId : s.planId,
    status: s.status === "trialing" ? "active" : s.status,
    trialEndsAt: null,
    updatedAt: now,
  };
  await repo.save(next);
  return next;
}
