import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput, type SqliteOpenOptions } from "./sqlite-connection.js";
import {
  Money,
  type CardCheckout, type CardCheckoutRepository, type CardCheckoutSettlement, type CardCheckoutStatus,
  type PaymentProviderId,
  type Payment, type PaymentRepository,
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
  private readonly listLiveByPlan: Database.Statement;

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
    this.listLiveByPlan = sqlite.prepare(`SELECT * FROM subscription WHERE plan_id = ? AND status <> 'cancelled' ORDER BY created_at, id`);
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

  constructor(sqlite: Database.Database) {
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
  private readonly release: Database.Statement;
  private readonly reopenStmt: Database.Statement;

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
    this.release = sqlite.prepare(`DELETE FROM payment_provider_event WHERE provider = ? AND provider_ref = ?`);
    this.reopenStmt = sqlite.prepare(
      `UPDATE card_checkout SET status = 'pending', provider_ref = NULL, payment_id = NULL, failure_reason = NULL, updated_at = ?
       WHERE id = ? AND status = 'paid'`,
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

  async settle(id: string, from: readonly CardCheckoutStatus[], to: CardCheckoutSettlement): Promise<boolean> {
    if (from.length === 0) return false;
    const placeholders = from.map(() => "?").join(", ");
    const result = this.sqlite
      .prepare(
        `UPDATE card_checkout SET status = ?, provider_ref = ?, payment_id = ?, failure_reason = ?, updated_at = ?
         WHERE id = ? AND status IN (${placeholders})`,
      )
      .run(to.status, to.providerRef, to.paymentId, to.failureReason, to.now, id, ...from);
    return result.changes === 1;
  }

  async reopen(id: string, now: string): Promise<boolean> {
    return this.reopenStmt.run(now, id).changes === 1;
  }

  async claimProviderEvent(provider: PaymentProviderId, providerRef: string, now: string): Promise<boolean> {
    return this.claim.run(provider, providerRef, now).changes === 1;
  }

  async releaseProviderEvent(provider: PaymentProviderId, providerRef: string): Promise<void> {
    this.release.run(provider, providerRef);
  }
}

export interface SqlitePlatformStoresHandle {
  readonly tenants: TenantRepository;
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly platformUsers: PlatformUserRepository;
  readonly payments: PaymentRepository;
  readonly cardCheckouts: CardCheckoutRepository;
  readonly sqlite: Database.Database;
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
    payments: new SqlitePaymentStore(sqlite),
    cardCheckouts: new SqliteCardCheckoutStore(sqlite),
    sqlite,
    close: () => { if (owned) sqlite.close(); },
  };
}
