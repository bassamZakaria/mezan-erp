import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  type Lead,
  type LeadRepository,
  type LeadSource,
  type LeadStatus,
  type Opportunity,
  type OpportunityRepository,
  type OpportunityStatus,
  type OpportunityLostReason,
  type OpportunityStageEntry,
  type OpportunityStageHistorySource,
  type ActivityReminderLog,
  type PipelineStage,
  type PipelineStageRepository,
  type Activity,
  type ActivityRepository,
  type ActivityStatus,
  type ActivityType,
} from "@mezan/domain";

/**
 * Stores for CRM (docs/archive/catalog/06 "العملاء المحتملون /
 * الفرص / خط المبيعات / الأنشطة"). Four simple scalar-field entities, no
 * line-item arrays, so each mirrors `cost-center-repository.ts`'s
 * single-table style.
 */

// --- Lead --------------------------------------------------------------

const CREATE_LEAD = `
CREATE TABLE IF NOT EXISTS crm_lead (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  company                  TEXT,
  email                    TEXT,
  phone                    TEXT,
  source                   TEXT NOT NULL,
  expected_value           INTEGER,
  interest                 TEXT,
  notes                    TEXT,
  status                   TEXT NOT NULL,
  converted_customer_id    TEXT,
  converted_opportunity_id TEXT,
  created_at               TEXT NOT NULL
);
`;

interface LeadRow {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  expected_value: bigint | null;
  interest: string | null;
  notes: string | null;
  status: string;
  converted_customer_id: string | null;
  converted_opportunity_id: string | null;
  created_at: string;
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    source: row.source as LeadSource,
    expectedValue: row.expected_value == null ? null : Money.fromScaled(row.expected_value),
    interest: row.interest,
    notes: row.notes,
    status: row.status as LeadStatus,
    convertedCustomerId: row.converted_customer_id,
    convertedOpportunityId: row.converted_opportunity_id,
    createdAt: row.created_at,
  };
}

const LEAD_UPSERT = `
      INSERT INTO crm_lead (id, name, company, email, phone, source, expected_value, interest, notes, status, converted_customer_id, converted_opportunity_id, created_at)
      VALUES (${placeholders(13)})
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        company = excluded.company,
        email = excluded.email,
        phone = excluded.phone,
        source = excluded.source,
        expected_value = excluded.expected_value,
        interest = excluded.interest,
        notes = excluded.notes,
        status = excluded.status,
        converted_customer_id = excluded.converted_customer_id,
        converted_opportunity_id = excluded.converted_opportunity_id`;

function leadParams(lead: Lead): SqlValue[] {
  return [
    lead.id,
    lead.name,
    lead.company,
    lead.email,
    lead.phone,
    lead.source,
    lead.expectedValue == null ? null : lead.expectedValue.scaled,
    lead.interest,
    lead.notes,
    lead.status,
    lead.convertedCustomerId,
    lead.convertedOpportunityId,
    lead.createdAt,
  ];
}

class SqlLeadRepository implements LeadRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Lead | null> {
    const row = await this.db.get<LeadRow>(`SELECT * FROM crm_lead WHERE id = ?`, [id]);
    return row ? toLead(row) : null;
  }

  async list(): Promise<Lead[]> {
    return (await this.db.all<LeadRow>(`SELECT * FROM crm_lead`)).map(toLead);
  }

  async create(lead: Lead): Promise<void> {
    await insertNew(this.db, lead.id, LEAD_UPSERT, leadParams(lead));
  }

  async update(lead: Lead): Promise<void> {
    await this.db.run(LEAD_UPSERT, leadParams(lead));
  }
}

// --- Opportunity ---------------------------------------------------------

const CREATE_OPPORTUNITY = `
CREATE TABLE IF NOT EXISTS crm_opportunity (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  customer_id          TEXT NOT NULL,
  branch_id            TEXT,
  stage_id             TEXT NOT NULL,
  expected_value       INTEGER NOT NULL,
  probability          INTEGER NOT NULL,
  expected_close_date  TEXT,
  notes                TEXT,
  owner_user_id        TEXT,
  lost_reason          TEXT,
  lost_note            TEXT,
  status               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  closed_at            TEXT
);
`;

