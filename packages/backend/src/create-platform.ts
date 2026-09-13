import { createPlan, MODULE_CATALOG, Money, type CreatePlanCommand } from "@mezan/domain";
import { createSqlitePlatformStores, type SqlitePlatformStoresHandle } from "@mezan/persistence";

export interface CreatePlatformOptions {
  readonly dbPath?: string;
  readonly now?: () => Date;
}

export interface PlatformHandle {
  readonly stores: SqlitePlatformStoresHandle;
  seedPlansIfEmpty(): Promise<void>;
  close(): void;
}

const CORE_MODULES = ["dashboard", "accounting", "sales", "purchases", "inventory", "treasury", "transactions", "workflow", "audit", "admin", "notifications"];
const BUSINESS_MODULES = [...CORE_MODULES, "crm", "installments", "financial_papers", "field", "assets", "projects"];

type SeedPlan = Omit<CreatePlanCommand, "now">;

/**
 * Prices are 0 until the owner sets them — see the open decision in
 * docs/superpowers/specs/2026-09-13-saas-tenant-models-design.md §7.
 */
export const PLATFORM_SEED_PLANS: readonly SeedPlan[] = [
  {
    id: "PLAN-CORE", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: CORE_MODULES,
    seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    priceMonthly: Money.zero(), priceYearly: Money.zero(), trialDays: 14, isPublic: true, sortOrder: 1,
  },
  {
    id: "PLAN-BUSINESS", code: "business", nameAr: "الأعمال", nameEn: "Business", modules: BUSINESS_MODULES,
    seatsIncluded: 10, branchesIncluded: 3, warehousesIncluded: 3,
    priceMonthly: Money.zero(), priceYearly: Money.zero(), trialDays: 14, isPublic: true, sortOrder: 2,
  },
  {
    id: "PLAN-ENTERPRISE", code: "enterprise", nameAr: "المؤسسات", nameEn: "Enterprise", modules: [...MODULE_CATALOG],
    seatsIncluded: 25, branchesIncluded: 10, warehousesIncluded: 10,
    priceMonthly: Money.zero(), priceYearly: Money.zero(), trialDays: 14, isPublic: true, sortOrder: 3,
  },
];

export async function createPlatform(options: CreatePlatformOptions = {}): Promise<PlatformHandle> {
  const stores = createSqlitePlatformStores(options.dbPath ?? ":memory:");
  const now = options.now ?? (() => new Date());
  const seedPlansIfEmpty = async () => {
    if ((await stores.plans.list()).length > 0) return;
    const stamp = now().toISOString();
    for (const plan of PLATFORM_SEED_PLANS) await createPlan({ ...plan, now: stamp }, stores.plans);
  };
  await seedPlansIfEmpty();
  return { stores, seedPlansIfEmpty, close: () => stores.close() };
}
