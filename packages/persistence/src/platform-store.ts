import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput, type SqliteOpenOptions } from "./sqlite-connection.js";
import {
  Money,
  type CardCheckout, type CardCheckoutRepository, type CardCheckoutSettlement, type CardCheckoutStatus,
  type PaymentProviderId,
  type Payment, type PaymentRepository,
  type Plan, type PlanRepository, type PlanQuotas, PlanKind,
  type ModuleTrial, type ModuleTrialRepository,
  type SubscriptionTransitionRepository,
  type PlatformUser, type PlatformUserRepository,
  type SignupRequest, type SignupRequestRepository, SignupRequestStatus,
  type Subscription,
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
  kind                 TEXT NOT NULL DEFAULT 'paid',
  quotas               TEXT NOT NULL DEFAULT '{}',
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
  previous_plan_id      TEXT,
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

CREATE TABLE IF NOT EXISTS payment (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  reference       TEXT NOT NULL,
  paid_at         TEXT NOT NULL,
  recorded_by     TEXT NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_tenant ON payment(tenant_id, paid_at);

CREATE TABLE IF NOT EXISTS card_checkout (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  subscription_id     TEXT NOT NULL,
  provider            TEXT NOT NULL,
  amount              INTEGER NOT NULL,
  currency            TEXT NOT NULL,
  status              TEXT NOT NULL,
  provider_order_ref  TEXT,
  checkout_url        TEXT,
  provider_ref        TEXT,
  payment_id          TEXT,
  failure_reason      TEXT,
  requested_by        TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_checkout_tenant ON card_checkout(tenant_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_checkout_provider_order
  ON card_checkout(provider, provider_order_ref) WHERE provider_order_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_provider_event (
  provider      TEXT NOT NULL,
  provider_ref  TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  PRIMARY KEY (provider, provider_ref)
);

CREATE TABLE IF NOT EXISTS signup_request (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  owner_email   TEXT NOT NULL,
  owner_name_ar TEXT NOT NULL,
  plan_id       TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  status        TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  verified_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_request_token ON signup_request(token_hash);

CREATE TABLE IF NOT EXISTS signup_provision_claim (
  token_hash TEXT PRIMARY KEY,
  claim_id   TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_request_code ON signup_request(code, status, expires_at);

CREATE TABLE IF NOT EXISTS module_trial (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  module      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  started_by  TEXT NOT NULL
);
-- Once per module per tenant is enforced HERE, not by a prior read: two
-- simultaneous "try this module" clicks must not both open a trial.
CREATE UNIQUE INDEX IF NOT EXISTS idx_module_trial_once ON module_trial(tenant_id, module);
`;

/** Columns added after the first release; an existing platform database is migrated in place. */
const ADDED_PLAN_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["kind", "TEXT NOT NULL DEFAULT 'paid'"],
  ["quotas", "TEXT NOT NULL DEFAULT '{}'"],
];

function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(plan)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, ddl] of ADDED_PLAN_COLUMNS) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE plan ADD COLUMN ${name} ${ddl}`);
  }
  const onSubscription = new Set(
    (sqlite.prepare(`PRAGMA table_info(subscription)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!onSubscription.has("previous_plan_id")) sqlite.exec(`ALTER TABLE subscription ADD COLUMN previous_plan_id TEXT`);
}

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
  kind: string; quotas: string;
  price_monthly: number; price_yearly: number; trial_days: number; is_public: number;
  sort_order: number; status: Plan["status"]; created_at: string;
}

function toPlan(r: PlanRow): Plan {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en,
    modules: JSON.parse(r.modules) as string[],
    features: JSON.parse(r.features) as Record<string, boolean>,
    seatsIncluded: r.seats_included, branchesIncluded: r.branches_included, warehousesIncluded: r.warehouses_included,
    kind: r.kind === PlanKind.Free ? PlanKind.Free : PlanKind.Paid,
    quotas: JSON.parse(r.quotas || "{}") as PlanQuotas,
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
         warehouses_included, kind, quotas, price_monthly, price_yearly, trial_days, is_public, sort_order, status, created_at)
       VALUES (@id, @code, @nameAr, @nameEn, @modules, @features, @seatsIncluded, @branchesIncluded,
         @warehousesIncluded, @kind, @quotas, @priceMonthly, @priceYearly, @trialDays, @isPublic, @sortOrder, @status, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, name_en = @nameEn, modules = @modules, features = @features,
         seats_included = @seatsIncluded, branches_included = @branchesIncluded, warehouses_included = @warehousesIncluded,
         kind = @kind, quotas = @quotas,
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
      kind: p.kind, quotas: JSON.stringify(p.quotas),
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
  previous_plan_id: string | null;
  grace_days: number; cancelled_at: string | null; created_at: string; updated_at: string;
}

function toSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id, tenantId: r.tenant_id, planId: r.plan_id, status: r.status, billingCycle: r.billing_cycle,
    addOnModules: JSON.parse(r.add_on_modules) as string[],
    extraSeats: r.extra_seats, extraBranches: r.extra_branches, extraWarehouses: r.extra_warehouses,
    currentPeriodStart: r.current_period_start, currentPeriodEnd: r.current_period_end,
    trialEndsAt: r.trial_ends_at, previousPlanId: r.previous_plan_id, graceDays: r.grace_days, cancelledAt: r.cancelled_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

class SqliteSubscriptionStore implements SubscriptionTransitionRepository {
  private readonly sqlite: Database.Database;
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly liveByTenant: Database.Statement;
  private readonly byTenant: Database.Statement;
  private readonly liveByPlan: Database.Statement;
  private readonly listLiveByPlan: Database.Statement;
  private readonly endedTrials: Database.Statement;
  private readonly conditionalUpdate: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
    this.upsert = sqlite.prepare(
      `INSERT INTO subscription (id, tenant_id, plan_id, status, billing_cycle, add_on_modules, extra_seats,
         extra_branches, extra_warehouses, current_period_start, current_period_end, trial_ends_at, previous_plan_id,
         grace_days, cancelled_at, created_at, updated_at)
       VALUES (@id, @tenantId, @planId, @status, @billingCycle, @addOnModules, @extraSeats, @extraBranches,
         @extraWarehouses, @currentPeriodStart, @currentPeriodEnd, @trialEndsAt, @previousPlanId, @graceDays, @cancelledAt,
         @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = @tenantId, plan_id = @planId, status = @status, billing_cycle = @billingCycle,
         add_on_modules = @addOnModules, extra_seats = @extraSeats, extra_branches = @extraBranches,
         extra_warehouses = @extraWarehouses, current_period_start = @currentPeriodStart,
         current_period_end = @currentPeriodEnd, trial_ends_at = @trialEndsAt, previous_plan_id = @previousPlanId,
         grace_days = @graceDays,
         cancelled_at = @cancelledAt, created_at = @createdAt, updated_at = @updatedAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM subscription WHERE id = ?`);
    this.liveByTenant = sqlite.prepare(`SELECT * FROM subscription WHERE tenant_id = ? AND status <> 'cancelled'`);
    this.byTenant = sqlite.prepare(`SELECT * FROM subscription WHERE tenant_id = ? ORDER BY created_at, id`);
    this.liveByPlan = sqlite.prepare(`SELECT 1 FROM subscription WHERE plan_id = ? AND status <> 'cancelled' LIMIT 1`);
    this.listLiveByPlan = sqlite.prepare(`SELECT * FROM subscription WHERE plan_id = ? AND status <> 'cancelled' ORDER BY created_at, id`);
    this.endedTrials = sqlite.prepare(
      `SELECT * FROM subscription WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at <= ? ORDER BY trial_ends_at, id`,
    );
    // The WHERE clause is the concurrency guard: only the row still in the
    // state the caller read moves, so exactly one of two racing readers gets
    // `changes === 1` and writes the audit row.
    this.conditionalUpdate = sqlite.prepare(
      `UPDATE subscription
          SET plan_id = @planId, previous_plan_id = @previousPlanId, status = @status, billing_cycle = @billingCycle,
              current_period_start = @currentPeriodStart, current_period_end = @currentPeriodEnd,
              trial_ends_at = @trialEndsAt, updated_at = @updatedAt
        WHERE id = @id AND plan_id = @beforePlanId AND status = @beforeStatus AND updated_at = @beforeUpdatedAt`,
    );
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

  async listByPlan(planId: string): Promise<Subscription[]> {
    return (this.listLiveByPlan.all(planId) as SubscriptionRow[]).map(toSubscription);
  }

  async listEndedTrials(nowIso: string): Promise<Subscription[]> {
    return (this.endedTrials.all(nowIso) as SubscriptionRow[]).map(toSubscription);
  }

  async compareAndSet(before: Subscription, after: Subscription, sideEffect: () => Promise<void>): Promise<boolean> {
    return withSqliteTransaction(
      this.sqlite,
      async () => {
        const result = this.conditionalUpdate.run({
          id: after.id, planId: after.planId, previousPlanId: after.previousPlanId,
          status: after.status, billingCycle: after.billingCycle,
          currentPeriodStart: after.currentPeriodStart, currentPeriodEnd: after.currentPeriodEnd,
          trialEndsAt: after.trialEndsAt, updatedAt: after.updatedAt,
          beforePlanId: before.planId, beforeStatus: before.status, beforeUpdatedAt: before.updatedAt,
        });
        if (result.changes !== 1) return false;
        await sideEffect();
        return true;
      },
      "BEGIN IMMEDIATE",
    );
  }

  async save(s: Subscription): Promise<void> {
    this.upsert.run({
      id: s.id, tenantId: s.tenantId, planId: s.planId, status: s.status, billingCycle: s.billingCycle,
      addOnModules: JSON.stringify(s.addOnModules), extraSeats: s.extraSeats, extraBranches: s.extraBranches,
      extraWarehouses: s.extraWarehouses, currentPeriodStart: s.currentPeriodStart, currentPeriodEnd: s.currentPeriodEnd,
      trialEndsAt: s.trialEndsAt, previousPlanId: s.previousPlanId, graceDays: s.graceDays, cancelledAt: s.cancelledAt,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    });
  }
}

interface ModuleTrialRow {
  id: string; tenant_id: string; module: string; started_at: string; ends_at: string; started_by: string;
}

function toModuleTrial(r: ModuleTrialRow): ModuleTrial {
  return {
    id: r.id, tenantId: r.tenant_id, module: r.module,
    startedAt: r.started_at, endsAt: r.ends_at, startedBy: r.started_by,
  };
}

class SqliteModuleTrialStore implements ModuleTrialRepository {
  private readonly insert: Database.Statement;
  private readonly byTenant: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.insert = sqlite.prepare(
      `INSERT OR IGNORE INTO module_trial (id, tenant_id, module, started_at, ends_at, started_by)
       VALUES (@id, @tenantId, @module, @startedAt, @endsAt, @startedBy)`,
    );
    this.byTenant = sqlite.prepare(`SELECT * FROM module_trial WHERE tenant_id = ? ORDER BY started_at, module`);
  }

  async listByTenant(tenantId: string): Promise<ModuleTrial[]> {
    return (this.byTenant.all(tenantId) as ModuleTrialRow[]).map(toModuleTrial);
  }

  async insertIfFirst(trial: ModuleTrial): Promise<boolean> {
    return this.insert.run({
      id: trial.id, tenantId: trial.tenantId, module: trial.module,
      startedAt: trial.startedAt, endsAt: trial.endsAt, startedBy: trial.startedBy,
    }).changes === 1;
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

interface PaymentRow {
  id: string; tenant_id: string; subscription_id: string; amount: number; currency: Payment["currency"];
  reference: string; paid_at: string; recorded_by: string; note: string | null; created_at: string;
}

function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id, amount: Money.fromScaled(r.amount),
    currency: r.currency, reference: r.reference, paidAt: r.paid_at, recordedBy: r.recorded_by,
    note: r.note, createdAt: r.created_at,
  };
}

class SqlitePaymentStore implements PaymentRepository {
  private readonly insert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byTenant: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    /** Payments are append-only: no ON CONFLICT — a reused id is a bug and must reject, never silently overwrite the row it is renewing a subscription against. */
    this.insert = sqlite.prepare(
      `INSERT INTO payment (id, tenant_id, subscription_id, amount, currency, reference, paid_at, recorded_by, note, created_at)
       VALUES (@id, @tenantId, @subscriptionId, @amount, @currency, @reference, @paidAt, @recordedBy, @note, @createdAt)`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM payment WHERE id = ?`);
    this.byTenant = sqlite.prepare(`SELECT * FROM payment WHERE tenant_id = ? ORDER BY paid_at DESC, id DESC`);
  }

  async findById(id: string): Promise<Payment | null> {
    const row = this.byId.get(id) as PaymentRow | undefined;
    return row ? toPayment(row) : null;
  }

  async listByTenant(tenantId: string): Promise<Payment[]> {
    return (this.byTenant.all(tenantId) as PaymentRow[]).map(toPayment);
  }

  async save(p: Payment): Promise<void> {
    this.insert.run({
      id: p.id, tenantId: p.tenantId, subscriptionId: p.subscriptionId, amount: p.amount.toScaledNumber(),
      currency: p.currency, reference: p.reference, paidAt: p.paidAt, recordedBy: p.recordedBy,
      note: p.note, createdAt: p.createdAt,
    });
  }

  /** The subscription store shares this connection, so the renewal rolls back with the payment. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }
}

interface CardCheckoutRow {
  id: string; tenant_id: string; subscription_id: string; provider: PaymentProviderId; amount: number;
  currency: CardCheckout["currency"]; status: CardCheckoutStatus; provider_order_ref: string | null;
  checkout_url: string | null; provider_ref: string | null; payment_id: string | null;
  failure_reason: string | null; requested_by: string; created_at: string; updated_at: string;
}

function toCardCheckout(r: CardCheckoutRow): CardCheckout {
  return {
    id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id, provider: r.provider,
    amount: Money.fromScaled(r.amount), currency: r.currency, status: r.status,
    providerOrderRef: r.provider_order_ref, checkoutUrl: r.checkout_url, providerRef: r.provider_ref,
    paymentId: r.payment_id, failureReason: r.failure_reason, requestedBy: r.requested_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

class SqliteCardCheckoutStore implements CardCheckoutRepository {
  private readonly insertStmt: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byProviderOrder: Database.Statement;
  private readonly byTenant: Database.Statement;
  private readonly attach: Database.Statement;
  private readonly claim: Database.Statement;
  private readonly renewSubscription: Database.Statement;
  private readonly insertPayment: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertStmt = sqlite.prepare(
      `INSERT INTO card_checkout (id, tenant_id, subscription_id, provider, amount, currency, status, provider_order_ref,
         checkout_url, provider_ref, payment_id, failure_reason, requested_by, created_at, updated_at)
       VALUES (@id, @tenantId, @subscriptionId, @provider, @amount, @currency, @status, @providerOrderRef,
         @checkoutUrl, @providerRef, @paymentId, @failureReason, @requestedBy, @createdAt, @updatedAt)`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM card_checkout WHERE id = ?`);
    this.byProviderOrder = sqlite.prepare(`SELECT * FROM card_checkout WHERE provider = ? AND provider_order_ref = ?`);
    this.byTenant = sqlite.prepare(`SELECT * FROM card_checkout WHERE tenant_id = ? ORDER BY created_at DESC, id DESC`);
    this.attach = sqlite.prepare(
      `UPDATE card_checkout SET provider_order_ref = ?, checkout_url = ?, updated_at = ? WHERE id = ? AND provider_order_ref IS NULL`,
    );
    this.claim = sqlite.prepare(
      `INSERT INTO payment_provider_event (provider, provider_ref, received_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    );
    this.renewSubscription = sqlite.prepare(
      `UPDATE subscription SET status = @status, trial_ends_at = @trialEndsAt, current_period_start = @currentPeriodStart,
         current_period_end = @currentPeriodEnd, updated_at = @updatedAt
       WHERE id = @id AND status = @expectedStatus AND updated_at = @expectedUpdatedAt AND current_period_end = @expectedPeriodEnd`,
    );
    this.insertPayment = sqlite.prepare(
      `INSERT INTO payment (id, tenant_id, subscription_id, amount, currency, reference, paid_at, recorded_by, note, created_at)
       VALUES (@id, @tenantId, @subscriptionId, @amount, @currency, @reference, @paidAt, @recordedBy, @note, @createdAt)`,
    );
  }

  async insert(c: CardCheckout): Promise<void> {
    this.insertStmt.run({
      id: c.id, tenantId: c.tenantId, subscriptionId: c.subscriptionId, provider: c.provider,
      amount: c.amount.toScaledNumber(), currency: c.currency, status: c.status, providerOrderRef: c.providerOrderRef,
      checkoutUrl: c.checkoutUrl, providerRef: c.providerRef, paymentId: c.paymentId, failureReason: c.failureReason,
      requestedBy: c.requestedBy, createdAt: c.createdAt, updatedAt: c.updatedAt,
    });
  }

  async findById(id: string): Promise<CardCheckout | null> {
    const row = this.byId.get(id) as CardCheckoutRow | undefined;
    return row ? toCardCheckout(row) : null;
  }

  async findByProviderOrder(provider: PaymentProviderId, providerOrderRef: string): Promise<CardCheckout | null> {
    const row = this.byProviderOrder.get(provider, providerOrderRef) as CardCheckoutRow | undefined;
    return row ? toCardCheckout(row) : null;
  }

  async listByTenant(tenantId: string): Promise<CardCheckout[]> {
    return (this.byTenant.all(tenantId) as CardCheckoutRow[]).map(toCardCheckout);
  }

  async attachSession(id: string, providerOrderRef: string, checkoutUrl: string, now: string): Promise<void> {
    const result = this.attach.run(providerOrderRef, checkoutUrl, now, id);
    if (result.changes !== 1) throw new Error(`card checkout ${id} already has a provider order`);
  }

  private casCheckout(id: string, from: readonly CardCheckoutStatus[], to: CardCheckoutSettlement): boolean {
    if (from.length === 0) return false;
    const placeholders = from.map(() => "?").join(", ");
    return (
      this.sqlite
        .prepare(
          `UPDATE card_checkout SET status = ?, provider_ref = ?, payment_id = ?, failure_reason = ?, updated_at = ?
           WHERE id = ? AND status IN (${placeholders})`,
        )
        .run(to.status, to.providerRef, to.paymentId, to.failureReason, to.now, id, ...from).changes === 1
    );
  }

  async recordOutcome(input: Parameters<CardCheckoutRepository["recordOutcome"]>[0]): Promise<"duplicate" | "settled" | "unchanged"> {
    return this.sqlite.transaction(() => {
      if (this.claim.run(input.provider, input.providerRef, input.now).changes !== 1) return "duplicate" as const;
      if (!input.settle) return "unchanged" as const;
      return this.casCheckout(input.settle.checkoutId, input.settle.from, input.settle.to) ? ("settled" as const) : ("unchanged" as const);
    }).immediate();
  }

  async abandon(checkoutId: string, failureReason: string, now: string): Promise<void> {
    this.casCheckout(checkoutId, ["pending"], { status: "failed", providerRef: null, paymentId: null, failureReason, now });
  }

  async settlePaid(input: Parameters<CardCheckoutRepository["settlePaid"]>[0]): Promise<"duplicate" | "already-settled" | "subscription-changed" | "paid"> {
    const { subscriptionBefore: before, subscriptionAfter: after, payment: p } = input;
    const run = this.sqlite.transaction((): "duplicate" | "already-settled" | "paid" => {
      if (this.claim.run(input.provider, input.providerRef, input.now).changes !== 1) return "duplicate";
      const moved = this.casCheckout(input.checkoutId, input.from, {
        status: "paid", providerRef: input.providerRef, paymentId: p.id, failureReason: null, now: input.now,
      });
      if (!moved) return "already-settled";
      const renewed = this.renewSubscription.run({
        id: after.id, status: after.status, trialEndsAt: after.trialEndsAt,
        currentPeriodStart: after.currentPeriodStart, currentPeriodEnd: after.currentPeriodEnd, updatedAt: after.updatedAt,
        expectedStatus: before.status, expectedUpdatedAt: before.updatedAt, expectedPeriodEnd: before.currentPeriodEnd,
      });
      if (renewed.changes !== 1) throw new SubscriptionChanged();
      this.insertPayment.run({
        id: p.id, tenantId: p.tenantId, subscriptionId: p.subscriptionId, amount: p.amount.toScaledNumber(),
        currency: p.currency, reference: p.reference, paidAt: p.paidAt, recordedBy: p.recordedBy,
        note: p.note, createdAt: p.createdAt,
      });
      return "paid";
    });
    try {
      return run.immediate();
    } catch (err) {
      if (err instanceof SubscriptionChanged) return "subscription-changed";
      throw err;
    }
  }
}

class SubscriptionChanged extends Error {}

interface SignupRequestRow {
  id: string; code: string; name_ar: string; name_en: string | null;
  owner_email: string; owner_name_ar: string; plan_id: string; billing_cycle: SignupRequest["billingCycle"];
  token_hash: string; status: SignupRequest["status"]; expires_at: string; created_at: string; verified_at: string | null;
}

function toSignupRequest(r: SignupRequestRow): SignupRequest {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en,
    ownerEmail: r.owner_email, ownerNameAr: r.owner_name_ar, planId: r.plan_id, billingCycle: r.billing_cycle,
    tokenHash: r.token_hash, status: r.status, expiresAt: r.expires_at, createdAt: r.created_at, verifiedAt: r.verified_at,
  };
}

class SqliteSignupRequestStore implements SignupRequestRepository {
  private readonly upsert: Database.Statement;
  private readonly byTokenHash: Database.Statement;
  private readonly activeByCode: Database.Statement;
  private readonly markVerified: Database.Statement;
  private readonly claim: (tokenHash: string, claimId: string, nowIso: string, staleBeforeIso: string) => boolean;
  private readonly release: Database.Statement;
  private readonly renew: Database.Statement;
  private readonly claimedAt: Database.Statement;

  constructor(sqlite: Database.Database) {
    const dropStaleClaim = sqlite.prepare(`DELETE FROM signup_provision_claim WHERE token_hash = ? AND claimed_at < ?`);
    const insertClaim = sqlite.prepare(`INSERT OR IGNORE INTO signup_provision_claim (token_hash, claim_id, claimed_at) VALUES (?, ?, ?)`);
    // IMMEDIATE: the stale-claim delete and the insert must be one write transaction,
    // or two processes can both delete the same dead claim and both believe they hold it.
    this.claim = sqlite
      .transaction((tokenHash: string, claimId: string, nowIso: string, staleBeforeIso: string) => {
        dropStaleClaim.run(tokenHash, staleBeforeIso);
        return insertClaim.run(tokenHash, claimId, nowIso).changes === 1;
      })
      .immediate;
    this.release = sqlite.prepare(`DELETE FROM signup_provision_claim WHERE token_hash = ? AND claim_id = ?`);
    this.renew = sqlite.prepare(`UPDATE signup_provision_claim SET claimed_at = ? WHERE token_hash = ? AND claim_id = ?`);
    this.claimedAt = sqlite.prepare(`SELECT claimed_at FROM signup_provision_claim WHERE token_hash = ?`);
    this.upsert = sqlite.prepare(
      `INSERT INTO signup_request (id, code, name_ar, name_en, owner_email, owner_name_ar, plan_id, billing_cycle,
         token_hash, status, expires_at, created_at, verified_at)
       VALUES (@id, @code, @nameAr, @nameEn, @ownerEmail, @ownerNameAr, @planId, @billingCycle,
         @tokenHash, @status, @expiresAt, @createdAt, @verifiedAt)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, name_en = @nameEn, owner_email = @ownerEmail, owner_name_ar = @ownerNameAr,
         plan_id = @planId, billing_cycle = @billingCycle, token_hash = @tokenHash, status = @status,
         expires_at = @expiresAt, created_at = @createdAt, verified_at = @verifiedAt`,
    );
    this.byTokenHash = sqlite.prepare(`SELECT * FROM signup_request WHERE token_hash = ?`);
    this.activeByCode = sqlite.prepare(
      `SELECT * FROM signup_request WHERE code = ? AND status = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
    );
    // The conditional WHERE is the whole point: only a row still `pending`
    // moves, so two concurrent callers can never both believe they were the
    // one to flip it (`changes` is 1 for exactly one of them).
    this.markVerified = sqlite.prepare(
      `UPDATE signup_request SET status = ?, verified_at = ? WHERE token_hash = ? AND status = ?`,
    );
  }

  async findByTokenHash(tokenHash: string): Promise<SignupRequest | null> {
    const row = this.byTokenHash.get(tokenHash) as SignupRequestRow | undefined;
    return row ? toSignupRequest(row) : null;
  }

  async findActiveByCode(code: string, nowIso: string): Promise<SignupRequest | null> {
    const row = this.activeByCode.get(code, SignupRequestStatus.Pending, nowIso) as SignupRequestRow | undefined;
    return row ? toSignupRequest(row) : null;
  }

  async tryMarkVerified(tokenHash: string, nowIso: string): Promise<SignupRequest | null> {
    const result = this.markVerified.run(SignupRequestStatus.Verified, nowIso, tokenHash, SignupRequestStatus.Pending);
    if (result.changes !== 1) return null;
    return this.findByTokenHash(tokenHash);
  }

  async tryClaimProvisioning(tokenHash: string, claimId: string, nowIso: string, staleBeforeIso: string): Promise<boolean> {
    return this.claim(tokenHash, claimId, nowIso, staleBeforeIso);
  }

  async renewProvisioning(tokenHash: string, claimId: string, nowIso: string): Promise<boolean> {
    return this.renew.run(nowIso, tokenHash, claimId).changes === 1;
  }

  async provisioningClaimedAt(tokenHash: string): Promise<string | null> {
    const row = this.claimedAt.get(tokenHash) as { claimed_at: string } | undefined;
    return row?.claimed_at ?? null;
  }

  async releaseProvisioning(tokenHash: string, claimId: string): Promise<void> {
    this.release.run(tokenHash, claimId);
  }

  async save(r: SignupRequest): Promise<void> {
    this.upsert.run({
      id: r.id, code: r.code, nameAr: r.nameAr, nameEn: r.nameEn,
      ownerEmail: r.ownerEmail, ownerNameAr: r.ownerNameAr, planId: r.planId, billingCycle: r.billingCycle,
      tokenHash: r.tokenHash, status: r.status, expiresAt: r.expiresAt, createdAt: r.createdAt, verifiedAt: r.verifiedAt,
    });
  }
}

export interface SqlitePlatformStoresHandle {
  readonly tenants: TenantRepository;
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionTransitionRepository;
  readonly platformUsers: PlatformUserRepository;
  readonly payments: PaymentRepository;
  readonly cardCheckouts: CardCheckoutRepository;
  readonly signupRequests: SignupRequestRepository;
  readonly moduleTrials: ModuleTrialRepository;
  readonly sqlite: Database.Database;
  close(): void;
}

export function createSqlitePlatformStores(
  path: SqliteConnectionInput = ":memory:",
  options: SqliteOpenOptions = {},
): SqlitePlatformStoresHandle {
  const { sqlite, owned } = openSqliteConnection(path, options);
  sqlite.exec(CREATE_TABLES);
  addMissingColumns(sqlite);
  return {
    tenants: new SqliteTenantStore(sqlite),
    plans: new SqlitePlanStore(sqlite),
    subscriptions: new SqliteSubscriptionStore(sqlite),
    platformUsers: new SqlitePlatformUserStore(sqlite),
    payments: new SqlitePaymentStore(sqlite),
    cardCheckouts: new SqliteCardCheckoutStore(sqlite),
    signupRequests: new SqliteSignupRequestStore(sqlite),
    moduleTrials: new SqliteModuleTrialStore(sqlite),
    sqlite,
    close: () => { if (owned) sqlite.close(); },
  };
}
