import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertingNew, prepareInsertOnly } from "./insert-new.js";
import {
  Money,
  type Lead,
  type LeadRepository,
  type LeadSource,
  type LeadStatus,
  type Opportunity,
  type OpportunityRepository,
  type OpportunityStatus,
  type PipelineStage,
  type PipelineStageRepository,
  type Activity,
  type ActivityRepository,
  type ActivityStatus,
  type ActivityType,
} from "@mezan/domain";

/**
 * Self-contained SQLite stores for CRM (docs/archive/catalog/06 "العملاء المحتملون /
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
  expected_value: number | null;
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

class SqliteLeadRepository implements LeadRepository {
  private readonly upsert: Database.Statement;
  private readonly insertOnly: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO crm_lead (id, name, company, email, phone, source, expected_value, interest, notes, status, converted_customer_id, converted_opportunity_id, created_at)
      VALUES (@id, @name, @company, @email, @phone, @source, @expected_value, @interest, @notes, @status, @converted_customer_id, @converted_opportunity_id, @created_at)
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
        converted_opportunity_id = excluded.converted_opportunity_id
    `);
    this.insertOnly = prepareInsertOnly(sqlite, this.upsert.source);
    this.selectById = sqlite.prepare(`SELECT * FROM crm_lead WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM crm_lead`);
  }

  async findById(id: string): Promise<Lead | null> {
    const row = this.selectById.get(id) as LeadRow | undefined;
    return row ? toLead(row) : null;
  }

  async list(): Promise<Lead[]> {
    return (this.selectAll.all() as LeadRow[]).map(toLead);
  }

  async create(lead: Lead): Promise<void> {
    insertingNew(lead.id, () => this.write(lead, this.insertOnly));
  }

  async update(lead: Lead): Promise<void> {
    this.write(lead);
  }

  private write(lead: Lead, statement: Database.Statement = this.upsert): void {
    statement.run({
      id: lead.id,
      name: lead.name,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      expected_value: lead.expectedValue == null ? null : lead.expectedValue.toScaledNumber(),
      interest: lead.interest,
      notes: lead.notes,
      status: lead.status,
      converted_customer_id: lead.convertedCustomerId,
      converted_opportunity_id: lead.convertedOpportunityId,
      created_at: lead.createdAt,
    });
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
  status               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  closed_at            TEXT
);
`;

interface OpportunityRow {
  id: string;
  title: string;
  customer_id: string;
  branch_id: string | null;
  stage_id: string;
  expected_value: number;
  probability: number;
  expected_close_date: string | null;
  notes: string | null;
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
    probability: row.probability,
    expectedCloseDate: row.expected_close_date,
    notes: row.notes,
    status: row.status as OpportunityStatus,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

class SqliteOpportunityRepository implements OpportunityRepository {
  private readonly upsert: Database.Statement;
  private readonly insertOnly: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO crm_opportunity (id, title, customer_id, branch_id, stage_id, expected_value, probability, expected_close_date, notes, status, created_at, closed_at)
      VALUES (@id, @title, @customer_id, @branch_id, @stage_id, @expected_value, @probability, @expected_close_date, @notes, @status, @created_at, @closed_at)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        customer_id = excluded.customer_id,
        branch_id = excluded.branch_id,
        stage_id = excluded.stage_id,
        expected_value = excluded.expected_value,
        probability = excluded.probability,
        expected_close_date = excluded.expected_close_date,
        notes = excluded.notes,
        status = excluded.status,
        closed_at = excluded.closed_at
    `);
    this.insertOnly = prepareInsertOnly(sqlite, this.upsert.source);
    this.selectById = sqlite.prepare(`SELECT * FROM crm_opportunity WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM crm_opportunity`);
  }

  async findById(id: string): Promise<Opportunity | null> {
    const row = this.selectById.get(id) as OpportunityRow | undefined;
    return row ? toOpportunity(row) : null;
  }

  async list(): Promise<Opportunity[]> {
    return (this.selectAll.all() as OpportunityRow[]).map(toOpportunity);
  }

  async create(opportunity: Opportunity): Promise<void> {
    insertingNew(opportunity.id, () => this.write(opportunity, this.insertOnly));
  }

  async update(opportunity: Opportunity): Promise<void> {
    this.write(opportunity);
  }

  private write(opportunity: Opportunity, statement: Database.Statement = this.upsert): void {
    statement.run({
      id: opportunity.id,
      title: opportunity.title,
      customer_id: opportunity.customerId,
      branch_id: opportunity.branchId,
      stage_id: opportunity.stageId,
      expected_value: opportunity.expectedValue.toScaledNumber(),
      probability: opportunity.probability,
      expected_close_date: opportunity.expectedCloseDate,
      notes: opportunity.notes,
      status: opportunity.status,
      created_at: opportunity.createdAt,
      closed_at: opportunity.closedAt,
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
  order: number;
  default_probability: number;
  color: string;
  is_win_stage: number;
  is_loss_stage: number;
  active: number;
}

function toPipelineStage(row: PipelineStageRow): PipelineStage {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    defaultProbability: row.default_probability,
    color: row.color,
    isWinStage: row.is_win_stage === 1,
    isLossStage: row.is_loss_stage === 1,
    active: row.active === 1,
  };
}

class SqlitePipelineStageRepository implements PipelineStageRepository {
  private readonly upsert: Database.Statement;
  private readonly insertOnly: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO crm_pipeline_stage (id, name, "order", default_probability, color, is_win_stage, is_loss_stage, active)
      VALUES (@id, @name, @order, @default_probability, @color, @is_win_stage, @is_loss_stage, @active)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        "order" = excluded."order",
        default_probability = excluded.default_probability,
        color = excluded.color,
        is_win_stage = excluded.is_win_stage,
        is_loss_stage = excluded.is_loss_stage,
        active = excluded.active
    `);
    this.insertOnly = prepareInsertOnly(sqlite, this.upsert.source);
    this.selectById = sqlite.prepare(`SELECT * FROM crm_pipeline_stage WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM crm_pipeline_stage`);
  }

  async findById(id: string): Promise<PipelineStage | null> {
    const row = this.selectById.get(id) as PipelineStageRow | undefined;
    return row ? toPipelineStage(row) : null;
  }

  async list(): Promise<PipelineStage[]> {
    return (this.selectAll.all() as PipelineStageRow[]).map(toPipelineStage);
  }

  async create(stage: PipelineStage): Promise<void> {
    insertingNew(stage.id, () => this.write(stage, this.insertOnly));
  }

  async update(stage: PipelineStage): Promise<void> {
    this.write(stage);
  }

  private write(stage: PipelineStage, statement: Database.Statement = this.upsert): void {
    statement.run({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      default_probability: stage.defaultProbability,
      color: stage.color,
      is_win_stage: stage.isWinStage ? 1 : 0,
      is_loss_stage: stage.isLossStage ? 1 : 0,
      active: stage.active ? 1 : 0,
    });
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
  status                   TEXT NOT NULL,
  notes                    TEXT,
  created_at               TEXT NOT NULL
);
`;

interface ActivityRow {
  id: string;
  subject: string;
  type: string;
  related_lead_id: string | null;
  related_opportunity_id: string | null;
  due_date: string | null;
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
    status: row.status as ActivityStatus,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

class SqliteActivityRepository implements ActivityRepository {
  private readonly upsert: Database.Statement;
  private readonly insertOnly: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO crm_activity (id, subject, type, related_lead_id, related_opportunity_id, due_date, status, notes, created_at)
      VALUES (@id, @subject, @type, @related_lead_id, @related_opportunity_id, @due_date, @status, @notes, @created_at)
      ON CONFLICT(id) DO UPDATE SET
        subject = excluded.subject,
        type = excluded.type,
        related_lead_id = excluded.related_lead_id,
        related_opportunity_id = excluded.related_opportunity_id,
        due_date = excluded.due_date,
        status = excluded.status,
        notes = excluded.notes
    `);
    this.insertOnly = prepareInsertOnly(sqlite, this.upsert.source);
    this.selectById = sqlite.prepare(`SELECT * FROM crm_activity WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM crm_activity`);
  }

  async findById(id: string): Promise<Activity | null> {
    const row = this.selectById.get(id) as ActivityRow | undefined;
    return row ? toActivity(row) : null;
  }

  async list(): Promise<Activity[]> {
    return (this.selectAll.all() as ActivityRow[]).map(toActivity);
  }

  async create(activity: Activity): Promise<void> {
    insertingNew(activity.id, () => this.write(activity, this.insertOnly));
  }

  async update(activity: Activity): Promise<void> {
    this.write(activity);
  }

  private write(activity: Activity, statement: Database.Statement = this.upsert): void {
    statement.run({
      id: activity.id,
      subject: activity.subject,
      type: activity.type,
      related_lead_id: activity.relatedLeadId,
      related_opportunity_id: activity.relatedOpportunityId,
      due_date: activity.dueDate,
      status: activity.status,
      notes: activity.notes,
      created_at: activity.createdAt,
    });
  }
}

// --- Factories -------------------------------------------------------------

export interface SqliteLeadRepositoryHandle extends LeadRepository {
  close(): void;
}
export interface SqliteOpportunityRepositoryHandle extends OpportunityRepository {
  close(): void;
}
export interface SqlitePipelineStageRepositoryHandle extends PipelineStageRepository {
  close(): void;
}
export interface SqliteActivityRepositoryHandle extends ActivityRepository {
  close(): void;
}

/** Open a SQLite-backed LeadRepository. ":memory:" for tests, a path for real. */
export function createSqliteLeadRepository(path: SqliteConnectionInput = ":memory:"): SqliteLeadRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_LEAD);
  const repo = new SqliteLeadRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteLeadRepositoryHandle;
}