const CREATE_OPPORTUNITY_STAGE_ENTRY = `
CREATE TABLE IF NOT EXISTS crm_opportunity_stage_entry (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id  TEXT NOT NULL,
  stage_id        TEXT NOT NULL,
  entered_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_opportunity_stage_entry_opp ON crm_opportunity_stage_entry(opportunity_id, seq);
`;

const CREATE_OPPORTUNITY_OWNER_INDEX = `CREATE INDEX IF NOT EXISTS idx_crm_opportunity_owner ON crm_opportunity(owner_user_id)`;

interface OpportunityRow {
  id: string;
  title: string;
  customer_id: string;
  branch_id: string | null;
  stage_id: string;
  expected_value: bigint;
  probability: bigint;
  expected_close_date: string | null;
  notes: string | null;
  owner_user_id: string | null;
  lost_reason: string | null;
  lost_note: string | null;
  status: string;
  created_at: string;
  closed_at: string | null;
}

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    title: row.title,
    customerId: row.customer_id,
    branchId: row.branch_id,
    stageId: row.stage_id,
    expectedValue: Money.fromScaled(row.expected_value),
    probability: Number(row.probability),
    expectedCloseDate: row.expected_close_date,
    notes: row.notes,
    ownerUserId: row.owner_user_id,
    lostReason: row.lost_reason as OpportunityLostReason | null,
    lostNote: row.lost_note,
    status: row.status as OpportunityStatus,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

const OPPORTUNITY_UPSERT = `
      INSERT INTO crm_opportunity (id, title, customer_id, branch_id, stage_id, expected_value, probability, expected_close_date, notes, owner_user_id, lost_reason, lost_note, status, created_at, closed_at)
      VALUES (${placeholders(15)})
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        customer_id = excluded.customer_id,
        branch_id = excluded.branch_id,
        stage_id = excluded.stage_id,
        expected_value = excluded.expected_value,
        probability = excluded.probability,
        expected_close_date = excluded.expected_close_date,
        notes = excluded.notes,
        owner_user_id = excluded.owner_user_id,
        lost_reason = excluded.lost_reason,
        lost_note = excluded.lost_note,
        status = excluded.status,
        closed_at = excluded.closed_at`;

function opportunityParams(opportunity: Opportunity): SqlValue[] {
  return [
    opportunity.id,
    opportunity.title,
    opportunity.customerId,
    opportunity.branchId,
    opportunity.stageId,
    opportunity.expectedValue.scaled,
    opportunity.probability,
    opportunity.expectedCloseDate,
    opportunity.notes,
    opportunity.ownerUserId,
    opportunity.lostReason,
    opportunity.lostNote,
    opportunity.status,
    opportunity.createdAt,
    opportunity.closedAt,
  ];
}

const INSERT_STAGE_ENTRY = `INSERT INTO crm_opportunity_stage_entry (opportunity_id, stage_id, entered_at) VALUES (?, ?, ?)`;

class SqlOpportunityRepository implements OpportunityRepository, OpportunityStageHistorySource {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Opportunity | null> {
    const row = await this.db.get<OpportunityRow>(`SELECT * FROM crm_opportunity WHERE id = ?`, [id]);
    return row ? toOpportunity(row) : null;
  }

  async list(): Promise<Opportunity[]> {
    return (await this.db.all<OpportunityRow>(`SELECT * FROM crm_opportunity`)).map(toOpportunity);
  }

  async create(opportunity: Opportunity): Promise<void> {
    await this.write(opportunity, true);
  }

  async update(opportunity: Opportunity): Promise<void> {
    await this.write(opportunity, false);
  }

