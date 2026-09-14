import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  DEFAULT_ETA_CONFIG,
  type EtaCompanyAddress,
  type EtaConfig,
  type EtaConfigRepository,
  type EtaDocumentType,
  type EtaDocumentVersion,
  type EtaEnvironment,
  type EtaSigningMethod,
  type EtaSubmission,
  type EtaSubmissionRepository,
  type EtaSubmissionStatus,
  type EtaBranchCode,
  type EtaBranchCodeRepository,
  type EtaUnitMapping,
  type EtaUnitMappingRepository,
} from "@mezan/domain";

/**
 * SQLite-backed ETA config + submission-queue stores (docs/archive/catalog/04 "الفاتورة
 * الإلكترونية"). The client secret is held in its own column and NEVER returned
 * through the config port — the port surfaces only `hasClientSecret`.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS eta_config (
  id                       TEXT PRIMARY KEY,
  environment              TEXT NOT NULL,
  tax_registration_number  TEXT,
  activity_code            TEXT,
  address                  TEXT,
  buyer_data_threshold     INTEGER NOT NULL,
  document_version         TEXT NOT NULL,
  auto_submit_on_confirm   INTEGER NOT NULL,
  signing_method           TEXT NOT NULL,
  client_id                TEXT,
  client_secret_enc        TEXT,
  receipt_reporting_window_hours INTEGER
);
CREATE TABLE IF NOT EXISTS eta_submission (
  id               TEXT PRIMARY KEY,
  internal_id      TEXT NOT NULL UNIQUE,
  document_type    TEXT NOT NULL,
  status           TEXT NOT NULL,
  eta_uuid         TEXT,
  payload          TEXT NOT NULL,
  errors           TEXT NOT NULL,
  exclusion_reason TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  submitted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_eta_submission_status ON eta_submission(status);
CREATE TABLE IF NOT EXISTS eta_branch_code (
  branch_id      TEXT PRIMARY KEY,
  eta_branch_code TEXT NOT NULL,
  device_serial_number TEXT,
  pos_client_id  TEXT,
  pos_client_secret_enc TEXT
);
CREATE TABLE IF NOT EXISTS eta_unit_mapping (
  unit_code      TEXT PRIMARY KEY,
  eta_unit_code  TEXT NOT NULL
);
`;

const SINGLETON = "singleton";

/**
 * Placeholder secret-at-rest transform. A real deployment swaps this for
 * AES-256 (the catalog's "يحفظ السر مشفراً"); base64 here keeps the secret out
 * of plain reads and out of every API response without pulling a crypto
 * dependency into this spike. It is NEVER returned by the config port.
 */
function seal(secret: string): string {
  return Buffer.from(secret, "utf8").toString("base64");
}

interface ConfigRow {
  environment: string;
  tax_registration_number: string | null;
  activity_code: string | null;
  address: string | null;
  buyer_data_threshold: number;
  document_version: string;
  auto_submit_on_confirm: number;
  signing_method: string;
  client_id: string | null;
  client_secret_enc: string | null;
  receipt_reporting_window_hours: number | null;
}

