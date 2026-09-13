import { Money } from "../money/money.js";
import { isKnownModule } from "./module-catalog.js";
import { isValidSlug } from "./slug.js";
import { isCount, isoTimestamp } from "./validation.js";
import { InvalidPlanError, PlanCodeTakenError, PlanInUseError, PlanNotFoundError } from "./errors.js";

export type PlanStatus = "active" | "retired";

export interface Plan {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly modules: readonly string[];
  readonly features: Readonly<Record<string, boolean>>;
  readonly seatsIncluded: number;
  readonly branchesIncluded: number;
  readonly warehousesIncluded: number;
  readonly priceMonthly: Money;
  readonly priceYearly: Money;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly sortOrder: number;
  readonly status: PlanStatus;
  readonly createdAt: string;
}

export interface PlanRepository {
  findById(id: string): Promise<Plan | null>;
  findByCode(code: string): Promise<Plan | null>;
  list(): Promise<Plan[]>;
  save(plan: Plan): Promise<void>;
}

export interface CreatePlanCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly modules: readonly string[];
  readonly features?: Readonly<Record<string, boolean>>;
  readonly seatsIncluded: number;
  readonly branchesIncluded: number;
  readonly warehousesIncluded: number;
  readonly priceMonthly: Money;
  readonly priceYearly: Money;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly sortOrder: number;
  readonly now: string;
}

export type UpdatePlanCommand = { readonly id: string } & Partial<
  Pick<Plan, "nameAr" | "nameEn" | "modules" | "features" | "seatsIncluded" | "branchesIncluded" | "warehousesIncluded" | "priceMonthly" | "priceYearly" | "trialDays" | "isPublic" | "sortOrder">
>;

export type HasLiveSubscribers = (planId: string) => Promise<boolean>;

export function dedupeModules(modules: readonly string[]): string[] {
  return [...new Set(modules)];
}

function validate(plan: Omit<Plan, "status" | "createdAt">): string[] {
  const reasons: string[] = [];
  if (plan.id.trim() === "") reasons.push("id is required");
  if (!isValidSlug(plan.code)) reasons.push("code must be a slug of 3 to 32 lower-case letters, digits or inner hyphens");
  if (plan.nameAr.trim() === "") reasons.push("nameAr is required");
  if (plan.nameEn.trim() === "") reasons.push("nameEn is required");
  if (plan.modules.length === 0) reasons.push("at least one module is required");
  for (const m of plan.modules) if (!isKnownModule(m)) reasons.push(`unknown module "${m}"`);
  if (!isCount(plan.seatsIncluded, 1)) reasons.push("seatsIncluded must be an integer of at least 1");
  if (!isCount(plan.branchesIncluded, 1)) reasons.push("branchesIncluded must be an integer of at least 1");
  if (!isCount(plan.warehousesIncluded, 1)) reasons.push("warehousesIncluded must be an integer of at least 1");
  if (plan.priceMonthly.scaled < 0n) reasons.push("priceMonthly must not be negative");
  if (plan.priceYearly.scaled < 0n) reasons.push("priceYearly must not be negative");
  if (!isCount(plan.trialDays, 0)) reasons.push("trialDays must be an integer of at least 0");
  if (!Number.isInteger(plan.sortOrder)) reasons.push("sortOrder must be an integer");
  return reasons;
}

export async function createPlan(cmd: CreatePlanCommand, repo: PlanRepository): Promise<Plan> {
  const now = isoTimestamp(cmd.now);
  const draft: Omit<Plan, "status" | "createdAt"> = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr.trim(),
    nameEn: cmd.nameEn.trim(),
    modules: dedupeModules(cmd.modules),
    features: { ...(cmd.features ?? {}) },
    seatsIncluded: cmd.seatsIncluded,
    branchesIncluded: cmd.branchesIncluded,
    warehousesIncluded: cmd.warehousesIncluded,
    priceMonthly: cmd.priceMonthly,
    priceYearly: cmd.priceYearly,
    trialDays: cmd.trialDays,
    isPublic: cmd.isPublic,
    sortOrder: cmd.sortOrder,
  };
  const reasons = validate(draft);
  if (!now) reasons.push("now must be an ISO-8601 timestamp");
  if (!now || reasons.length > 0) throw new InvalidPlanError(reasons);
  if (await repo.findByCode(cmd.code)) throw new PlanCodeTakenError(cmd.code);
  const candidate: Plan = { ...draft, status: "active", createdAt: now };
  await repo.save(candidate);
  return candidate;
}

export async function updatePlan(
  cmd: UpdatePlanCommand,
  repo: PlanRepository,
  hasLiveSubscribers: HasLiveSubscribers,
): Promise<Plan> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new PlanNotFoundError(cmd.id);
  const next: Plan = {
    ...current,
    nameAr: (cmd.nameAr ?? current.nameAr).trim(),
    nameEn: (cmd.nameEn ?? current.nameEn).trim(),
    modules: dedupeModules(cmd.modules ?? current.modules),
    features: { ...(cmd.features ?? current.features) },
    seatsIncluded: cmd.seatsIncluded ?? current.seatsIncluded,
    branchesIncluded: cmd.branchesIncluded ?? current.branchesIncluded,
    warehousesIncluded: cmd.warehousesIncluded ?? current.warehousesIncluded,
    priceMonthly: cmd.priceMonthly ?? current.priceMonthly,
    priceYearly: cmd.priceYearly ?? current.priceYearly,
    trialDays: cmd.trialDays ?? current.trialDays,
    isPublic: cmd.isPublic ?? current.isPublic,
    sortOrder: cmd.sortOrder ?? current.sortOrder,
  };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidPlanError(reasons);
  const removed = current.modules.filter((m) => !next.modules.includes(m));
  if (removed.length > 0 && (await hasLiveSubscribers(current.id))) {
    throw new PlanInUseError(current.id, removed);
  }
  await repo.save(next);
  return next;
}

export async function retirePlan(cmd: { readonly id: string }, repo: PlanRepository): Promise<Plan> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new PlanNotFoundError(cmd.id);
  if (current.status === "retired") return current;
  const next: Plan = { ...current, status: "retired" };
  await repo.save(next);
  return next;
}