  async entries(): Promise<OpportunityStageEntry[]> {
    const rows = await this.db.all<{ opportunity_id: string; stage_id: string; entered_at: string }>(
      `SELECT opportunity_id, stage_id, entered_at FROM crm_opportunity_stage_entry ORDER BY seq`,
    );
    return rows.map((row) => ({
      opportunityId: row.opportunity_id,
      stageId: row.stage_id,
      enteredAt: row.entered_at,
    }));
  }

  private async recordStageEntry(opportunity: Opportunity, priorStageId: string | null): Promise<void> {
    const last = await this.db.get<{ stage_id: string }>(
      `SELECT stage_id FROM crm_opportunity_stage_entry WHERE opportunity_id = ? ORDER BY seq DESC LIMIT 1`,
      [opportunity.id],
    );
    if (last === undefined) {
      await this.db.run(INSERT_STAGE_ENTRY, [opportunity.id, priorStageId ?? opportunity.stageId, opportunity.createdAt]);
      if (priorStageId === null || priorStageId === opportunity.stageId) return;
    } else if (last.stage_id === opportunity.stageId) return;
    await this.db.run(INSERT_STAGE_ENTRY, [opportunity.id, opportunity.stageId, opportunity.closedAt ?? new Date().toISOString()]);
  }

  private write(opportunity: Opportunity, insertOnly: boolean): Promise<void> {
    return this.db.transaction(async () => {
      const prior = await this.db.get<{ stage_id: string }>(`SELECT stage_id FROM crm_opportunity WHERE id = ?`, [opportunity.id]);
      if (insertOnly) await insertNew(this.db, opportunity.id, OPPORTUNITY_UPSERT, opportunityParams(opportunity));
      else await this.db.run(OPPORTUNITY_UPSERT, opportunityParams(opportunity));
      await this.recordStageEntry(opportunity, prior?.stage_id ?? null);
    });
  }
}

// --- Pipeline Stage --------------------------------------------------------

const CREATE_PIPELINE_STAGE = `
CREATE TABLE IF NOT EXISTS crm_pipeline_stage (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  "order"              INTEGER NOT NULL,
  default_probability  INTEGER NOT NULL,
  color                TEXT NOT NULL,
  is_win_stage         INTEGER NOT NULL,
  is_loss_stage        INTEGER NOT NULL,
  active               INTEGER NOT NULL
);
`;

interface PipelineStageRow {
  id: string;
  name: string;
  order: bigint;
  default_probability: bigint;
  color: string;
  is_win_stage: bigint;
  is_loss_stage: bigint;
  active: bigint;
}

function toPipelineStage(row: PipelineStageRow): PipelineStage {
  return {
    id: row.id,
    name: row.name,
    order: Number(row.order),
    defaultProbability: Number(row.default_probability),
    color: row.color,
    isWinStage: Number(row.is_win_stage) === 1,
    isLossStage: Number(row.is_loss_stage) === 1,
    active: Number(row.active) === 1,
  };
}

const PIPELINE_STAGE_UPSERT = `
      INSERT INTO crm_pipeline_stage (id, name, "order", default_probability, color, is_win_stage, is_loss_stage, active)
      VALUES (${placeholders(8)})
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        "order" = excluded."order",
        default_probability = excluded.default_probability,
        color = excluded.color,
        is_win_stage = excluded.is_win_stage,
        is_loss_stage = excluded.is_loss_stage,
        active = excluded.active`;

function pipelineStageParams(stage: PipelineStage): SqlValue[] {
  return [
    stage.id,
    stage.name,
    stage.order,
    stage.defaultProbability,
    stage.color,
    stage.isWinStage ? 1 : 0,
    stage.isLossStage ? 1 : 0,
    stage.active ? 1 : 0,
  ];
}

class SqlPipelineStageRepository implements PipelineStageRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<PipelineStage | null> {
    const row = await this.db.get<PipelineStageRow>(`SELECT * FROM crm_pipeline_stage WHERE id = ?`, [id]);
    return row ? toPipelineStage(row) : null;
  }

  async list(): Promise<PipelineStage[]> {
    return (await this.db.all<PipelineStageRow>(`SELECT * FROM crm_pipeline_stage`)).map(toPipelineStage);
  }

  async create(stage: PipelineStage): Promise<void> {
    await insertNew(this.db, stage.id, PIPELINE_STAGE_UPSERT, pipelineStageParams(stage));
  }

  async update(stage: PipelineStage): Promise<void> {
    await this.db.run(PIPELINE_STAGE_UPSERT, pipelineStageParams(stage));
  }
}

