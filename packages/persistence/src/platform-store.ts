import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput, type SqliteOpenOptions } from "./sqlite-connection.js";
import {
  Money,
  type Plan, type PlanRepository,
  type PlatformUser, type PlatformUserRepository,
  type Subscription, type SubscriptionRepository,
  type Tenant, type TenantRepository,
} from "@mezan/domain";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS tenant (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  owner_email  TEXT NOT NULL,
  status       TEXT NOT NULL,
  db_file      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_code ON tenant(code);

CREATE TABLE IF NOT EXISTS plan (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL,
  name_ar              TEXT NOT NULL,
  name_en              TEXT NOT NULL,
  modules              TEXT NOT NULL,
  features             TEXT NOT NULL,
  seats_included       INTEGER NOT NULL,
  branches_included    INTEGER NOT NULL,
  warehouses_included  INTEGER NOT NULL,
  price_monthly        INTEGER NOT NULL,
  price_yearly         INTEGER NOT NULL,
  trial_days           INTEGER NOT NULL,
  is_public            INTEGER NOT NULL,
  sort_order           INTEGER NOT NULL,
  status               TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_code ON plan(code);

CREATE TABLE IF NOT EXISTS subscription (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  plan_id               TEXT NOT NULL,
  status                TEXT NOT NULL,
  billing_cycle         TEXT NOT NULL,
  add_on_modules        TEXT NOT NULL,
  extra_seats           INTEGER NOT NULL,
  extra_branches        INTEGER NOT NULL,
  extra_warehouses      INTEGER NOT NULL,
  current_period_start  TEXT NOT NULL,
  current_period_end    TEXT NOT NULL,
  trial_ends_at         TEXT,
  grace_days            INTEGER NOT NULL,
  cancelled_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_tenant ON subscription(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plan ON subscription(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_one_live
  ON subscription(tenant_id) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS platform_user (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_user_email ON platform_user(email);
`;

interface TenantRow {
  id: string; code: string; name_ar: string; name_en: string | null; owner_email: string;
  status: Tenant["status"]; db_file: string; created_at: string; updated_at: string;
}

function toTenant(r: TenantRow): Tenant {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en, ownerEmail: r.owner_email,
    status: r.status, dbFile: r.db_file, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

class SqliteTenantStore implements TenantRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byCode: Database.Statement;
  private readonly all: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO tenant (id, code, name_ar, name_en, owner_email, status, db_file, created_at, updated_at)
       VALUES (@id, @code, @nameAr, @nameEn, @ownerEmail, @status, @dbFile, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, name_en = @nameEn, owner_email = @ownerEmail,
         status = @status, db_file = @dbFile, created_at = @createdAt, updated_at = @updatedAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM tenant WHERE id = ?`);
    this.byCode = sqlite.prepare(`SELECT * FROM tenant WHERE code = ?`);
    this.all = sqlite.prepare(`SELECT * FROM tenant ORDER BY created_at, id`);
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = this.byId.get(id) as TenantRow | undefined;
    return row ? toTenant(row) : null;
  }

  async findByCode(code: string): Promise<Tenant | null> {
    const row = this.byCode.get(code) as TenantRow | undefined;
    return row ? toTenant(row) : null;
  }

  async list(): Promise<Tenant[]> {
    return (this.all.all() as TenantRow[]).map(toTenant);
  }

  async save(t: Tenant): Promise<void> {
    this.upsert.run({
      id: t.id, code: t.code, nameAr: t.nameAr, nameEn: t.nameEn, ownerEmail: t.ownerEmail,
      status: t.status, dbFile: t.dbFile, createdAt: t.createdAt, updatedAt: t.updatedAt,
    });
  }
}

interface PlanRow {
  id: string; code: string; name_ar: string; name_en: string; modules: string; features: string;
  seats_included: number; branches_included: number; warehouses_included: number;
  price_monthly: number; price_yearly: number; trial_days: number; is_public: number;
  sort_order: number; status: Plan["status"]; created_at: string;
}

function toPlan(r: PlanRow): Plan {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en,
    modules: JSON.parse(r.modules) as string[],
    features: JSON.parse(r.features) as Record<string, boolean>,
    seatsIncluded: r.seats_included, branchesIncluded: r.branches_included, warehousesIncluded: r.warehouses_included,
    priceMonthly: Money.fromScaled(r.price_monthly), priceYearly: Money.fromScaled(r.price_yearly),
    trialDays: r.trial_days, isPublic: r.is_public === 1, sortOrder: r.sort_order,
    status: r.status, createdAt: r.created_at,
  };
}

class SqlitePlanStore implements PlanRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byCode: Database.Statement;
  private readonly all: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO plan (id, code, name_ar, name_en, modules, features, seats_included, branches_included,
         warehouses_included, price_monthly, price_yearly, trial_days, is_public, sort_order, status, created_at)
       VALUES (@id, @code, @nameAr, @nameEn, @modules, @features, @seatsIncluded, @branchesIncluded,
         @warehousesIncluded, @priceMonthly, @priceYearly, @trialDays, @isPublic, @sortOrder, @status, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, name_en = @nameEn, modules = @modules, features = @features,
         seats_included = @seatsIncluded, branches_included = @branchesIncluded, warehouses_included = @warehousesIncluded,
         price_monthly = @priceMonthly, price_yearly = @priceYearly, trial_days = @trialDays, is_public = @isPublic,
         sort_order = @sortOrder, status = @status, created_at = @createdAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM plan WHERE id = ?`);
    this.byCode = sqlite.prepare(`SELECT * FROM plan WHERE code = ?`);
    this.all = sqlite.prepare(`SELECT * FROM plan ORDER BY sort_order, code`);
  }

  async findById(id: string): Promise<Plan | null> {
    const row = this.byId.get(id) as PlanRow | undefined;
    return row ? toPlan(row) : null;
  }

  async findByCode(code: string): Promise<Plan | null> {
    const row = this.byCode.get(code) as PlanRow | undefined;
    return row ? toPlan(row) : null;
  }

  async list(): Promise<Plan[]> {
    return (this.all.all() as PlanRow[]).map(toPlan);
  }

  async save(p: Plan): Promise<void> {
    this.upsert.run({
      id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn,
      modules: JSON.stringify(p.modules), features: JSON.stringify(p.features),
      seatsIncluded: p.seatsIncluded, branchesIncluded: p.branchesIncluded, warehousesIncluded: p.warehousesIncluded,
      priceMonthly: p.priceMonthly.toScaledNumber(), priceYearly: p.priceYearly.toScaledNumber(),
      trialDays: p.trialDays, isPublic: p.isPublic ? 1 : 0, sortOrder: p.sortOrder,
      status: p.status, createdAt: p.createdAt,
    });
  }
}

interface SubscriptionRow {
  id: string; tenant_id: string; plan_id: string; status: Subscription["status"];
  billing_cycle: Subscription["billingCycle"]; add_on_modules: string;
  extra_seats: number; extra_branches: number; extra_warehouses: number;
  current_period_start: string; current_period_end: string; trial_ends_at: string | null;
  grace_days: number; cancelled_at: string | null; created_at: string; updated_at: string;
}

function toSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id, tenantId: r.tenant_id, planId: r.plan_id, status: r.status, billingCycle: r.billing_cycle,
    addOnModules: JSON.parse(r.add_on_modules) as string[],
    extraSeats: r.extra_seats, extraBranches: r.extra_branches, extraWarehouses: r.extra_warehouses,
    currentPeriodStart: r.current_period_start, currentPeriodEnd: r.current_period_end,
    trialEndsAt: r.trial_ends_at, graceDays: r.grace_days, cancelledAt: r.cancelled_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

class SqliteSubscriptionStore implements SubscriptionRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly liveByTenant: Database.Statement;
  private readonly byTenant: Database.Statement;
  private readonly liveByPlan: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO subscription (id, tenant_id, plan_id, status, billing_cycle, add_on_modules, extra_seats,
         extra_branches, extra_warehouses, current_period_start, current_period_end, trial_ends_at, grace_days,
         cancelled_at, created_at, updated_at)
       VALUES (@id, @tenantId, @planId, @status, @billingCycle, @addOnModules, @extraSeats, @extraBranches,
         @extraWarehouses, @currentPeriodStart, @currentPeriodEnd, @trialEndsAt, @graceDays, @cancelledAt,
         @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = @tenantId, plan_id = @planId, status = @status, billing_cycle = @billingCycle,
         add_on_modules = @addOnModules, extra_seats = @extraSeats, extra_branches = @extraBranches,
         extra_warehouses = @extraWarehouses, current_period_start = @currentPeriodStart,
         current_period_end = @currentPeriodEnd, trial_ends_at = @trialEndsAt, grace_days = @graceDays,
         cancelled_at = @cancelledAt, created_at = @createdAt, updated_at = @updatedAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM subscription WHERE id = ?`);
    this.liveByTenant = sqlite.prepare(`SELECT * FROM subscription WHERE tenant_id = ? AND status <> 'cancelled'`);
    this.byTenant = sqlite.prepare(`SELECT * FROM subscription WHERE tenant_id = ? ORDER BY created_at, id`);
    this.liveByPlan = sqlite.prepare(`SELECT 1 FROM subscription WHERE plan_id = ? AND status <> 'cancelled' LIMIT 1`);
  }

  async findById(id: string): Promise<Subscription | null> {
    const row = this.byId.get(id) as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  async findLiveByTenant(tenantId: string): Promise<Subscription | null> {
    const row = this.liveByTenant.get(tenantId) as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  async listByTenant(tenantId: string): Promise<Subscription[]> {
    return (this.byTenant.all(tenantId) as SubscriptionRow[]).map(toSubscription);
  }

  async hasLiveByPlan(planId: string): Promise<boolean> {
    return this.liveByPlan.get(planId) !== undefined;
  }

  async save(s: Subscription): Promise<void> {
    this.upsert.run({
      id: s.id, tenantId: s.tenantId, planId: s.planId, status: s.status, billingCycle: s.billingCycle,
      addOnModules: JSON.stringify(s.addOnModules), extraSeats: s.extraSeats, extraBranches: s.extraBranches,
      extraWarehouses: s.extraWarehouses, currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd,
      trialEndsAt: s.trialEndsAt, graceDays: s.graceDays, cancelledAt: s.cancelledAt,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    });
  }
}

interface PlatformUserRow {
  id: string; email: string; password_hash: string; role: PlatformUser["role"];
  status: PlatformUser["status"]; created_at: string;
}

function toPlatformUser(r: PlatformUserRow): PlatformUser {
  return { id: r.id, email: r.email, passwordHash: r.password_hash, role: r.role, status: r.status, createdAt: r.created_at };
}

class SqlitePlatformUserStore implements PlatformUserRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byEmail: Database.Statement;
  private readonly all: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO platform_user (id, email, password_hash, role, status, created_at)
       VALUES (@id, @email, @passwordHash, @role, @status, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         email = @email, password_hash = @passwordHash, role = @role, status = @status, created_at = @createdAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM platform_user WHERE id = ?`);
    this.byEmail = sqlite.prepare(`SELECT * FROM platform_user WHERE email = ?`);
    this.all = sqlite.prepare(`SELECT * FROM platform_user ORDER BY created_at, id`);
  }

  async findById(id: string): Promise<PlatformUser | null> {
    const row = this.byId.get(id) as PlatformUserRow | undefined;
    return row ? toPlatformUser(row) : null;
  }

  async findByEmail(email: string): Promise<PlatformUser | null> {
    const row = this.byEmail.get(email) as PlatformUserRow | undefined;
    return row ? toPlatformUser(row) : null;
  }

  async list(): Promise<PlatformUser[]> {
    return (this.all.all() as PlatformUserRow[]).map(toPlatformUser);
  }

  async save(u: PlatformUser): Promise<void> {
    this.upsert.run({
      id: u.id, email: u.email, passwordHash: u.passwordHash, role: u.role,
      status: u.status, createdAt: u.createdAt,
    });
  }
}

export interface SqlitePlatformStoresHandle {
  readonly tenants: TenantRepository;
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly platformUsers: PlatformUserRepository;
  close(): void;
}

export function createSqlitePlatformStores(
  path: SqliteConnectionInput = ":memory:",
  options: SqliteOpenOptions = {},
): SqlitePlatformStoresHandle {
  const { sqlite, owned } = openSqliteConnection(path, options);
  sqlite.exec(CREATE_TABLES);
  return {
    tenants: new SqliteTenantStore(sqlite),
    plans: new SqlitePlanStore(sqlite),
    subscriptions: new SqliteSubscriptionStore(sqlite),
    platformUsers: new SqlitePlatformUserStore(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