class SqliteEtaConfigRepository implements EtaConfigRepository {
  private readonly read: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly setSecret: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.read = sqlite.prepare(`SELECT * FROM eta_config WHERE id = ?`);
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_config
        (id, environment, tax_registration_number, activity_code, address, buyer_data_threshold,
         document_version, auto_submit_on_confirm, signing_method, client_id,
         receipt_reporting_window_hours)
      VALUES
        (@id, @environment, @tax_registration_number, @activity_code, @address, @buyer_data_threshold,
         @document_version, @auto_submit_on_confirm, @signing_method, @client_id,
         @receipt_reporting_window_hours)
      ON CONFLICT(id) DO UPDATE SET
        environment = excluded.environment,
        tax_registration_number = excluded.tax_registration_number,
        activity_code = excluded.activity_code,
        address = excluded.address,
        buyer_data_threshold = excluded.buyer_data_threshold,
        document_version = excluded.document_version,
        auto_submit_on_confirm = excluded.auto_submit_on_confirm,
        signing_method = excluded.signing_method,
        client_id = excluded.client_id,
        receipt_reporting_window_hours = excluded.receipt_reporting_window_hours
    `);
    this.setSecret = sqlite.prepare(`UPDATE eta_config SET client_secret_enc = ? WHERE id = ?`);
  }

  async get(): Promise<EtaConfig> {
    const row = this.read.get(SINGLETON) as ConfigRow | undefined;
    if (!row) return DEFAULT_ETA_CONFIG;
    const address = row.address ? (JSON.parse(row.address) as EtaCompanyAddress) : null;
    return {
      environment: row.environment as EtaEnvironment,
      taxRegistrationNumber: row.tax_registration_number,
      activityCode: row.activity_code,
      address,
      buyerDataThreshold: row.buyer_data_threshold,
      documentVersion: row.document_version as EtaDocumentVersion,
      autoSubmitOnConfirm: row.auto_submit_on_confirm === 1,
      signingMethod: row.signing_method as EtaSigningMethod,
      clientId: row.client_id,
      hasClientSecret: row.client_secret_enc != null,
      receiptReportingWindowHours:
        row.receipt_reporting_window_hours ?? DEFAULT_ETA_CONFIG.receiptReportingWindowHours,
    };
  }

  async save(config: EtaConfig): Promise<void> {
    this.upsert.run({
      id: SINGLETON,
      environment: config.environment,
      tax_registration_number: config.taxRegistrationNumber,
      activity_code: config.activityCode,
      address: config.address ? JSON.stringify(config.address) : null,
      buyer_data_threshold: config.buyerDataThreshold,
      document_version: config.documentVersion,
      auto_submit_on_confirm: config.autoSubmitOnConfirm ? 1 : 0,
      signing_method: config.signingMethod,
      client_id: config.clientId,
      receipt_reporting_window_hours: config.receiptReportingWindowHours,
    });
  }

  /** Store a new client secret (sealed). Ensures a config row exists first. */
  async setClientSecret(secret: string): Promise<void> {
    const existing = this.read.get(SINGLETON);
    if (!existing) await this.save(DEFAULT_ETA_CONFIG);
    this.setSecret.run(seal(secret), SINGLETON);
  }
}

interface SubmissionRow {
  id: string;
  internal_id: string;
  document_type: string;
  status: string;
  eta_uuid: string | null;
  payload: string;
  errors: string;
  exclusion_reason: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

function toSubmission(row: SubmissionRow): EtaSubmission {
  return {
    id: row.id,
    internalId: row.internal_id,
    documentType: row.document_type as EtaDocumentType,
    status: row.status as EtaSubmissionStatus,
    etaUuid: row.eta_uuid,
    payload: JSON.parse(row.payload),
    errors: JSON.parse(row.errors) as string[],
    exclusionReason: row.exclusion_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
  };
}

class SqliteEtaSubmissionRepository implements EtaSubmissionRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByInternal: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByStatus: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_submission
        (id, internal_id, document_type, status, eta_uuid, payload, errors, exclusion_reason, created_at, updated_at, submitted_at)
      VALUES
        (@id, @internal_id, @document_type, @status, @eta_uuid, @payload, @errors, @exclusion_reason, @created_at, @updated_at, @submitted_at)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        eta_uuid = excluded.eta_uuid,
        errors = excluded.errors,
        exclusion_reason = excluded.exclusion_reason,
        updated_at = excluded.updated_at,
        submitted_at = excluded.submitted_at
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM eta_submission WHERE id = ?`);
    this.selectByInternal = sqlite.prepare(`SELECT * FROM eta_submission WHERE internal_id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM eta_submission ORDER BY created_at DESC`);
    this.selectByStatus = sqlite.prepare(`SELECT * FROM eta_submission WHERE status = ? ORDER BY created_at DESC`);
  }

  async findById(id: string): Promise<EtaSubmission | null> {
    const row = this.selectById.get(id) as SubmissionRow | undefined;
    return row ? toSubmission(row) : null;
  }

  async findByInternalId(internalId: string): Promise<EtaSubmission | null> {
    const row = this.selectByInternal.get(internalId) as SubmissionRow | undefined;
    return row ? toSubmission(row) : null;
  }

  async list(status?: EtaSubmissionStatus): Promise<EtaSubmission[]> {
    const rows = (status ? this.selectByStatus.all(status) : this.selectAll.all()) as SubmissionRow[];
    return rows.map(toSubmission);
  }

  async create(submission: EtaSubmission): Promise<void> {
    this.write(submission);
  }

  async update(submission: EtaSubmission): Promise<void> {
    this.write(submission);
  }

  private write(s: EtaSubmission): void {
    this.upsert.run({
      id: s.id,
      internal_id: s.internalId,
      document_type: s.documentType,
      status: s.status,
      eta_uuid: s.etaUuid,
      payload: JSON.stringify(s.payload),
      errors: JSON.stringify(s.errors),
      exclusion_reason: s.exclusionReason,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      submitted_at: s.submittedAt,
    });
  }
}

