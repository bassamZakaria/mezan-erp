import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput, type SqliteOpenOptions } from "./sqlite-connection.js";
import { placeholders, TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  InvalidTenantError,
  Money,
  CardCheckoutAttentionCause, CardCheckoutFailureReason, CardCheckoutResolution, CardCheckoutStatus, PaidSettlementOutcome, ProviderEventOutcome,
  pendingOwnerExpiresAt,
  settledPeriodEnd,
  type CardCheckout, type CardCheckoutRepository, type CardCheckoutSettlement,
  type PaymentProviderId,
  type Payment, type PaymentRepository,
  type Plan, type PlanRepository, type PlanQuotas, PlanKind,
  type ModuleTrial, type ModuleTrialRepository,
  type SubscriptionTransitionRepository,
  type PlatformUser, type PlatformUserRepository,
  type SignupRequest, type SignupRequestRepository, SignupRequestStatus, SignupDecision, VERIFIED_LINK_VALID_MS,
  type PlatformSettingKey, type PlatformSettingRepository,
  normalizeEmail, type SignInEmailRepository,
  type Subscription, SubscriptionStatusKind, anchorIsUtcDayOfCreation, billingDayBehindUtcAnchor, inferBillingAnchorDay,
  type OwnerRecordDue, type PendingOwner, type Tenant, type TenantRepository, TenantBooksReview, TenantStatusCode,
} from "@mezan/domain";

const TENANT_STATUSES: readonly string[] = Object.values(TenantStatusCode);
const SIGNUP_BACKFILL_DECIDER = "migration";
const SUBSCRIPTION_STATUSES: readonly string[] = Object.values(SubscriptionStatusKind);