// --- Activity ----------------------------------------------------------

const CREATE_ACTIVITY = `
CREATE TABLE IF NOT EXISTS crm_activity (
  id                       TEXT PRIMARY KEY,
  subject                  TEXT NOT NULL,
  type                     TEXT NOT NULL,
  related_lead_id          TEXT,
  related_opportunity_id   TEXT,
  due_date                 TEXT,
  assignee_user_id         TEXT,
  status                   TEXT NOT NULL,
  notes                    TEXT,
  created_at               TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_activity_reminder (
  activity_id  TEXT NOT NULL,
  due_date     TEXT NOT NULL,
  notified_at  TEXT NOT NULL,
  PRIMARY KEY (activity_id, due_date)
);
`;

interface ActivityRow {
  id: string;
  subject: string;
  type: string;
  related_lead_id: string | null;
  related_opportunity_id: string | null;
  due_date: string | null;
  assignee_user_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    subject: row.subject,
    type: row.type as ActivityType,
    relatedLeadId: row.related_lead_id,
    relatedOpportunityId: row.related_opportunity_id,
    dueDate: row.due_date,
    assigneeUserId: row.assignee_user_id,
    status: row.status as ActivityStatus,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

const ACTIVITY_UPSERT = `
      INSERT INTO crm_activity (id, subject, type, related_lead_id, related_opportunity_id, due_date, assignee_user_id, status, notes, created_at)
      VALUES (${placeholders(10)})
      ON CONFLICT(id) DO UPDATE SET
        subject = excluded.subject,
        type = excluded.type,
        related_lead_id = excluded.related_lead_id,
        related_opportunity_id = excluded.related_opportunity_id,
        due_date = excluded.due_date,
        assignee_user_id = excluded.assignee_user_id,
        status = excluded.status,
        notes = excluded.notes`;

function activityParams(activity: Activity): SqlValue[] {
  return [
    activity.id,
    activity.subject,
    activity.type,
    activity.relatedLeadId,
    activity.relatedOpportunityId,
    activity.dueDate,
    activity.assigneeUserId,
    activity.status,
    activity.notes,
    activity.createdAt,
  ];
}

class SqlActivityRepository implements ActivityRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Activity | null> {
    const row = await this.db.get<ActivityRow>(`SELECT * FROM crm_activity WHERE id = ?`, [id]);
    return row ? toActivity(row) : null;
  }

  async list(): Promise<Activity[]> {
    return (await this.db.all<ActivityRow>(`SELECT * FROM crm_activity`)).map(toActivity);
  }

  async create(activity: Activity): Promise<void> {
    await insertNew(this.db, activity.id, ACTIVITY_UPSERT, activityParams(activity));
  }

  async update(activity: Activity): Promise<void> {
    await this.db.run(ACTIVITY_UPSERT, activityParams(activity));
  }
}

class SqlActivityReminderLog implements ActivityReminderLog {
  constructor(private readonly db: SqlDb) {}

  async has(activityId: string, dueDate: string): Promise<boolean> {
    return (await this.db.get(`SELECT 1 AS found FROM crm_activity_reminder WHERE activity_id = ? AND due_date = ?`, [activityId, dueDate])) !== undefined;
  }

