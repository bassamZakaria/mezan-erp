import { FREE_SUB_MODULES, parentOf } from "../entitlements/sub-modules.js";
import { Money } from "../money/money.js";
import { isKnownModule } from "./module-catalog.js";
import { isValidSlug } from "./slug.js";
import { isCount, isoTimestamp } from "./validation.js";
import { FreePlanRemoval, FreePlanRequiredError, InvalidPlanError, PlanCodeTakenError, PlanNotFoundError } from "./errors.js";

export enum PlanStatusCode {
  Active = "active",
  Retired = "retired",
}
export type PlanStatus = `${PlanStatusCode}`;

export enum PlanKind {
  Paid = "paid",
  Free = "free",
}

export enum QuotaKind {
  SalesInvoicesPerMonth = "sales_invoices_per_month",
}

export const QUOTA_KINDS: readonly QuotaKind[] = Object.values(QuotaKind);

export type PlanQuotas = Readonly<Partial<Record<QuotaKind, number>>>;

export interface Plan {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly kind: PlanKind;
  readonly modules: readonly string[];
  readonly features: Readonly<Record<string, boolean>>;
  readonly seatsIncluded: number;
  readonly branchesIncluded: number;
  readonly warehousesIncluded: number;
  readonly quotas: PlanQuotas;
  readonly priceMonthly: Money;
  readonly priceYearly: Money;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly soldOut?: boolean;
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
  readonly kind?: PlanKind;
  readonly modules: readonly string[];
  readonly features?: Readonly<Record<string, boolean>>;
  readonly seatsIncluded: number;
  readonly branchesIncluded: number;
  readonly warehousesIncluded: number;
  readonly quotas?: PlanQuotas;
  readonly priceMonthly: Money;
  readonly priceYearly: Money;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly soldOut?: boolean;
  readonly sortOrder: number;
  readonly now: string;
}

export type UpdatePlanCommand = { readonly id: string } & Partial<
  Pick<Plan, "nameAr" | "nameEn" | "kind" | "modules" | "features" | "seatsIncluded" | "branchesIncluded" | "warehousesIncluded" | "quotas" | "priceMonthly" | "priceYearly" | "trialDays" | "isPublic" | "soldOut" | "sortOrder">
>;

export function dedupeModules(modules: readonly string[]): string[] {
  return [...new Set(modules)];
}

/**
 * What a plan or licence stores: unique ids, no part whose parent is also
 * listed (the parent already grants it), no free part (every plan holds it).
 */
export function normaliseModules(modules: readonly string[]): string[] {
  const unique = dedupeModules(modules);
  return unique.filter((id) => {
    if (FREE_SUB_MODULES.has(id)) return false;
    const parent = parentOf(id);
    return parent === null || !unique.includes(parent);
  });
}

export function normalizeQuotas(quotas: PlanQuotas | undefined): PlanQuotas {
  const out: Partial<Record<QuotaKind, number>> = {};
  for (const kind of QUOTA_KINDS) {
    const value = quotas?.[kind];
    if (value !== undefined && value !== null) out[kind] = value;
  }
  return out;
}

export function isFreePlan(plan: Pick<Plan, "kind">): boolean {
  return plan.kind === PlanKind.Free;
}

function offered(plan: Plan): boolean {
  return plan.status === PlanStatusCode.Active && plan.isPublic && !plan.soldOut;
}

export function topPublicPaidPlan(plans: readonly Plan[]): Plan | null {
  const paid = plans.filter((p) => offered(p) && p.kind === PlanKind.Paid && p.trialDays > 0);
  return paid.reduce<Plan | null>((best, p) => (best === null || p.sortOrder > best.sortOrder ? p : best), null);
}

export function defaultFreePlan(plans: readonly Plan[]): Plan | null {
  const free = plans.filter((p) => p.status === "active" && p.kind === PlanKind.Free);
  const pick = (list: Plan[]) => list.reduce<Plan | null>((best, p) => (best === null || p.sortOrder < best.sortOrder ? p : best), null);
  return pick(free.filter((p) => p.isPublic)) ?? pick(free);
}