function assertKnownStatus(kind: string, status: string, known: readonly string[]): void {
  if (!known.includes(status)) throw new Error(`refusing to store ${kind} status "${status}"`);
}

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS tenant (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  owner_email  TEXT NOT NULL,
  owner_user_id TEXT,
  owner_contact_verified INTEGER NOT NULL DEFAULT 1,
  owner_needed INTEGER NOT NULL DEFAULT 0,
  pending_owner TEXT,
  owner_record_due TEXT,
  books_review TEXT,
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
  sold_out             INTEGER NOT NULL DEFAULT 0,
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
  intended_plan_id      TEXT,
  billing_anchor_day    INTEGER,
  billing_anchor_review INTEGER NOT NULL DEFAULT 0,
  grace_days            INTEGER NOT NULL,
  cancelled_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_tenant ON subscription(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plan ON subscription(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_one_live
  ON subscription(tenant_id) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS platform_migration (
  name        TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

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
  created_at      TEXT NOT NULL,
  idempotency_key TEXT
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
  captured_amount     INTEGER,
  swept_at            TEXT,
  attention_cause     TEXT,
  resolution          TEXT,
  resolved_at         TEXT,
  resolved_by         TEXT,
  resolution_reason   TEXT,
  requested_by        TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_card_checkout_tenant ON card_checkout(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_card_checkout_status ON card_checkout(status, created_at);
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
  verified_at   TEXT,
  intended_plan_id TEXT,
  decision      TEXT,
  decided_at    TEXT,
  decided_by    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_request_token ON signup_request(token_hash);

CREATE TABLE IF NOT EXISTS platform_setting (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signup_provision_claim (
  token_hash TEXT PRIMARY KEY,
  claim_id   TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  fence      INTEGER
);
-- AUTOINCREMENT on purpose: a fence must never be reused, even after every claim row is gone.
CREATE TABLE IF NOT EXISTS provision_fence (
  generation INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at   TEXT NOT NULL
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

-- One email signs in to one company: the primary key is what refuses a second.
CREATE TABLE IF NOT EXISTS sign_in_email (
  email     TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sign_in_email_tenant ON sign_in_email(tenant_id);
`;

/** Columns added after the first release; an existing platform database is migrated in place. */
const ADDED_PLAN_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["kind", "TEXT NOT NULL DEFAULT 'paid'"],
  ["quotas", "TEXT NOT NULL DEFAULT '{}'"],
  ["sold_out", "INTEGER NOT NULL DEFAULT 0"],
];

function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(plan)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, ddl] of ADDED_PLAN_COLUMNS) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE plan ADD COLUMN ${name} ${ddl}`);
  }
  const onCheckout = new Set(
    (sqlite.prepare(`PRAGMA table_info(card_checkout)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!onCheckout.has("captured_amount")) sqlite.exec(`ALTER TABLE card_checkout ADD COLUMN captured_amount INTEGER`);
  if (!onCheckout.has("swept_at")) sqlite.exec(`ALTER TABLE card_checkout ADD COLUMN swept_at TEXT`);
  for (const column of ["attention_cause", "resolution", "resolved_at", "resolved_by", "resolution_reason"]) {
    if (!onCheckout.has(column)) sqlite.exec(`ALTER TABLE card_checkout ADD COLUMN ${column} TEXT`);
  }
  const onSubscription = new Set(
    (sqlite.prepare(`PRAGMA table_info(subscription)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!onSubscription.has("previous_plan_id")) sqlite.exec(`ALTER TABLE subscription ADD COLUMN previous_plan_id TEXT`);
  if (!onSubscription.has("intended_plan_id")) sqlite.exec(`ALTER TABLE subscription ADD COLUMN intended_plan_id TEXT`);
  const onSignup = new Set((sqlite.prepare(`PRAGMA table_info(signup_request)`).all() as { name: string }[]).map((c) => c.name));
  if (!onSignup.has("intended_plan_id")) sqlite.exec(`ALTER TABLE signup_request ADD COLUMN intended_plan_id TEXT`);
  sqlite.transaction(() => {
    for (const column of ["decision", "decided_at", "decided_by"]) {
      if (!onSignup.has(column)) sqlite.exec(`ALTER TABLE signup_request ADD COLUMN ${column} TEXT`);
    }
  })();
  sqlite
    .prepare(
      `UPDATE signup_request SET decision = @approved, decided_at = COALESCE(verified_at, created_at), decided_by = @actor
       WHERE status = @verified AND decision IS NULL
         AND code IN (SELECT code FROM tenant WHERE tenant.owner_email = signup_request.owner_email AND tenant.status <> @provisioning)`,
    )
    .run({ approved: SignupDecision.Approved, actor: SIGNUP_BACKFILL_DECIDER, verified: SignupRequestStatus.Verified, provisioning: TenantStatusCode.Provisioning });
  // A code the owner gave to someone else answers the request: it can no longer become that visitor's company.
  sqlite
    .prepare(
      `UPDATE signup_request SET status = @released
       WHERE status = @verified AND decision IS NULL AND code IN (SELECT code FROM tenant WHERE tenant.owner_email <> signup_request.owner_email)`,
    )
    .run({ released: SignupRequestStatus.Released, verified: SignupRequestStatus.Verified });
  const onPayment = new Set(
    (sqlite.prepare(`PRAGMA table_info(payment)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!onPayment.has("idempotency_key")) sqlite.exec(`ALTER TABLE payment ADD COLUMN idempotency_key TEXT`);
  if (!onSubscription.has("billing_anchor_day")) sqlite.exec(`ALTER TABLE subscription ADD COLUMN billing_anchor_day INTEGER`);
  if (!onSubscription.has("billing_anchor_review")) sqlite.exec(`ALTER TABLE subscription ADD COLUMN billing_anchor_review INTEGER NOT NULL DEFAULT 0`);
  const onTenant = new Set((sqlite.prepare(`PRAGMA table_info(tenant)`).all() as { name: string }[]).map((c) => c.name));
  const onClaim = new Set((sqlite.prepare(`PRAGMA table_info(signup_provision_claim)`).all() as { name: string }[]).map((c) => c.name));
  if (!onClaim.has("fence")) sqlite.exec(`ALTER TABLE signup_provision_claim ADD COLUMN fence INTEGER`);
  if (!onTenant.has("owner_user_id")) sqlite.exec(`ALTER TABLE tenant ADD COLUMN owner_user_id TEXT`);
  if (!onTenant.has("owner_contact_verified")) sqlite.exec(`ALTER TABLE tenant ADD COLUMN owner_contact_verified INTEGER NOT NULL DEFAULT 1`);
  if (!onTenant.has("owner_needed")) sqlite.exec(`ALTER TABLE tenant ADD COLUMN owner_needed INTEGER NOT NULL DEFAULT 0`);
  if (!onTenant.has("pending_owner")) sqlite.exec(`ALTER TABLE tenant ADD COLUMN pending_owner TEXT`);
  if (!onTenant.has("owner_record_due")) sqlite.exec(`ALTER TABLE tenant ADD COLUMN owner_record_due TEXT`);
  if (!onTenant.has("books_review")) sqlite.exec(`ALTER TABLE tenant ADD COLUMN books_review TEXT`);
}

const TENANT_DB_FILE_INDEX = "idx_tenant_db_file";

// REQUIRED ORDERING: look for duplicates before building the index. Two rows
// naming one file is two companies in one set of books; the platform refuses
// to start and names the rows, and nothing is changed for an operator to undo.
function guardOneDbFilePerTenant(sqlite: Database.Database): void {
  const shared = sqlite
    .prepare(`SELECT db_file AS dbFile, group_concat(id, ', ') AS ids FROM (SELECT db_file, id FROM tenant ORDER BY id) GROUP BY db_file HAVING count(*) > 1`)
    .all() as { dbFile: string; ids: string }[];
  if (shared.length > 0) {
    throw new Error(
      `the platform database names one tenant database file from more than one tenant row; fix the rows before starting: ${shared
        .map((row) => `"${row.dbFile}" <- tenants ${row.ids}`)
        .join("; ")}`,
    );
  }
  sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${TENANT_DB_FILE_INDEX} ON tenant(db_file)`);
}

const PG_UNIQUE_VIOLATION = "23505";

function isDbFileTaken(err: unknown): boolean {
  if (!(err instanceof Error) || !("code" in err)) return false;
  if (err.code === "SQLITE_CONSTRAINT_UNIQUE") return err.message.includes("tenant.db_file");
  return err.code === PG_UNIQUE_VIOLATION && "constraint" in err && err.constraint === TENANT_DB_FILE_INDEX;
}

interface TenantRow {
  id: string; code: string; name_ar: string; name_en: string | null; owner_email: string;
  owner_user_id: string | null; owner_contact_verified: bigint;
  owner_needed: bigint; pending_owner: string | null; owner_record_due: string | null; books_review: string | null;
  status: Tenant["status"]; db_file: string; created_at: string; updated_at: string;
}

function toTenant(r: TenantRow): Tenant {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en, ownerEmail: r.owner_email,
    ownerUserId: r.owner_user_id, ownerContactVerified: Number(r.owner_contact_verified) === 1,
    status: r.status, dbFile: r.db_file, createdAt: r.created_at, updatedAt: r.updated_at,
    ...(Number(r.owner_needed) === 1 ? { ownerNeeded: true } : {}),
    ...(r.pending_owner === null ? {} : { pendingOwner: pendingOwnerOf(r.pending_owner) }),
    ...(r.owner_record_due === null ? {} : { ownerRecordDue: JSON.parse(r.owner_record_due) as OwnerRecordDue }),
    // SECURITY: any mark stops the books being served. One this build does
    // not know is read as `disowned`, never as no mark at all.
    ...(r.books_review === null ? {} : { booksReview: TenantBooksReview.Disowned }),
  };
}

const RETIRED_BOOKS_REVIEW = "unconfirmed";

// An earlier build of this lane wrote this mark on books it served unbound. It
// stopped nothing then, and left in place it would now read as `disowned`.
function dropRetiredBooksReview(sqlite: Database.Database): void {
  sqlite.prepare(`UPDATE tenant SET books_review = NULL WHERE books_review = ?`).run(RETIRED_BOOKS_REVIEW);
}

function pendingOwnerOf(stored: string): PendingOwner {
  const read = JSON.parse(stored) as Omit<PendingOwner, "expiresAt"> & { expiresAt?: string };
  return { ...read, expiresAt: read.expiresAt ?? pendingOwnerExpiresAt(read.requestedAt) };
}

function pendingOwnerText(pending: PendingOwner): string {
  return JSON.stringify({
    userId: pending.userId, email: pending.email, requestedBy: pending.requestedBy, requestedAt: pending.requestedAt, expiresAt: pending.expiresAt, tokenHash: pending.tokenHash,
  });
}

function ownerRecordDueText(due: OwnerRecordDue): string {
  return JSON.stringify({ eventId: due.eventId, userId: due.userId, previousUserId: due.previousUserId, actor: due.actor, confirmedBy: due.confirmedBy });
}

function storedPendingOwner(tenant: Tenant): string | null {
  return tenant.pendingOwner ? pendingOwnerText(tenant.pendingOwner) : null;
}

function storedOwnerRecordDue(tenant: Tenant): string | null {
  return tenant.ownerRecordDue ? ownerRecordDueText(tenant.ownerRecordDue) : null;
}

// CONTRACT: the owner compare-and-set matches these two columns as text. A row
// an earlier build wrote in another form (no expiry, another field order) is
// rewritten once into the form this build writes, or it could never be moved.
function rewriteOwnerTextAsThisBuildWritesIt(sqlite: Database.Database): void {
  const rows = sqlite.prepare(`SELECT id, pending_owner, owner_record_due FROM tenant WHERE pending_owner IS NOT NULL OR owner_record_due IS NOT NULL`).all() as Pick<
    TenantRow,
    "id" | "pending_owner" | "owner_record_due"
  >[];
  const rewrite = sqlite.prepare(`UPDATE tenant SET pending_owner = @pending, owner_record_due = @due WHERE id = @id`);
  for (const row of rows) {
    const pending = row.pending_owner === null ? null : pendingOwnerText(pendingOwnerOf(row.pending_owner));
    const due = row.owner_record_due === null ? null : ownerRecordDueText(JSON.parse(row.owner_record_due) as OwnerRecordDue);
    if (pending !== row.pending_owner || due !== row.owner_record_due) rewrite.run({ id: row.id, pending, due });
  }
}

const TENANT_COLUMNS = "id, code, name_ar, name_en, owner_email, owner_user_id, owner_contact_verified, owner_needed, pending_owner, owner_record_due, books_review, status, db_file, created_at, updated_at";

class SqlTenantStore implements TenantRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.db.get<TenantRow>(`SELECT ${TENANT_COLUMNS} FROM tenant WHERE id = ?`, [id]);
    return row ? toTenant(row) : null;
  }

  async findByCode(code: string): Promise<Tenant | null> {
    const row = await this.db.get<TenantRow>(`SELECT ${TENANT_COLUMNS} FROM tenant WHERE code = ?`, [code]);
    return row ? toTenant(row) : null;
  }

  async list(): Promise<Tenant[]> {
    return (await this.db.all<TenantRow>(`SELECT ${TENANT_COLUMNS} FROM tenant ORDER BY created_at, id`)).map(toTenant);
  }

  async save(t: Tenant): Promise<void> {
    assertKnownStatus("tenant", t.status, TENANT_STATUSES);
    try {
      await this.db.run(
        `INSERT INTO tenant (${TENANT_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en, owner_email = excluded.owner_email,
           owner_user_id = excluded.owner_user_id, owner_contact_verified = excluded.owner_contact_verified,
           owner_needed = excluded.owner_needed, pending_owner = excluded.pending_owner, owner_record_due = excluded.owner_record_due,
           books_review = excluded.books_review, status = excluded.status, db_file = excluded.db_file,
           created_at = excluded.created_at, updated_at = excluded.updated_at`,
        [
          t.id, t.code, t.nameAr, t.nameEn, t.ownerEmail, t.ownerUserId, t.ownerContactVerified ? 1 : 0,
          t.ownerNeeded === true ? 1 : 0, storedPendingOwner(t), storedOwnerRecordDue(t), t.booksReview ?? null,
          t.status, t.dbFile, t.createdAt, t.updatedAt,
        ],
      );
    } catch (err) {
      if (isDbFileTaken(err)) throw new InvalidTenantError(["ملف قاعدة بيانات هذه المنشأة مسجّل لمنشأة أخرى"]);
      throw err;
    }
  }

  async compareAndSetStatus(before: Tenant, after: Tenant): Promise<boolean> {
    assertKnownStatus("tenant", after.status, TENANT_STATUSES);
    const result = await this.db.run(
      `UPDATE tenant SET status = ?, code = ?, updated_at = ?
       WHERE id = ? AND status = ? AND code = ?`,
      [after.status, after.code, after.updatedAt, after.id, before.status, before.code],
    );
    return result.changes === 1;
  }

  // A file another tenant already names is refused by the statement itself, so
  // on Postgres the unique index is not tripped inside a caller's transaction.
  async setDbFile(id: string, from: string, to: string): Promise<boolean> {
    try {
      const result = await this.db.run(
        `UPDATE tenant SET db_file = ? WHERE id = ? AND db_file = ? AND NOT EXISTS (SELECT 1 FROM tenant other WHERE other.db_file = ? AND other.id <> ?)`,
        [to, id, from, to, id],
      );
      return result.changes === 1;
    } catch (err) {
      if (isDbFileTaken(err)) return false;
      throw err;
    }
  }

  async compareAndSetOwner(before: Tenant, after: Tenant, sideEffect: () => Promise<void>): Promise<boolean> {
    // CONTRACT: the books mark is compared as marked or not, never by its text:
    // a mark this build does not know is read as `disowned` and must still be
    // one the console can move.
    const booksMarked = before.booksReview === undefined || before.booksReview === null ? "books_review IS NULL" : "books_review IS NOT NULL";
    return this.db.transaction(async () => {
      const result = await this.db.run(
        `UPDATE tenant SET owner_email = ?, owner_user_id = ?, owner_contact_verified = ?,
           owner_needed = ?, pending_owner = ?, owner_record_due = ?, books_review = ?, updated_at = ?
         WHERE id = ? AND owner_email = ? AND owner_user_id IS NOT DISTINCT FROM ? AND owner_contact_verified = ?
           AND owner_needed = ? AND pending_owner IS NOT DISTINCT FROM ? AND owner_record_due IS NOT DISTINCT FROM ?
           AND ${booksMarked}`,
        [
          after.ownerEmail, after.ownerUserId, after.ownerContactVerified ? 1 : 0,
          after.ownerNeeded === true ? 1 : 0, storedPendingOwner(after), storedOwnerRecordDue(after), after.booksReview ?? null, after.updatedAt,
          after.id, before.ownerEmail, before.ownerUserId, before.ownerContactVerified ? 1 : 0,
          before.ownerNeeded === true ? 1 : 0, storedPendingOwner(before), storedOwnerRecordDue(before),
        ],
      );
      if (result.changes !== 1) return false;
      await sideEffect();
      return true;
    }, TransactionMode.Immediate);
  }

  async discardProvisioning(id: string): Promise<boolean> {
    return this.db.transaction(async () => {
      if ((await this.db.run(`DELETE FROM tenant WHERE id = ? AND status = ?`, [id, TenantStatusCode.Provisioning])).changes === 0) return false;
      await this.db.run(`DELETE FROM subscription WHERE tenant_id = ?`, [id]);
      return true;
    });
  }
}

interface PlanRow {
  id: string; code: string; name_ar: string; name_en: string; modules: string; features: string;
  seats_included: bigint; branches_included: bigint; warehouses_included: bigint;
  kind: string; quotas: string;
  price_monthly: bigint; price_yearly: bigint; trial_days: bigint; is_public: bigint; sold_out?: bigint;
  sort_order: bigint; status: Plan["status"]; created_at: string;
}

function toPlan(r: PlanRow): Plan {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en,
    modules: JSON.parse(r.modules) as string[],
    features: JSON.parse(r.features) as Record<string, boolean>,
    seatsIncluded: Number(r.seats_included), branchesIncluded: Number(r.branches_included), warehousesIncluded: Number(r.warehouses_included),
    kind: r.kind === PlanKind.Free ? PlanKind.Free : PlanKind.Paid,
    quotas: JSON.parse(r.quotas || "{}") as PlanQuotas,
    priceMonthly: Money.fromScaled(r.price_monthly), priceYearly: Money.fromScaled(r.price_yearly),
    trialDays: Number(r.trial_days), isPublic: Number(r.is_public) === 1, ...(r.sold_out !== undefined && Number(r.sold_out) === 1 ? { soldOut: true } : {}), sortOrder: Number(r.sort_order),
    status: r.status, createdAt: r.created_at,
  };
}

class SqlPlanStore implements PlanRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Plan | null> {
    const row = await this.db.get<PlanRow>(`SELECT * FROM plan WHERE id = ?`, [id]);
    return row ? toPlan(row) : null;
  }

  async findByCode(code: string): Promise<Plan | null> {
    const row = await this.db.get<PlanRow>(`SELECT * FROM plan WHERE code = ?`, [code]);
    return row ? toPlan(row) : null;
  }

  async list(): Promise<Plan[]> {
    return (await this.db.all<PlanRow>(`SELECT * FROM plan ORDER BY sort_order, code`)).map(toPlan);
  }

  async save(p: Plan): Promise<void> {
    await this.db.run(
      `INSERT INTO plan (id, code, name_ar, name_en, modules, features, seats_included, branches_included,
         warehouses_included, kind, quotas, price_monthly, price_yearly, trial_days, is_public, sold_out, sort_order, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en, modules = excluded.modules, features = excluded.features,
         seats_included = excluded.seats_included, branches_included = excluded.branches_included, warehouses_included = excluded.warehouses_included,
         kind = excluded.kind, quotas = excluded.quotas,
         price_monthly = excluded.price_monthly, price_yearly = excluded.price_yearly, trial_days = excluded.trial_days,
         is_public = excluded.is_public, sold_out = excluded.sold_out,
         sort_order = excluded.sort_order, status = excluded.status, created_at = excluded.created_at`,
      [
        p.id, p.code, p.nameAr, p.nameEn, JSON.stringify(p.modules), JSON.stringify(p.features),
        p.seatsIncluded, p.branchesIncluded, p.warehousesIncluded, p.kind, JSON.stringify(p.quotas),
        p.priceMonthly.scaled, p.priceYearly.scaled, p.trialDays, p.isPublic ? 1 : 0, p.soldOut ? 1 : 0, p.sortOrder,
        p.status, p.createdAt,
      ],
    );
  }
}

interface SubscriptionRow {
  id: string; tenant_id: string; plan_id: string; status: Subscription["status"];
  billing_cycle: Subscription["billingCycle"]; add_on_modules: string;
  extra_seats: bigint; extra_branches: bigint; extra_warehouses: bigint;
  current_period_start: string; current_period_end: string; trial_ends_at: string | null;
  previous_plan_id: string | null;
  intended_plan_id?: string | null;
  billing_anchor_day: bigint | null;
  billing_anchor_review: bigint;
  grace_days: bigint; cancelled_at: string | null; created_at: string; updated_at: string;
}

function toSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id, tenantId: r.tenant_id, planId: r.plan_id, status: r.status, billingCycle: r.billing_cycle,
    addOnModules: JSON.parse(r.add_on_modules) as string[],
    extraSeats: Number(r.extra_seats), extraBranches: Number(r.extra_branches), extraWarehouses: Number(r.extra_warehouses),
    currentPeriodStart: r.current_period_start, currentPeriodEnd: r.current_period_end,
    trialEndsAt: r.trial_ends_at, previousPlanId: r.previous_plan_id, graceDays: Number(r.grace_days), cancelledAt: r.cancelled_at,
    ...(r.intended_plan_id ? { intendedPlanId: r.intended_plan_id } : {}),
    createdAt: r.created_at, updatedAt: r.updated_at,
    ...(r.billing_anchor_day === null ? {} : { billingAnchorDay: Number(r.billing_anchor_day) }),
    ...(Number(r.billing_anchor_review) === 1 ? { billingAnchorNeedsReview: true } : {}),
  };
}

const ANCHOR_BACKFILL = "2026-10-billing-anchor-backfill";

function backfillBillingAnchors(sqlite: Database.Database): void {
  if (sqlite.prepare(`SELECT 1 FROM platform_migration WHERE name = ?`).get(ANCHOR_BACKFILL)) return;
  const unanchored = sqlite.prepare(`SELECT * FROM subscription WHERE billing_anchor_day IS NULL AND status <> ?`).safeIntegers(true);
  const renewals = sqlite.prepare(`SELECT created_at FROM payment WHERE subscription_id = ? ORDER BY created_at, id`);
  const setAnchor = sqlite.prepare(`UPDATE subscription SET billing_anchor_day = ? WHERE id = ? AND billing_anchor_day IS NULL`);
  const markForReview = sqlite.prepare(`UPDATE subscription SET billing_anchor_review = 1 WHERE id = ? AND billing_anchor_day IS NULL`);
  const done = sqlite.prepare(`INSERT INTO platform_migration (name, applied_at) VALUES (?, ?)`);
  sqlite
    .transaction(() => {
      for (const row of unanchored.all(SubscriptionStatusKind.Cancelled) as SubscriptionRow[]) {
        const recordedAt = (renewals.all(row.id) as { created_at: string }[]).map((payment) => payment.created_at);
        const day = inferBillingAnchorDay(toSubscription(row), recordedAt);
        if (day === null) markForReview.run(row.id);
        else setAnchor.run(day, row.id);
      }
      done.run(ANCHOR_BACKFILL, new Date().toISOString());
    })
    .immediate();
}

const UTC_ANCHOR_REPAIR = "2026-10-billing-anchor-utc-repair";
const UTC_ANCHOR_UNRENEWED_REPAIR = "2026-10-billing-anchor-utc-unrenewed-repair";

enum UtcAnchorRepairScope {
  EveryAnchor = "every_anchor",
  LeftForReview = "left_for_review",
}

const UTC_ANCHOR_CANDIDATES: Record<UtcAnchorRepairScope, string> = {
  [UtcAnchorRepairScope.EveryAnchor]: `SELECT * FROM subscription WHERE billing_anchor_day IS NOT NULL AND status <> ?`,
  [UtcAnchorRepairScope.LeftForReview]: `SELECT * FROM subscription WHERE billing_anchor_day IS NOT NULL AND billing_anchor_review = 1 AND status <> ?`,
};

// INVARIANT: corrects only an anchor that is provably the UTC day of the subscription's
// creation: to the Cairo day it was created on while it was never renewed, and
// otherwise only to the day its own payment history reproduces. Anything the
// history does not settle is marked for the platform owner, never guessed.
// INVARIANT: one pass per marker, and neither marker may be dropped or merged.
// Stores that ran the first pass ran it before a never-renewed subscription
// was settled without its history; the second marker reaches the rows it left
// marked, and only those: an unmarked day may be one the platform owner chose.
function repairUtcBillingAnchors(sqlite: Database.Database, marker: string, scope: UtcAnchorRepairScope): void {
  if (sqlite.prepare(`SELECT 1 FROM platform_migration WHERE name = ?`).get(marker)) return;
  const candidates = sqlite.prepare(UTC_ANCHOR_CANDIDATES[scope]).safeIntegers(true);
  const renewals = sqlite.prepare(`SELECT created_at FROM payment WHERE subscription_id = ? ORDER BY created_at, id`);
  const setAnchor = sqlite.prepare(`UPDATE subscription SET billing_anchor_day = ?, billing_anchor_review = 0 WHERE id = ? AND billing_anchor_day = ?`);
  const markForReview = sqlite.prepare(`UPDATE subscription SET billing_anchor_review = 1 WHERE id = ? AND billing_anchor_day = ?`);
  const done = sqlite.prepare(`INSERT INTO platform_migration (name, applied_at) VALUES (?, ?)`);
  sqlite
    .transaction(() => {
      for (const row of candidates.all(SubscriptionStatusKind.Cancelled) as SubscriptionRow[]) {
        const subscription = toSubscription(row);
        if (!anchorIsUtcDayOfCreation(subscription)) continue;
        const recordedAt = (renewals.all(row.id) as { created_at: string }[]).map((payment) => payment.created_at);
        const day = billingDayBehindUtcAnchor(subscription, recordedAt);
        if (day === null) markForReview.run(row.id, row.billing_anchor_day);
        else setAnchor.run(day, row.id, row.billing_anchor_day);
      }
      done.run(marker, new Date().toISOString());
    })
    .immediate();
}

const PERIOD_END_REPAIR = "2026-10-period-end-cairo-repair";
const PERIOD_END_SHORT_REPAIR = "2026-10-period-end-utc-short-repair";
const PERIOD_END_SUMMER_TIME_REPAIR = "2026-10-period-end-summer-time-repair";

// REQUIRED ORDERING: after the anchor repairs, because the day a period was
// meant to end on is read from the anchor they settle.
// INVARIANT: one pass per marker, and no marker may be dropped or merged.
// Stores that ran an earlier pass ran it before `settledPeriodEnd` also read a
// period that ends short of its day, and before it read one a change of summer
// time put on the day beside its billing day; only a later marker reaches them.
function repairPeriodEnds(sqlite: Database.Database, marker: string): void {
  if (sqlite.prepare(`SELECT 1 FROM platform_migration WHERE name = ?`).get(marker)) return;
  const live = sqlite.prepare(`SELECT * FROM subscription WHERE status <> ?`).safeIntegers(true);
  const setEnd = sqlite.prepare(`UPDATE subscription SET current_period_end = ? WHERE id = ? AND current_period_end = ?`);
  const done = sqlite.prepare(`INSERT INTO platform_migration (name, applied_at) VALUES (?, ?)`);
  sqlite
    .transaction(() => {
      for (const row of live.all(SubscriptionStatusKind.Cancelled) as SubscriptionRow[]) {
        const settled = settledPeriodEnd(toSubscription(row));
        if (settled !== row.current_period_end) setEnd.run(settled, row.id, row.current_period_end);
      }
      done.run(marker, new Date().toISOString());
    })
    .immediate();
}

class SqlSubscriptionStore implements SubscriptionTransitionRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Subscription | null> {
    const row = await this.db.get<SubscriptionRow>(`SELECT * FROM subscription WHERE id = ?`, [id]);
    return row ? toSubscription(row) : null;
  }

  async findLiveByTenant(tenantId: string): Promise<Subscription | null> {
    const row = await this.db.get<SubscriptionRow>(`SELECT * FROM subscription WHERE tenant_id = ? AND status <> 'cancelled'`, [tenantId]);
    return row ? toSubscription(row) : null;
  }

  async listByTenant(tenantId: string): Promise<Subscription[]> {
    return (await this.db.all<SubscriptionRow>(`SELECT * FROM subscription WHERE tenant_id = ? ORDER BY created_at, id`, [tenantId])).map(toSubscription);
  }

  async listByPlan(planId: string): Promise<Subscription[]> {
    return (await this.db.all<SubscriptionRow>(`SELECT * FROM subscription WHERE plan_id = ? AND status <> 'cancelled' ORDER BY created_at, id`, [planId])).map(toSubscription);
  }

  async listEndedTrials(nowIso: string): Promise<Subscription[]> {
    return (
      await this.db.all<SubscriptionRow>(
        `SELECT * FROM subscription WHERE status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at <= ? ORDER BY trial_ends_at, id`,
        [nowIso],
      )
    ).map(toSubscription);
  }

  // The WHERE clause is the concurrency guard: only the row still in the
  // state the caller read moves, so exactly one of two racing readers gets
  // `changes === 1` and writes the audit row.
  async compareAndSet(before: Subscription, after: Subscription, sideEffect: () => Promise<void>): Promise<boolean> {
    return this.db.transaction(async () => {
      const result = await this.db.run(
        `UPDATE subscription
            SET plan_id = ?, previous_plan_id = ?, status = ?, billing_cycle = ?,
                current_period_start = ?, current_period_end = ?,
                trial_ends_at = ?, billing_anchor_day = ?, billing_anchor_review = ?,
                updated_at = ?
          WHERE id = ? AND plan_id = ? AND status = ? AND updated_at = ?`,
        [
          after.planId, after.previousPlanId, after.status, after.billingCycle,
          after.currentPeriodStart, after.currentPeriodEnd,
          after.trialEndsAt, after.billingAnchorDay ?? null, after.billingAnchorNeedsReview === true ? 1 : 0,
          after.updatedAt,
          after.id, before.planId, before.status, before.updatedAt,
        ],
      );
      if (result.changes !== 1) return false;
      await sideEffect();
      return true;
    }, TransactionMode.Immediate);
  }

  async save(s: Subscription): Promise<void> {
    assertKnownStatus("subscription", s.status, SUBSCRIPTION_STATUSES);
    await this.db.run(
      `INSERT INTO subscription (id, tenant_id, plan_id, status, billing_cycle, add_on_modules, extra_seats,
         extra_branches, extra_warehouses, current_period_start, current_period_end, trial_ends_at, previous_plan_id,
         billing_anchor_day, billing_anchor_review, grace_days, cancelled_at, created_at, updated_at, intended_plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = excluded.tenant_id, plan_id = excluded.plan_id, status = excluded.status, billing_cycle = excluded.billing_cycle,
         add_on_modules = excluded.add_on_modules, extra_seats = excluded.extra_seats, extra_branches = excluded.extra_branches,
         extra_warehouses = excluded.extra_warehouses, current_period_start = excluded.current_period_start,
         current_period_end = excluded.current_period_end, trial_ends_at = excluded.trial_ends_at, previous_plan_id = excluded.previous_plan_id,
         billing_anchor_day = excluded.billing_anchor_day, billing_anchor_review = excluded.billing_anchor_review, grace_days = excluded.grace_days,
         cancelled_at = excluded.cancelled_at, created_at = excluded.created_at, updated_at = excluded.updated_at,
         intended_plan_id = COALESCE(excluded.intended_plan_id, subscription.intended_plan_id)`,
      [
        s.id, s.tenantId, s.planId, s.status, s.billingCycle, JSON.stringify(s.addOnModules), s.extraSeats,
        s.extraBranches, s.extraWarehouses, s.currentPeriodStart, s.currentPeriodEnd, s.trialEndsAt, s.previousPlanId,
        s.billingAnchorDay ?? null, s.billingAnchorNeedsReview === true ? 1 : 0, s.graceDays, s.cancelledAt,
        s.createdAt, s.updatedAt, s.intendedPlanId ?? null,
      ],
    );
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

class SqlModuleTrialStore implements ModuleTrialRepository {
  constructor(private readonly db: SqlDb) {}

  async listByTenant(tenantId: string): Promise<ModuleTrial[]> {
    return (await this.db.all<ModuleTrialRow>(`SELECT * FROM module_trial WHERE tenant_id = ? ORDER BY started_at, module`, [tenantId])).map(toModuleTrial);
  }

  async insertIfFirst(trial: ModuleTrial): Promise<boolean> {
    const result = await this.db.run(
      `INSERT INTO module_trial (id, tenant_id, module, started_at, ends_at, started_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      [trial.id, trial.tenantId, trial.module, trial.startedAt, trial.endsAt, trial.startedBy],
    );
    return result.changes === 1;
  }
}

interface PlatformUserRow {
  id: string; email: string; password_hash: string; role: PlatformUser["role"];
  status: PlatformUser["status"]; created_at: string;
}

function toPlatformUser(r: PlatformUserRow): PlatformUser {
  return { id: r.id, email: r.email, passwordHash: r.password_hash, role: r.role, status: r.status, createdAt: r.created_at };
}

class SqlPlatformUserStore implements PlatformUserRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<PlatformUser | null> {
    const row = await this.db.get<PlatformUserRow>(`SELECT * FROM platform_user WHERE id = ?`, [id]);
    return row ? toPlatformUser(row) : null;
  }

  async findByEmail(email: string): Promise<PlatformUser | null> {
    const row = await this.db.get<PlatformUserRow>(`SELECT * FROM platform_user WHERE email = ?`, [email]);
    return row ? toPlatformUser(row) : null;
  }

  async list(): Promise<PlatformUser[]> {
    return (await this.db.all<PlatformUserRow>(`SELECT * FROM platform_user ORDER BY created_at, id`)).map(toPlatformUser);
  }

  async save(u: PlatformUser): Promise<void> {
    await this.db.run(
      `INSERT INTO platform_user (id, email, password_hash, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email, password_hash = excluded.password_hash, role = excluded.role, status = excluded.status, created_at = excluded.created_at`,
      [u.id, u.email, u.passwordHash, u.role, u.status, u.createdAt],
    );
  }
}

interface PaymentRow {
  id: string; tenant_id: string; subscription_id: string; amount: bigint; currency: Payment["currency"];
  reference: string; paid_at: string; recorded_by: string; note: string | null; created_at: string;
}

function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id, amount: Money.fromScaled(r.amount),
    currency: r.currency, reference: r.reference, paidAt: r.paid_at, recordedBy: r.recorded_by,
    note: r.note, createdAt: r.created_at,
  };
}

const PAYMENT_COLUMNS = "id, tenant_id, subscription_id, amount, currency, reference, paid_at, recorded_by, note, created_at";

class SqlPaymentStore implements PaymentRepository {
  constructor(private readonly db: SqlDb) {}

  async findByReference(tenantId: string, reference: string): Promise<Payment | null> {
    const row = await this.db.get<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payment WHERE tenant_id = ? AND reference = ? ORDER BY created_at ASC, id ASC LIMIT 1`, [tenantId, reference]);
    return row ? toPayment(row) : null;
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Payment | null> {
    const row = await this.db.get<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payment WHERE tenant_id = ? AND idempotency_key = ?`, [tenantId, idempotencyKey]);
    return row ? toPayment(row) : null;
  }

  async findById(id: string): Promise<Payment | null> {
    const row = await this.db.get<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payment WHERE id = ?`, [id]);
    return row ? toPayment(row) : null;
  }

  async listByTenant(tenantId: string): Promise<Payment[]> {
    return (await this.db.all<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payment WHERE tenant_id = ? ORDER BY paid_at DESC, id DESC`, [tenantId])).map(toPayment);
  }

  /** Payments are append-only: no ON CONFLICT — a reused id is a bug and must reject, never silently overwrite the row it is renewing a subscription against. */
  async save(p: Payment, idempotencyKey?: string): Promise<void> {
    await this.db.run(
      `INSERT INTO payment (${PAYMENT_COLUMNS}, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, p.tenantId, p.subscriptionId, p.amount.scaled, p.currency, p.reference, p.paidAt, p.recordedBy, p.note, p.createdAt, idempotencyKey ?? null],
    );
  }

  /** The subscription store shares this database, so the renewal rolls back with the payment. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn, TransactionMode.Immediate);
  }
}

interface CardCheckoutRow {
  id: string; tenant_id: string; subscription_id: string; provider: PaymentProviderId; amount: bigint;
  currency: CardCheckout["currency"]; status: CardCheckoutStatus; provider_order_ref: string | null;
  checkout_url: string | null; provider_ref: string | null; payment_id: string | null;
  failure_reason: CardCheckoutFailureReason | null; captured_amount: bigint | null; requested_by: string; created_at: string; updated_at: string;
  attention_cause: CardCheckoutAttentionCause | null; resolution: CardCheckoutResolution | null; resolved_at: string | null;
  resolved_by: string | null; resolution_reason: string | null;
}

function toCardCheckout(r: CardCheckoutRow): CardCheckout {
  return {
    id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id, provider: r.provider,
    amount: Money.fromScaled(r.amount), currency: r.currency, status: r.status,
    providerOrderRef: r.provider_order_ref, checkoutUrl: r.checkout_url, providerRef: r.provider_ref,
    paymentId: r.payment_id, failureReason: r.failure_reason,
    capturedAmount: r.captured_amount === null ? null : Money.fromScaled(r.captured_amount),
    requestedBy: r.requested_by,
    attentionCause: r.attention_cause, resolution: r.resolution, resolvedAt: r.resolved_at,
    resolvedBy: r.resolved_by, resolutionReason: r.resolution_reason,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

class SqlCardCheckoutStore implements CardCheckoutRepository {
  constructor(private readonly db: SqlDb) {}

  async insert(c: CardCheckout): Promise<void> {
    await this.db.run(
      `INSERT INTO card_checkout (id, tenant_id, subscription_id, provider, amount, currency, status, provider_order_ref,
         checkout_url, provider_ref, payment_id, failure_reason, requested_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.id, c.tenantId, c.subscriptionId, c.provider, c.amount.scaled, c.currency, c.status, c.providerOrderRef,
        c.checkoutUrl, c.providerRef, c.paymentId, c.failureReason, c.requestedBy, c.createdAt, c.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<CardCheckout | null> {
    const row = await this.db.get<CardCheckoutRow>(`SELECT * FROM card_checkout WHERE id = ?`, [id]);
    return row ? toCardCheckout(row) : null;
  }

  async findByProviderOrder(provider: PaymentProviderId, providerOrderRef: string): Promise<CardCheckout | null> {
    const row = await this.db.get<CardCheckoutRow>(`SELECT * FROM card_checkout WHERE provider = ? AND provider_order_ref = ?`, [provider, providerOrderRef]);
    return row ? toCardCheckout(row) : null;
  }

  async listByTenant(tenantId: string): Promise<CardCheckout[]> {
    return (await this.db.all<CardCheckoutRow>(`SELECT * FROM card_checkout WHERE tenant_id = ? ORDER BY created_at DESC, id DESC`, [tenantId])).map(toCardCheckout);
  }

  async listSweepable(openedAtOrBefore: string, declinedOpenedAfter: string, limit: number): Promise<CardCheckout[]> {
    const rows = await this.db.all<CardCheckoutRow>(
      `SELECT * FROM card_checkout
        WHERE created_at <= ?
          AND resolved_at IS NULL
          AND (status = 'pending' OR (status = 'failed' AND failure_reason = ? AND created_at > ?))
        ORDER BY COALESCE(swept_at, '') ASC, created_at ASC, id ASC LIMIT ?`,
      [openedAtOrBefore, CardCheckoutFailureReason.Declined, declinedOpenedAfter, limit],
    );
    return rows.map(toCardCheckout);
  }

  async markSwept(checkoutId: string, now: string): Promise<void> {
    await this.db.run(`UPDATE card_checkout SET swept_at = ? WHERE id = ?`, [now, checkoutId]);
  }

  async flagNeedsAttention(checkoutId: string, cause: CardCheckoutAttentionCause, now: string): Promise<boolean> {
    const reason = CardCheckoutFailureReason.NeedsAttention;
    const result = await this.db.run(
      `UPDATE card_checkout SET failure_reason = ?, attention_cause = ?, updated_at = ?
        WHERE id = ? AND status = 'pending' AND (failure_reason IS NULL OR failure_reason <> ?)`,
      [reason, cause, now, checkoutId, reason],
    );
    return result.changes === 1;
  }

  async resolveFlagged(input: Parameters<CardCheckoutRepository["resolveFlagged"]>[0]): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE card_checkout SET status = ?, resolution = ?, resolved_at = ?, resolved_by = ?,
         resolution_reason = ?, updated_at = ?
        WHERE id = ? AND status = 'pending' AND failure_reason = ? AND resolved_at IS NULL`,
      [input.status, input.resolution, input.now, input.resolvedBy, input.reason, input.now, input.checkoutId, CardCheckoutFailureReason.NeedsAttention],
    );
    return result.changes === 1;
  }

  async attachSession(id: string, providerOrderRef: string, checkoutUrl: string, now: string): Promise<void> {
    const result = await this.db.run(
      `UPDATE card_checkout SET provider_order_ref = ?, checkout_url = ?, updated_at = ? WHERE id = ? AND provider_order_ref IS NULL`,
      [providerOrderRef, checkoutUrl, now, id],
    );
    if (result.changes !== 1) throw new Error(`card checkout ${id} already has a provider order`);
  }

  private async casCheckout(id: string, from: readonly CardCheckoutStatus[], to: CardCheckoutSettlement): Promise<boolean> {
    if (from.length === 0) return false;
    const result = await this.db.run(
      `UPDATE card_checkout SET status = ?, provider_ref = ?, payment_id = ?, failure_reason = ?,
         captured_amount = COALESCE(?, captured_amount), updated_at = ?
       WHERE id = ? AND status IN (${placeholders(from.length)})`,
      [to.status, to.providerRef, to.paymentId, to.failureReason, to.capturedAmount?.scaled ?? null, to.now, id, ...from],
    );
    return result.changes === 1;
  }

  private async claim(provider: PaymentProviderId, providerRef: string, now: string): Promise<boolean> {
    const result = await this.db.run(
      `INSERT INTO payment_provider_event (provider, provider_ref, received_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
      [provider, providerRef, now],
    );
    return result.changes === 1;
  }

  async recordOutcome(input: Parameters<CardCheckoutRepository["recordOutcome"]>[0]): Promise<ProviderEventOutcome> {
    return this.db.transaction(async () => {
      if (!(await this.claim(input.provider, input.providerRef, input.now))) return ProviderEventOutcome.Duplicate;
      if (!input.settle) return ProviderEventOutcome.Unchanged;
      return (await this.casCheckout(input.settle.checkoutId, input.settle.from, input.settle.to)) ? ProviderEventOutcome.Settled : ProviderEventOutcome.Unchanged;
    }, TransactionMode.Immediate);
  }

  async abandon(checkoutId: string, failureReason: CardCheckoutFailureReason, now: string): Promise<void> {
    await this.casCheckout(checkoutId, [CardCheckoutStatus.Pending], { status: CardCheckoutStatus.Failed, providerRef: null, paymentId: null, failureReason, now });
  }

  async settlePaid(input: Parameters<CardCheckoutRepository["settlePaid"]>[0]): Promise<PaidSettlementOutcome> {
    const { subscriptionBefore: before, subscriptionAfter: after, payment: p } = input;
    try {
      return await this.db.transaction(async (): Promise<PaidSettlementOutcome> => {
        // BEFORE the claim: a reference the tenant already holds must leave the
        // provider's transaction id unclaimed, so the caller can still settle it
        // as unapplied under that same id.
        const claimRef = input.claimRef ?? input.providerRef;
        const alreadyClaimed = (await this.db.get(`SELECT 1 AS claimed FROM payment_provider_event WHERE provider = ? AND provider_ref = ?`, [input.provider, claimRef])) !== undefined;
        if (!alreadyClaimed && (await this.db.get(`SELECT 1 AS taken FROM payment WHERE tenant_id = ? AND reference = ? LIMIT 1`, [p.tenantId, p.reference]))) {
          return PaidSettlementOutcome.ReferenceTaken;
        }
        if (!(await this.claim(input.provider, claimRef, input.now))) return PaidSettlementOutcome.Duplicate;
        const moved = await this.casCheckout(input.checkoutId, input.from, {
          status: CardCheckoutStatus.Paid, providerRef: input.providerRef, paymentId: p.id, failureReason: null, now: input.now,
        });
        if (!moved) return PaidSettlementOutcome.AlreadySettled;
        const renewed = await this.db.run(
          `UPDATE subscription SET status = ?, trial_ends_at = ?, current_period_start = ?,
             current_period_end = ?, billing_anchor_day = ?, billing_anchor_review = ?,
             updated_at = ?
           WHERE id = ? AND status = ? AND updated_at = ? AND current_period_end = ?`,
          [
            after.status, after.trialEndsAt, after.currentPeriodStart,
            after.currentPeriodEnd, after.billingAnchorDay ?? null, after.billingAnchorNeedsReview === true ? 1 : 0,
            after.updatedAt,
            after.id, before.status, before.updatedAt, before.currentPeriodEnd,
          ],
        );
        // Thrown, not returned: the claim and the checkout move above must roll back with it.
        if (renewed.changes !== 1) throw new SubscriptionChanged();
        await this.db.run(
          `INSERT INTO payment (${PAYMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, p.tenantId, p.subscriptionId, p.amount.scaled, p.currency, p.reference, p.paidAt, p.recordedBy, p.note, p.createdAt],
        );
        return PaidSettlementOutcome.Paid;
      }, TransactionMode.Immediate);
    } catch (err) {
      if (err instanceof SubscriptionChanged) return PaidSettlementOutcome.SubscriptionChanged;
      throw err;
    }
  }
}

class SubscriptionChanged extends Error {}

interface SignupRequestRow {
  id: string; code: string; name_ar: string; name_en: string | null;
  owner_email: string; owner_name_ar: string; plan_id: string; billing_cycle: SignupRequest["billingCycle"];
  token_hash: string; status: SignupRequest["status"]; expires_at: string; created_at: string; verified_at: string | null;
  intended_plan_id?: string | null;
  decision?: SignupDecision | null; decided_at?: string | null; decided_by?: string | null;
}

function toSignupRequest(r: SignupRequestRow): SignupRequest {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en,
    ownerEmail: r.owner_email, ownerNameAr: r.owner_name_ar, planId: r.plan_id, billingCycle: r.billing_cycle,
    tokenHash: r.token_hash, status: r.status, expiresAt: r.expires_at, createdAt: r.created_at, verifiedAt: r.verified_at,
    ...(r.intended_plan_id ? { intendedPlanId: r.intended_plan_id } : {}),
    decision: r.decision ?? null, decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null,
  };
}

class SqlSignupRequestStore implements SignupRequestRepository {
  constructor(private readonly db: SqlDb) {}

  async findByTokenHash(tokenHash: string): Promise<SignupRequest | null> {
    const row = await this.db.get<SignupRequestRow>(`SELECT * FROM signup_request WHERE token_hash = ?`, [tokenHash]);
    return row ? toSignupRequest(row) : null;
  }

  async findActiveByCode(code: string, nowIso: string): Promise<SignupRequest | null> {
    const holdSince = new Date(new Date(nowIso).getTime() - VERIFIED_LINK_VALID_MS).toISOString();
    const row = await this.db.get<SignupRequestRow>(
      `SELECT * FROM signup_request
       WHERE code = ? AND ((status = ? AND expires_at > ?) OR (status = ? AND decision IS NULL AND verified_at > ?))
       ORDER BY created_at DESC LIMIT 1`,
      [code, SignupRequestStatus.Pending, nowIso, SignupRequestStatus.Verified, holdSince],
    );
    return row ? toSignupRequest(row) : null;
  }

  async findById(id: string): Promise<SignupRequest | null> {
    const row = await this.db.get<SignupRequestRow>(`SELECT * FROM signup_request WHERE id = ?`, [id]);
    return row ? toSignupRequest(row) : null;
  }

  async listAwaitingDecision(nowIso: string): Promise<SignupRequest[]> {
    const holdSince = new Date(new Date(nowIso).getTime() - VERIFIED_LINK_VALID_MS).toISOString();
    const rows = await this.db.all<SignupRequestRow>(
      `SELECT * FROM signup_request
       WHERE status = ? AND decision IS NULL AND verified_at > ?
         AND code NOT IN (
           SELECT code FROM tenant WHERE NOT (tenant.status = ? AND tenant.owner_email = signup_request.owner_email)
         )
       ORDER BY verified_at, created_at`,
      [SignupRequestStatus.Verified, holdSince, TenantStatusCode.Provisioning],
    );
    return rows.map(toSignupRequest);
  }

  // Only an undecided verified row moves, so two clicks (approve and reject, or approve twice) cannot both win.
  async tryDecide(id: string, decision: SignupDecision, decidedBy: string, nowIso: string): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE signup_request SET decision = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = ? AND decision IS NULL`,
      [decision, nowIso, decidedBy, id, SignupRequestStatus.Verified],
    );
    return result.changes === 1;
  }

  // The conditional WHERE is the whole point: only a row still `pending`
  // moves, so two concurrent callers can never both believe they were the
  // one to flip it (`changes` is 1 for exactly one of them).
  async tryMarkVerified(tokenHash: string, nowIso: string): Promise<SignupRequest | null> {
    const result = await this.db.run(`UPDATE signup_request SET status = ?, verified_at = ? WHERE token_hash = ? AND status = ?`, [
      SignupRequestStatus.Verified,
      nowIso,
      tokenHash,
      SignupRequestStatus.Pending,
    ]);
    if (result.changes !== 1) return null;
    return this.findByTokenHash(tokenHash);
  }

  // REQUIRED ORDERING: IMMEDIATE, because the stale-claim delete and the insert must be one write transaction,
  // or two processes can both delete the same dead claim and both believe they hold it.
  async tryClaimProvisioning(tokenHash: string, claimId: string, nowIso: string, staleBeforeIso: string): Promise<boolean> {
    return this.db.transaction(async () => {
      await this.db.run(`DELETE FROM signup_provision_claim WHERE token_hash = ? AND claimed_at < ?`, [tokenHash, staleBeforeIso]);
      const inserted = await this.db.run(`INSERT INTO signup_provision_claim (token_hash, claim_id, claimed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, [
        tokenHash,
        claimId,
        nowIso,
      ]);
      if (inserted.changes !== 1) return false;
      await this.db.run(`UPDATE signup_provision_claim SET fence = ? WHERE token_hash = ? AND claim_id = ?`, [await this.takeProvisionFence(nowIso), tokenHash, claimId]);
      return true;
    }, TransactionMode.Immediate);
  }

  async renewProvisioning(tokenHash: string, claimId: string, nowIso: string): Promise<boolean> {
    return (await this.db.run(`UPDATE signup_provision_claim SET claimed_at = ? WHERE token_hash = ? AND claim_id = ?`, [nowIso, tokenHash, claimId])).changes === 1;
  }

  async provisioningClaimedAt(tokenHash: string): Promise<string | null> {
    const row = await this.db.get<{ claimed_at: string }>(`SELECT claimed_at FROM signup_provision_claim WHERE token_hash = ?`, [tokenHash]);
    return row?.claimed_at ?? null;
  }

  async provisioningFence(tokenHash: string, claimId: string): Promise<number | null> {
    const fence = (await this.db.get<{ fence: bigint | null }>(`SELECT fence FROM signup_provision_claim WHERE token_hash = ? AND claim_id = ?`, [tokenHash, claimId]))?.fence;
    return fence === undefined || fence === null ? null : Number(fence);
  }

  async takeProvisionFence(nowIso: string): Promise<number> {
    const row = await this.db.get<{ generation: bigint }>(`INSERT INTO provision_fence (taken_at) VALUES (?) RETURNING generation`, [nowIso]);
    return Number(row!.generation);
  }

  async releaseByCode(code: string): Promise<void> {
    await this.db.run(`DELETE FROM signup_provision_claim WHERE token_hash IN (SELECT token_hash FROM signup_request WHERE code = ?)`, [code]);
    await this.db.run(`UPDATE signup_request SET status = ? WHERE code = ?`, [SignupRequestStatus.Released, code]);
  }

  async followOwnerEmail(code: string, before: string, after: string): Promise<void> {
    await this.db.run(`UPDATE signup_request SET owner_email = ? WHERE code = ? AND owner_email = ? AND status = ?`, [after, code, before, SignupRequestStatus.Verified]);
  }

  async releaseProvisioning(tokenHash: string, claimId: string): Promise<void> {
    await this.db.run(`DELETE FROM signup_provision_claim WHERE token_hash = ? AND claim_id = ?`, [tokenHash, claimId]);
  }

  async save(r: SignupRequest): Promise<void> {
    await this.db.run(
      `INSERT INTO signup_request (id, code, name_ar, name_en, owner_email, owner_name_ar, plan_id, billing_cycle,
         token_hash, status, expires_at, created_at, verified_at, intended_plan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code, name_ar = excluded.name_ar, name_en = excluded.name_en, owner_email = excluded.owner_email,
         owner_name_ar = excluded.owner_name_ar, plan_id = excluded.plan_id, billing_cycle = excluded.billing_cycle,
         token_hash = excluded.token_hash, status = excluded.status, expires_at = excluded.expires_at,
         created_at = excluded.created_at, verified_at = excluded.verified_at, intended_plan_id = excluded.intended_plan_id`,
      [
        r.id, r.code, r.nameAr, r.nameEn, r.ownerEmail, r.ownerNameAr, r.planId, r.billingCycle,
        r.tokenHash, r.status, r.expiresAt, r.createdAt, r.verifiedAt, r.intendedPlanId ?? null,
      ],
    );
  }
}

class SqlPlatformSettingStore implements PlatformSettingRepository {
  constructor(private readonly db: SqlDb) {}

  async get(key: PlatformSettingKey): Promise<string | null> {
    return (await this.db.get<{ value: string }>(`SELECT value FROM platform_setting WHERE key = ?`, [key]))?.value ?? null;
  }

  async set(key: PlatformSettingKey, value: string, nowIso: string): Promise<void> {
    await this.db.run(
      `INSERT INTO platform_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, nowIso],
    );
  }
}

class SqlSignInEmailStore implements SignInEmailRepository {
  constructor(private readonly db: SqlDb) {}

  async tenantOf(email: string): Promise<string | null> {
    return (await this.db.get<{ tenant_id: string }>(`SELECT tenant_id FROM sign_in_email WHERE email = ?`, [normalizeEmail(email)]))?.tenant_id ?? null;
  }

  async claim(email: string, tenantId: string): Promise<boolean> {
    const key = normalizeEmail(email);
    return this.db.transaction(async () => {
      await this.db.run(`INSERT INTO sign_in_email (email, tenant_id) VALUES (?, ?) ON CONFLICT(email) DO NOTHING`, [key, tenantId]);
      return (await this.tenantOf(key)) === tenantId;
    });
  }

  async release(email: string, tenantId: string): Promise<void> {
    await this.db.transaction(() => this.db.run(`DELETE FROM sign_in_email WHERE email = ? AND tenant_id = ?`, [normalizeEmail(email), tenantId]));
  }

  async replaceTenant(tenantId: string, emails: readonly string[]): Promise<readonly string[]> {
    const wanted = [...new Set(emails.map(normalizeEmail))];
    return this.db.transaction(async () => {
      const held = await this.db.all<{ email: string }>(`SELECT email FROM sign_in_email WHERE tenant_id = ?`, [tenantId]);
      const keep = new Set(wanted);
      for (const { email } of held) if (!keep.has(email)) await this.release(email, tenantId);
      const elsewhere: string[] = [];
      for (const email of wanted) if (!(await this.claim(email, tenantId))) elsewhere.push(email);
      return elsewhere;
    });
  }

  async forgetTenant(tenantId: string): Promise<void> {
    await this.db.transaction(() => this.db.run(`DELETE FROM sign_in_email WHERE tenant_id = ?`, [tenantId]));
  }
}

export interface PlatformStoresHandle {
  readonly tenants: TenantRepository;
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionTransitionRepository;
  readonly platformUsers: PlatformUserRepository;
  readonly payments: PaymentRepository;
  readonly cardCheckouts: CardCheckoutRepository;
  readonly signupRequests: SignupRequestRepository;
  readonly moduleTrials: ModuleTrialRepository;
  readonly settings: PlatformSettingRepository;
  readonly signInEmails: SignInEmailRepository;
}

export interface SqlitePlatformStoresHandle extends PlatformStoresHandle {
  readonly sqlite: Database.Database;
  close(): void;
}

const RETIRED_PAYMENT_REFERENCE_INDEX = "ux_payment_tenant_reference";

// A reference is what the bank or the customer wrote and can legitimately
// repeat, so it is no longer unique: the release that made it so silently
// dropped a second genuine payment. What may never repeat is one SUBMISSION,
// which the client's idempotency key identifies. Rows written before the key
// existed carry NULL and are left out of the index.
// A card payment's PAYMOB-<transaction> reference is kept single by
// `SqlCardCheckoutStore.settlePaid`, which checks it inside its transaction.
const PAYMENT_INDEXES = `
    DROP INDEX IF EXISTS ${RETIRED_PAYMENT_REFERENCE_INDEX};
    CREATE INDEX IF NOT EXISTS idx_payment_tenant_reference ON payment (tenant_id, reference);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_tenant_idempotency_key
      ON payment (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  `;

function ensurePaymentIndexes(sqlite: Database.Database): void {
  sqlite.exec(PAYMENT_INDEXES);
}

// A Postgres platform schema is always created at the current shape, so none
// of the SQLite upgrade passes below apply to it.
export async function ensurePlatformSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${TENANT_DB_FILE_INDEX} ON tenant(db_file)`);
  await db.exec(PAYMENT_INDEXES);
}

export function createPlatformStores(db: SqlDb): PlatformStoresHandle {
  return {
    tenants: new SqlTenantStore(db),
    plans: new SqlPlanStore(db),
    subscriptions: new SqlSubscriptionStore(db),
    platformUsers: new SqlPlatformUserStore(db),
    payments: new SqlPaymentStore(db),
    cardCheckouts: new SqlCardCheckoutStore(db),
    signupRequests: new SqlSignupRequestStore(db),
    moduleTrials: new SqlModuleTrialStore(db),
    settings: new SqlPlatformSettingStore(db),
    signInEmails: new SqlSignInEmailStore(db),
  };
}

export function createSqlitePlatformStores(
  path: SqliteConnectionInput = ":memory:",
  options: SqliteOpenOptions = {},
): SqlitePlatformStoresHandle {
  const { sqlite, owned } = openSqliteConnection(path, options);
  sqlite.exec(CREATE_TABLES);
  addMissingColumns(sqlite);
  dropRetiredBooksReview(sqlite);
  rewriteOwnerTextAsThisBuildWritesIt(sqlite);
  guardOneDbFilePerTenant(sqlite);
  ensurePaymentIndexes(sqlite);
  backfillBillingAnchors(sqlite);
  repairUtcBillingAnchors(sqlite, UTC_ANCHOR_REPAIR, UtcAnchorRepairScope.EveryAnchor);
  repairUtcBillingAnchors(sqlite, UTC_ANCHOR_UNRENEWED_REPAIR, UtcAnchorRepairScope.LeftForReview);
  repairPeriodEnds(sqlite, PERIOD_END_REPAIR);
  repairPeriodEnds(sqlite, PERIOD_END_SHORT_REPAIR);
  repairPeriodEnds(sqlite, PERIOD_END_SUMMER_TIME_REPAIR);
  return {
    ...createPlatformStores(sqliteDb(sqlite)),
    sqlite,
    close: () => { if (owned) sqlite.close(); },
  };
}