interface BranchCodeRow {
  branch_id: string;
  eta_branch_code: string;
  device_serial_number: string | null;
  pos_client_id: string | null;
  pos_client_secret_enc: string | null;
}

class SqliteEtaBranchCodeRepository implements EtaBranchCodeRepository {
  private readonly selectAll: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly setSecret: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.selectAll = sqlite.prepare(`SELECT * FROM eta_branch_code ORDER BY branch_id`);
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_branch_code (branch_id, eta_branch_code, device_serial_number, pos_client_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(branch_id) DO UPDATE SET
        eta_branch_code = excluded.eta_branch_code,
        device_serial_number = excluded.device_serial_number,
        pos_client_id = excluded.pos_client_id
    `);
    this.setSecret = sqlite.prepare(`UPDATE eta_branch_code SET pos_client_secret_enc = ? WHERE branch_id = ?`);
  }

  async list(): Promise<EtaBranchCode[]> {
    const rows = this.selectAll.all() as BranchCodeRow[];
    return rows.map((r) => ({
      branchId: r.branch_id,
      etaBranchCode: r.eta_branch_code,
      deviceSerialNumber: r.device_serial_number,
      posClientId: r.pos_client_id,
      hasPosClientSecret: r.pos_client_secret_enc != null,
    }));
  }

  async save(mapping: EtaBranchCode): Promise<void> {
    this.upsert.run(mapping.branchId, mapping.etaBranchCode, mapping.deviceSerialNumber, mapping.posClientId);
  }

  async setPosClientSecret(branchId: string, secret: string): Promise<void> {
    this.setSecret.run(seal(secret), branchId);
  }
}

class SqliteEtaUnitMappingRepository implements EtaUnitMappingRepository {
  private readonly selectAll: Database.Statement;
  private readonly upsert: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.selectAll = sqlite.prepare(`SELECT * FROM eta_unit_mapping ORDER BY unit_code`);
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_unit_mapping (unit_code, eta_unit_code) VALUES (?, ?)
      ON CONFLICT(unit_code) DO UPDATE SET eta_unit_code = excluded.eta_unit_code
    `);
  }

  async list(): Promise<EtaUnitMapping[]> {
    const rows = this.selectAll.all() as { unit_code: string; eta_unit_code: string }[];
    return rows.map((r) => ({ unitCode: r.unit_code, etaUnitCode: r.eta_unit_code }));
  }

  async save(mapping: EtaUnitMapping): Promise<void> {
    this.upsert.run(mapping.unitCode, mapping.etaUnitCode);
  }
}

/** Config repo with the extra secret-write the API uses (never on the domain port). */
export interface EtaConfigStore extends EtaConfigRepository {
  setClientSecret(secret: string): Promise<void>;
}

export interface SqliteEtaStoreHandle {
  readonly config: EtaConfigStore;
  readonly submissions: EtaSubmissionRepository;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly unitMappings: EtaUnitMappingRepository;
  close(): void;
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, ddl: string): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!existing.has(column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function migrateEtaTables(sqlite: Database.Database): void {
  addColumnIfMissing(sqlite, "eta_config", "receipt_reporting_window_hours", "receipt_reporting_window_hours INTEGER");
  addColumnIfMissing(sqlite, "eta_branch_code", "device_serial_number", "device_serial_number TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "pos_client_id", "pos_client_id TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "pos_client_secret_enc", "pos_client_secret_enc TEXT");
}

/** Open the SQLite-backed ETA stores. ":memory:" for tests, a path for real. */
export function createSqliteEtaStore(path: SqliteConnectionInput = ":memory:"): SqliteEtaStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  migrateEtaTables(sqlite);
  return {
    config: new SqliteEtaConfigRepository(sqlite),
    submissions: new SqliteEtaSubmissionRepository(sqlite),
    branchCodes: new SqliteEtaBranchCodeRepository(sqlite),
    unitMappings: new SqliteEtaUnitMappingRepository(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