  async record(activityId: string, dueDate: string, notifiedAt: string): Promise<void> {
    await this.db.run(
      `INSERT INTO crm_activity_reminder (activity_id, due_date, notified_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
      [activityId, dueDate, notifiedAt],
    );
  }
}

// --- Factories -------------------------------------------------------------

export interface SqliteLeadRepositoryHandle extends LeadRepository {
  close(): void;
}
export interface SqliteOpportunityRepositoryHandle extends OpportunityRepository, OpportunityStageHistorySource {
  close(): void;
}
export interface SqlitePipelineStageRepositoryHandle extends PipelineStageRepository {
  close(): void;
}
export interface SqliteActivityRepositoryHandle extends ActivityRepository {
  close(): void;
}

export async function ensureCrmSchema(db: SqlDb): Promise<void> {
  await db.applySchema(
    [CREATE_LEAD, CREATE_OPPORTUNITY, CREATE_OPPORTUNITY_STAGE_ENTRY, `${CREATE_OPPORTUNITY_OWNER_INDEX};`, CREATE_PIPELINE_STAGE, CREATE_ACTIVITY].join("\n"),
  );
}

export function createLeadRepository(db: SqlDb): LeadRepository {
  return new SqlLeadRepository(db);
}

export function createOpportunityRepository(db: SqlDb): OpportunityRepository & OpportunityStageHistorySource {
  return new SqlOpportunityRepository(db);
}

export function createPipelineStageRepository(db: SqlDb): PipelineStageRepository {
  return new SqlPipelineStageRepository(db);
}

export function createActivityRepository(db: SqlDb): ActivityRepository {
  return new SqlActivityRepository(db);
}

export function createActivityReminderLog(db: SqlDb): ActivityReminderLog {
  return new SqlActivityReminderLog(db);
}

/** Open a SQLite-backed LeadRepository. ":memory:" for tests, a path for real. */
export function createSqliteLeadRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeadRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAD);
  return Object.assign(createLeadRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteLeadRepositoryHandle;
}

/** Adds `branch_id` to a database created before the column existed. */
function addOpportunityBranchColumnIfMissing(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(crm_opportunity)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "branch_id")) {
    sqlite.exec(`ALTER TABLE crm_opportunity ADD COLUMN branch_id TEXT`);
  }
}

function addMissingColumns(sqlite: Database.Database, table: string, columns: Readonly<Record<string, string>>): void {
  const present = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const [name, type] of Object.entries(columns)) {
    if (!present.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/** Open a SQLite-backed OpportunityRepository. ":memory:" for tests, a path for real. */
export function createSqliteOpportunityRepository(path: SqliteConnectionInput = ":memory:"): SqliteOpportunityRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_OPPORTUNITY);
  sqlite.exec(CREATE_OPPORTUNITY_STAGE_ENTRY);
  addOpportunityBranchColumnIfMissing(sqlite);
  addMissingColumns(sqlite, "crm_opportunity", { owner_user_id: "TEXT", lost_reason: "TEXT", lost_note: "TEXT" });
  sqlite.exec(CREATE_OPPORTUNITY_OWNER_INDEX);
  return Object.assign(createOpportunityRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteOpportunityRepositoryHandle;
}

/** Open a SQLite-backed PipelineStageRepository. ":memory:" for tests, a path for real. */
export function createSqlitePipelineStageRepository(path: SqliteConnectionInput = ":memory:"): SqlitePipelineStageRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_PIPELINE_STAGE);
  return Object.assign(createPipelineStageRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqlitePipelineStageRepositoryHandle;
}

/** Open a SQLite-backed ActivityRepository. ":memory:" for tests, a path for real. */
export function createSqliteActivityRepository(path: SqliteConnectionInput = ":memory:"): SqliteActivityRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_ACTIVITY);
  addMissingColumns(sqlite, "crm_activity", { assignee_user_id: "TEXT" });
  return Object.assign(createActivityRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteActivityRepositoryHandle;
}

export interface SqliteActivityReminderLogHandle extends ActivityReminderLog {
  close(): void;
}

/** Remembers which due date of which activity has already been reminded, so a rerun reminds nobody twice. */
export function createSqliteActivityReminderLog(path: SqliteConnectionInput = ":memory:"): SqliteActivityReminderLogHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_ACTIVITY);
  return Object.assign(createActivityReminderLog(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteActivityReminderLogHandle;
}
