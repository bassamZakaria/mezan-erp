import { randomUUID } from "node:crypto";
import { SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE, createPlan, createPlatformUser, MODULE_CATALOG, Money, PlanKind, QuotaKind, type AuditSink, type CreatePlanCommand, type SecretHasher } from "@mezan/domain";
import { reportTurnYield } from "@mezan/api";
import {
  createSqlitePlatformStores, createSqliteAuditSink, createScryptHasher, createPlatformStores, createAuditSink, sqliteDb,
  ensurePlatformSchema, ensureAuditSchema, ensureAttemptSchema, ensureSessionSchema, ensureRateWindowSchema, ensureTenantRetentionSchema,
  type PlatformStoresHandle, type SqlitePlatformStoresHandle, type SqliteConnectionInput, type SqliteOpenOptions, type SqlDb,
  securityFallbackFor,
} from "@mezan/persistence";

export interface CreatePlatformOptions {
  readonly dbPath?: SqliteConnectionInput;
  readonly now?: () => Date;
  readonly owner?: { readonly email: string; readonly password: string };
  readonly hasher?: SecretHasher;
  readonly connection?: SqliteOpenOptions;
  readonly db?: SqlDb;
  readonly auditChainKey?: string;
  readonly fallbackBase?: string;
}

export interface PlatformStores extends PlatformStoresHandle {
  readonly db: SqlDb;
  readonly sqlite?: SqlitePlatformStoresHandle["sqlite"];
}

export class PlatformBackupUnavailableError extends Error {
  constructor() {
    super("The platform database is on Postgres: it is backed up with pg_dump, not by the server.");
  }
}

export interface PlatformHandle {
  readonly stores: PlatformStores;
  readonly audit: AuditSink;
  readonly hasher: SecretHasher;
  readonly ownerSeeded: boolean;
  inTheTurn<T>(label: string, work: () => Promise<T>): Promise<T>;
  outsideTheTurn<T>(work: () => Promise<T>): Promise<T>;
  seedPlansIfEmpty(): Promise<void>;
  /** Copies the live platform database to `destination` via better-sqlite3's online backup API. */
  backupTo(destination: string): Promise<void>;
  close(): void;
}

const CORE_MODULES = ["accounting", "sales", "purchases", "inventory", "treasury", "workflow", "audit", "admin", "notifications"];
/** DEC-31 §3.3 — the Free plan's modules. Business call, editable in the platform console. */
const FREE_MODULES = ["accounting", "sales", "purchases", "inventory", "treasury"];
const BUSINESS_MODULES = [...CORE_MODULES, "crm", "installments", "financial_papers", "field", "assets", "projects"];

type SeedPlan = Omit<CreatePlanCommand, "now">;

export const PLATFORM_SEED_PLANS: readonly SeedPlan[] = [
  {
    id: "PLAN-FREE", code: "free", nameAr: "المجانية", nameEn: "Free", kind: PlanKind.Free, modules: FREE_MODULES,
    seatsIncluded: 2, branchesIncluded: 1, warehousesIncluded: 1,
    quotas: { [QuotaKind.SalesInvoicesPerMonth]: 100 },
    priceMonthly: Money.fromMajor("0"), priceYearly: Money.fromMajor("0"), trialDays: 0, isPublic: true, sortOrder: 0,
  },
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
    features: { [SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE]: true },
    priceMonthly: Money.fromMajor("1960"), priceYearly: Money.fromMajor("19600"), trialDays: 14, isPublic: true, sortOrder: 3,
  },
];

// Every platform table, created empty: no plan and no owner is seeded here.
export async function ensurePlatformTables(db: SqlDb): Promise<void> {
  await ensurePlatformSchema(db);
  await ensureAuditSchema(db);
  await ensureAttemptSchema(db);
  await ensureSessionSchema(db);
  await ensureRateWindowSchema(db);
  await ensureTenantRetentionSchema(db);
}

async function openPlatformStores(options: CreatePlatformOptions) {
  if (options.db) {
    const db = options.db;
    await ensurePlatformTables(db);
    const audit = createAuditSink(db, { chainKey: options.auditChainKey });
    audit.unrecorded = securityFallbackFor(options.fallbackBase);
    const stores: PlatformStores = { ...createPlatformStores(db), db };
    return {
      stores,
      audit,
      outsideTheTurn: <T>(work: () => Promise<T>): Promise<T> => work(),
      inTheTurn: <T>(_label: string, work: () => Promise<T>): Promise<T> => work(),
      backupTo: async (_destination: string): Promise<void> => { throw new PlatformBackupUnavailableError(); },
      close: (): void => undefined,
    };
  }
  const sqliteStores = createSqlitePlatformStores(options.dbPath ?? ":memory:", options.connection);
  const audit = createSqliteAuditSink(sqliteStores.sqlite);
  audit.unrecorded = securityFallbackFor(options.dbPath);
  const stores: PlatformStores = { ...sqliteStores, db: sqliteDb(sqliteStores.sqlite) };
  return {
    stores,
    audit,
    outsideTheTurn: <T>(work: () => Promise<T>): Promise<T> => audit.outsideTurn(work),
    inTheTurn: <T>(label: string, work: () => Promise<T>): Promise<T> =>
      audit.turn(work, { onYield: () => reportTurnYield(`platform ${label}`) }),
    backupTo: (destination: string): Promise<void> => sqliteStores.sqlite.backup(destination).then(() => undefined),
    close: (): void => { sqliteStores.close(); audit.close(); },
  };
}

export async function createPlatform(options: CreatePlatformOptions = {}): Promise<PlatformHandle> {
  const { stores, audit, outsideTheTurn, inTheTurn, backupTo, close } = await openPlatformStores(options);
  if (!options.db) {
    await ensureAttemptSchema(stores.db);
    await ensureSessionSchema(stores.db);
    await ensureRateWindowSchema(stores.db);
    await ensureTenantRetentionSchema(stores.db);
  }
  const now = options.now ?? (() => new Date());
  const slowHasher = options.hasher ?? createScryptHasher();
  const hasher: SecretHasher = {
    hash: (secret) => outsideTheTurn(() => slowHasher.hash(secret)),
    verify: (secret, stored) => outsideTheTurn(() => slowHasher.verify(secret, stored)),
  };
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
    inTheTurn,
    outsideTheTurn,
    seedPlansIfEmpty,
    backupTo,
    close,
  };
}