function validate(plan: Omit<Plan, "status" | "createdAt">): string[] {
  const reasons: string[] = [];
  if (plan.id.trim() === "") reasons.push("المعرّف مطلوب");
  if (!isValidSlug(plan.code)) reasons.push("الرمز يجب أن يكون من 3 إلى 32 حرفًا إنجليزيًا صغيرًا أو رقمًا أو شرطة داخلية");
  if (plan.nameAr.trim() === "") reasons.push("الاسم بالعربية مطلوب");
  if (plan.nameEn.trim() === "") reasons.push("الاسم بالإنجليزية مطلوب");
  if (plan.modules.length === 0) reasons.push("يجب اختيار وحدة واحدة على الأقل");
  for (const m of plan.modules) if (!isKnownModule(m)) reasons.push(`وحدة غير معروفة "${m}"`);
  if (!isCount(plan.seatsIncluded, 1)) reasons.push("عدد المقاعد يجب أن يكون رقمًا صحيحًا لا يقل عن 1");
  if (!isCount(plan.branchesIncluded, 1)) reasons.push("عدد الفروع يجب أن يكون رقمًا صحيحًا لا يقل عن 1");
  if (!isCount(plan.warehousesIncluded, 1)) reasons.push("عدد المخازن يجب أن يكون رقمًا صحيحًا لا يقل عن 1");
  if (plan.priceMonthly.scaled < 0n) reasons.push("السعر الشهري لا يمكن أن يكون سالبًا");
  if (plan.priceYearly.scaled < 0n) reasons.push("السعر السنوي لا يمكن أن يكون سالبًا");
  if (!isCount(plan.trialDays, 0)) reasons.push("عدد أيام التجربة يجب أن يكون رقمًا صحيحًا لا يقل عن 0");
  if (!Number.isInteger(plan.sortOrder)) reasons.push("ترتيب العرض يجب أن يكون رقمًا صحيحًا");
  if (!Object.values(PlanKind).includes(plan.kind)) reasons.push("نوع الباقة غير معروف");
  for (const [kind, value] of Object.entries(plan.quotas)) {
    if (!QUOTA_KINDS.includes(kind as QuotaKind)) reasons.push(`حد استخدام غير معروف "${kind}"`);
    else if (!isCount(value as number, 0)) reasons.push("حد الاستخدام يجب أن يكون رقمًا صحيحًا لا يقل عن 0");
  }
  if (plan.kind === PlanKind.Free) {
    if (plan.priceMonthly.scaled !== 0n || plan.priceYearly.scaled !== 0n) reasons.push("الباقة المجانية سعرها صفر");
    if (plan.trialDays !== 0) reasons.push("الباقة المجانية لا تحتاج أيام تجربة");
  }
  return reasons;
}

export async function createPlan(cmd: CreatePlanCommand, repo: PlanRepository): Promise<Plan> {
  const now = isoTimestamp(cmd.now);
  const draft: Omit<Plan, "status" | "createdAt"> = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr.trim(),
    nameEn: cmd.nameEn.trim(),
    kind: cmd.kind ?? PlanKind.Paid,
    modules: normaliseModules(cmd.modules),
    features: { ...(cmd.features ?? {}) },
    seatsIncluded: cmd.seatsIncluded,
    branchesIncluded: cmd.branchesIncluded,
    warehousesIncluded: cmd.warehousesIncluded,
    quotas: normalizeQuotas(cmd.quotas),
    priceMonthly: cmd.priceMonthly,
    priceYearly: cmd.priceYearly,
    trialDays: cmd.trialDays,
    isPublic: cmd.isPublic,
    soldOut: cmd.soldOut ?? false,
    sortOrder: cmd.sortOrder,
  };
  const reasons = validate(draft);
  if (!now) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!now || reasons.length > 0) throw new InvalidPlanError(reasons);
  if (await repo.findByCode(cmd.code)) throw new PlanCodeTakenError(cmd.code);
  const candidate: Plan = { ...draft, status: "active", createdAt: now };
  await repo.save(candidate);
  return candidate;
}

async function anotherFreePlanIsActive(id: string, repo: PlanRepository): Promise<boolean> {
  return (await repo.list()).some((p) => p.id !== id && p.kind === PlanKind.Free && p.status === PlanStatusCode.Active);
}

export async function updatePlan(
  cmd: UpdatePlanCommand,
  repo: PlanRepository,
): Promise<Plan> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new PlanNotFoundError(cmd.id);
  const next: Plan = {
    ...current,
    nameAr: (cmd.nameAr ?? current.nameAr).trim(),
    nameEn: (cmd.nameEn ?? current.nameEn).trim(),
    kind: cmd.kind ?? current.kind,
    modules: normaliseModules(cmd.modules ?? current.modules),
    features: { ...(cmd.features ?? current.features) },
    seatsIncluded: cmd.seatsIncluded ?? current.seatsIncluded,
    branchesIncluded: cmd.branchesIncluded ?? current.branchesIncluded,
    warehousesIncluded: cmd.warehousesIncluded ?? current.warehousesIncluded,
    quotas: normalizeQuotas(cmd.quotas ?? current.quotas),
    priceMonthly: cmd.priceMonthly ?? current.priceMonthly,
    priceYearly: cmd.priceYearly ?? current.priceYearly,
    trialDays: cmd.trialDays ?? current.trialDays,
    isPublic: cmd.isPublic ?? current.isPublic,
    soldOut: cmd.soldOut ?? current.soldOut ?? false,
    sortOrder: cmd.sortOrder ?? current.sortOrder,
  };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidPlanError(reasons);
  if (current.kind === PlanKind.Free && next.kind !== PlanKind.Free && current.status === PlanStatusCode.Active && !(await anotherFreePlanIsActive(current.id, repo))) {
    throw new FreePlanRequiredError(current.id, FreePlanRemoval.MadePaid);
  }
  await repo.save(next);
  return next;
}

export async function retirePlan(cmd: { readonly id: string }, repo: PlanRepository): Promise<Plan> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new PlanNotFoundError(cmd.id);
  if (current.status === "retired") return current;
  if (current.kind === PlanKind.Free && !(await anotherFreePlanIsActive(current.id, repo))) {
    throw new FreePlanRequiredError(current.id, FreePlanRemoval.Retired);
  }
  const next: Plan = { ...current, status: "retired" };
  await repo.save(next);
  return next;
}