/** Open a SQLite-backed OpportunityRepository. ":memory:" for tests, a path for real. */
/** Adds `branch_id` to a database created before the column existed. */
function addOpportunityBranchColumnIfMissing(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(crm_opportunity)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "branch_id")) {
    sqlite.exec(`ALTER TABLE crm_opportunity ADD COLUMN branch_id TEXT`);
  }
}

export function createSqliteOpportunityRepository(path: SqliteConnectionInput = ":memory:"): SqliteOpportunityRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_OPPORTUNITY);
  addOpportunityBranchColumnIfMissing(sqlite);
  const repo = new SqliteOpportunityRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteOpportunityRepositoryHandle;
}

/** Open a SQLite-backed PipelineStageRepository. ":memory:" for tests, a path for real. */
export function createSqlitePipelineStageRepository(path: SqliteConnectionInput = ":memory:"): SqlitePipelineStageRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_PIPELINE_STAGE);
  const repo = new SqlitePipelineStageRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqlitePipelineStageRepositoryHandle;
}

/** Open a SQLite-backed ActivityRepository. ":memory:" for tests, a path for real. */
export function createSqliteActivityRepository(path: SqliteConnectionInput = ":memory:"): SqliteActivityRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_ACTIVITY);
  const repo = new SqliteActivityRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteActivityRepositoryHandle;
}
