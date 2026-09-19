import { randomUUID } from "node:crypto";
import { createPlan, createPlatformUser, MODULE_CATALOG, Money, type AuditSink, type CreatePlanCommand, type SecretHasher } from "@mezan/domain";
import {
  createSqlitePlatformStores, createSqliteAuditSink, createScryptHasher,
  type SqlitePlatformStoresHandle, type SqliteConnectionInput, type SqliteOpenOptions,
} from "@mezan/persistence";

export interface CreatePlatformOptions {
  readonly dbPath?: SqliteConnectionInput;
  readonly now?: () => Date;
  readonly owner?: { readonly email: string; readonly password: string };
  readonly hasher?: SecretHasher;
  readonly connection?: SqliteOpenOptions;
}

export interface PlatformHandle {
  readonly stores: SqlitePlatformStoresHandle;
  readonly audit: AuditSink;
  readonly hasher: SecretHasher;
  readonly ownerSeeded: boolean;
  seedPlansIfEmpty(): Promise<void>;
  /** Copies the live platform database to `destination` via better-sqlite3's online backup API. */
  backupTo(destination: string): Promise<void>;
  close(): void;
}

const CORE_MODULES = ["accounting", "sales", "purchases", "inventory", "treasury", "workflow", "audit", "admin", "notifications"];
const BUSINESS_MODULES = [...CORE_MODULES, "crm", "installments", "financial_papers", "field", "assets", "projects"];

type SeedPlan = Omit<CreatePlanCommand, "now">;

export const PLATFORM_SEED_PLANS: readonly SeedPlan[] = [
  {
    id: "PLAN-CORE", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: CORE_MODULES,
    seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"), trialDays: 14, isPublic: true, sortOrder: 1,
  },
  {
    id: "PLAN-BUSINESS", code: "business", nameAr: "الأعمال", nameEn: "Business", modules: BUSINESS_MODULES,
    seatsIncluded: 10, branchesIncluded: 3, warehousesIncluded: 3,
    priceMonthly: Money.fromMajor("980"), priceYearly: Money.fromMajor("9800"), trialDays: 14, isPublic: true, sortOrder: 2,
  },
  {
    id: "PLAN-ENTERPRISE", code: "enterprise", nameAr: "المؤسسات", nameEn: "Enterprise", modules: MODULE_CATALOG.filter((id) => id !== "pos"),
    seatsIncluded: 25, branchesIncluded: 10, warehousesIncluded: 10,
    priceMonthly: Money.fromMajor("1960"), priceYearly: Money.fromMajor("19600"), trialDays: 14, isPublic: true, sortOrder: 3,
  },
];

export async function createPlatform(options: CreatePlatformOptions = {}): Promise<PlatformHandle> {
  const stores = createSqlitePlatformStores(options.dbPath ?? ":memory:", options.connection);
  const now = options.now ?? (() => new Date());
  const hasher = options.hasher ?? createScryptHasher();
  const audit = createSqliteAuditSink(stores.sqlite);
  const seedPlansIfEmpty = async () => {
    const stamp = now().toISOString();
    for (const plan of PLATFORM_SEED_PLANS) {
      if (await stores.plans.findByCode(plan.code)) continue;
      await createPlan({ ...plan, now: stamp }, stores.plans);
    }
  };
  await seedPlansIfEmpty();

  let ownerSeeded = false;
  if (options.owner) {
    const existing = await stores.platformUsers.list();
    if (existing.length === 0) {
      await createPlatformUser(
        { id: randomUUID(), email: options.owner.email, password: options.owner.password, role: "owner", now: now().toISOString() },
        stores.platformUsers,
        hasher,
      );
      ownerSeeded = true;
    }
  }

  return {
    stores,
    audit,
    hasher,
    ownerSeeded,
    seedPlansIfEmpty,
    backupTo: (destination) => stores.sqlite.backup(destination).then(() => undefined),
    close: () => { stores.close(); audit.close(); },
  };
}
