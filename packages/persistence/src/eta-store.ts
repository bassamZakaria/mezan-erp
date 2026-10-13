import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertingNew, prepareInsertOnly } from "./insert-new.js";
import {
  DEFAULT_ETA_CONFIG,
  ETA_DEFAULT_ENDPOINTS,
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
  type EtaTransmitLogEntry,
  type EtaPrevalidationFinding,
  type EtaPosCredentials,
  type EtaReceiptChainHead,
  type EtaReceiptChainRepository,
  type EtaReceiptGap,
  type EtaReceiptGapRepository,
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
  preproduction_identity_url TEXT,
  preproduction_api_url      TEXT,
  production_identity_url    TEXT,
  production_api_url         TEXT,
  signing_command            TEXT,
  signing_command_args       TEXT,
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
  submitted_at     TEXT,
  gateway_submission_id TEXT,
  signature        TEXT,
  transmit_log     TEXT,
  receipt_serial   TEXT,
  receipt_seq      INTEGER,
  prevalidation    TEXT,
  rejection_codes  TEXT
);
CREATE INDEX IF NOT EXISTS idx_eta_submission_status ON eta_submission(status);
CREATE INDEX IF NOT EXISTS idx_eta_submission_uuid ON eta_submission(eta_uuid);
CREATE TABLE IF NOT EXISTS eta_branch_code (
  branch_id      TEXT PRIMARY KEY,
  eta_branch_code TEXT NOT NULL,
  device_serial_number TEXT,
  pos_client_id  TEXT,
  pos_client_secret_enc TEXT,
  pos_os_version TEXT,
  pos_model_framework TEXT,
  pos_preshared_key_enc TEXT
);
CREATE TABLE IF NOT EXISTS eta_receipt_gap (
  internal_id  TEXT PRIMARY KEY,
  doc_type     TEXT NOT NULL,
  doc_id       TEXT NOT NULL,
  issued_at    TEXT NOT NULL,
  code         TEXT NOT NULL,
  reason       TEXT NOT NULL,
  recorded_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eta_receipt_chain (
  device_serial        TEXT PRIMARY KEY,
  last_uuid            TEXT,
  last_seq             INTEGER NOT NULL,
  last_receipt_number  TEXT,
  updated_at           TEXT
);
CREATE TABLE IF NOT EXISTS eta_unit_mapping (
  unit_code      TEXT PRIMARY KEY,
  eta_unit_code  TEXT NOT NULL
);
`;

const SINGLETON = "singleton";

/** Columns added after the first release; existing files get them here rather than on a rebuild. */
/**
 * Placeholder secret-at-rest transform. A real deployment swaps this for
 * AES-256 (the catalog's "يحفظ السر مشفراً"); base64 here keeps the secret out
 * of plain reads and out of every API response without pulling a crypto
 * dependency into this spike. It is NEVER returned by the config port.
 */
function seal(secret: string): string {
  return Buffer.from(secret, "utf8").toString("base64");
}

function unseal(sealed: string): string {
  return Buffer.from(sealed, "base64").toString("utf8");
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
  preproduction_identity_url: string | null;
  preproduction_api_url: string | null;
  production_identity_url: string | null;
  production_api_url: string | null;
  signing_command: string | null;
  signing_command_args: string | null;
  receipt_reporting_window_hours: number | null;
}

class SqliteEtaConfigRepository implements EtaConfigRepository {
  private readonly read: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly setSecret: Database.Statement;
  private readonly readSecret: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.read = sqlite.prepare(`SELECT * FROM eta_config WHERE id = ?`);
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_config
        (id, environment, tax_registration_number, activity_code, address, buyer_data_threshold,
         document_version, auto_submit_on_confirm, signing_method, client_id,
         preproduction_identity_url, preproduction_api_url, production_identity_url, production_api_url,
         signing_command, signing_command_args, receipt_reporting_window_hours)
      VALUES
        (@id, @environment, @tax_registration_number, @activity_code, @address, @buyer_data_threshold,
         @document_version, @auto_submit_on_confirm, @signing_method, @client_id,
         @preproduction_identity_url, @preproduction_api_url, @production_identity_url, @production_api_url,
         @signing_command, @signing_command_args, @receipt_reporting_window_hours)
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
        preproduction_identity_url = excluded.preproduction_identity_url,
        preproduction_api_url = excluded.preproduction_api_url,
        production_identity_url = excluded.production_identity_url,
        production_api_url = excluded.production_api_url,
        signing_command = excluded.signing_command,
        signing_command_args = excluded.signing_command_args,
        receipt_reporting_window_hours = excluded.receipt_reporting_window_hours
    `);
    this.setSecret = sqlite.prepare(`UPDATE eta_config SET client_secret_enc = ? WHERE id = ?`);
    this.readSecret = sqlite.prepare(`SELECT client_secret_enc FROM eta_config WHERE id = ?`);
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
      preproductionIdentityUrl: row.preproduction_identity_url ?? ETA_DEFAULT_ENDPOINTS.preproductionIdentityUrl,
      preproductionApiUrl: row.preproduction_api_url ?? ETA_DEFAULT_ENDPOINTS.preproductionApiUrl,
      productionIdentityUrl: row.production_identity_url ?? ETA_DEFAULT_ENDPOINTS.productionIdentityUrl,
      productionApiUrl: row.production_api_url ?? ETA_DEFAULT_ENDPOINTS.productionApiUrl,
      signingCommand: row.signing_command,
      signingCommandArgs: row.signing_command_args ? (JSON.parse(row.signing_command_args) as string[]) : [],
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
      preproduction_identity_url: config.preproductionIdentityUrl,
      preproduction_api_url: config.preproductionApiUrl,
      production_identity_url: config.productionIdentityUrl,
      production_api_url: config.productionApiUrl,
      signing_command: config.signingCommand,
      signing_command_args: JSON.stringify(config.signingCommandArgs),
      receipt_reporting_window_hours: config.receiptReportingWindowHours,
    });
  }

  /**
   * SECURITY: the only reader of the sealed secret. It exists solely for the
   * OAuth token request; it is never surfaced through {@link EtaConfig} or any
   * API response.
   */
  async getClientSecret(): Promise<string | null> {
    const row = this.readSecret.get(SINGLETON) as { client_secret_enc: string | null } | undefined;
    if (!row?.client_secret_enc) return null;
    return unseal(row.client_secret_enc);
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
  gateway_submission_id: string | null;
  signature: string | null;
  transmit_log: string | null;
  receipt_serial: string | null;
  receipt_seq: number | null;
  prevalidation: string | null;
  rejection_codes: string | null;
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
    gatewaySubmissionId: row.gateway_submission_id,
    signature: row.signature,
    transmitLog: row.transmit_log ? (JSON.parse(row.transmit_log) as EtaTransmitLogEntry[]) : [],
    receiptSerial: row.receipt_serial ?? null,
    receiptSeq: row.receipt_seq ?? null,
    prevalidation: row.prevalidation ? (JSON.parse(row.prevalidation) as EtaPrevalidationFinding[]) : [],
    rejectionCodes: row.rejection_codes ? (JSON.parse(row.rejection_codes) as (string | null)[]) : [],
  };
}

class SqliteEtaSubmissionRepository implements EtaSubmissionRepository {
  private readonly upsert: Database.Statement;
  private readonly insertOnly: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByInternal: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectByStatus: Database.Statement;
  private readonly selectReceiptStatusByUuid: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_submission
        (id, internal_id, document_type, status, eta_uuid, payload, errors, exclusion_reason, created_at, updated_at, submitted_at,
         gateway_submission_id, signature, transmit_log, receipt_serial, receipt_seq, prevalidation, rejection_codes)
      VALUES
        (@id, @internal_id, @document_type, @status, @eta_uuid, @payload, @errors, @exclusion_reason, @created_at, @updated_at, @submitted_at,
         @gateway_submission_id, @signature, @transmit_log, @receipt_serial, @receipt_seq, @prevalidation, @rejection_codes)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        eta_uuid = excluded.eta_uuid,
        payload = excluded.payload,
        errors = excluded.errors,
        exclusion_reason = excluded.exclusion_reason,
        updated_at = excluded.updated_at,
        submitted_at = excluded.submitted_at,
        gateway_submission_id = excluded.gateway_submission_id,
        signature = excluded.signature,
        transmit_log = excluded.transmit_log,
        prevalidation = excluded.prevalidation,
        rejection_codes = excluded.rejection_codes
    `);
    this.insertOnly = prepareInsertOnly(sqlite, this.upsert.source);
    this.selectById = sqlite.prepare(`SELECT * FROM eta_submission WHERE id = ?`);
    this.selectByInternal = sqlite.prepare(`SELECT * FROM eta_submission WHERE internal_id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM eta_submission ORDER BY created_at DESC`);
    this.selectByStatus = sqlite.prepare(`SELECT * FROM eta_submission WHERE status = ? ORDER BY created_at DESC`);
    this.selectReceiptStatusByUuid = sqlite.prepare(`SELECT status FROM eta_submission WHERE eta_uuid = ? AND document_type = 'receipt'`);
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

  async statusByEtaUuid(etaUuid: string): Promise<EtaSubmissionStatus | null> {
    const row = this.selectReceiptStatusByUuid.get(etaUuid) as { status: EtaSubmissionStatus } | undefined;
    return row?.status ?? null;
  }

  async create(submission: EtaSubmission): Promise<void> {
    insertingNew(submission.id, () => this.write(submission, this.insertOnly));
  }

  async update(submission: EtaSubmission): Promise<void> {
    this.write(submission);
  }

  /** Exposed for the chain's transaction; everything else goes through `create`/`update`. */
  write(s: EtaSubmission, statement: Database.Statement = this.upsert): void {
    statement.run({
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
      gateway_submission_id: s.gatewaySubmissionId,
      signature: s.signature,
      transmit_log: JSON.stringify(s.transmitLog),
      receipt_serial: s.receiptSerial ?? null,
      receipt_seq: s.receiptSeq ?? null,
      prevalidation: JSON.stringify(s.prevalidation ?? []),
      rejection_codes: JSON.stringify(s.rejectionCodes ?? []),
    });
  }
}

class SqliteEtaReceiptGapRepository implements EtaReceiptGapRepository {
  private readonly upsert: Database.Statement;
  private readonly remove: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_receipt_gap (internal_id, doc_type, doc_id, issued_at, code, reason, recorded_at)
      VALUES (@internalId, @docType, @docId, @issuedAt, @code, @reason, @recordedAt)
      ON CONFLICT(internal_id) DO UPDATE SET code = excluded.code, reason = excluded.reason, recorded_at = excluded.recorded_at
    `);
    this.remove = sqlite.prepare(`DELETE FROM eta_receipt_gap WHERE internal_id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM eta_receipt_gap ORDER BY issued_at`);
  }

  async record(gap: EtaReceiptGap): Promise<void> {
    this.upsert.run(gap);
  }

  async clear(internalId: string): Promise<void> {
    this.remove.run(internalId);
  }

  async list(): Promise<EtaReceiptGap[]> {
    return (
      this.selectAll.all() as {
        internal_id: string;
        doc_type: string;
        doc_id: string;
        issued_at: string;
        code: string;
        reason: string;
        recorded_at: string;
      }[]
    ).map((r) => ({
      internalId: r.internal_id,
      docType: r.doc_type as EtaReceiptGap["docType"],
      docId: r.doc_id,
      issuedAt: r.issued_at,
      code: r.code,
      reason: r.reason,
      recordedAt: r.recorded_at,
    }));
  }
}

interface ChainRow {
  device_serial: string;
  last_uuid: string | null;
  last_seq: number;
  last_receipt_number: string | null;
  updated_at: string | null;
}

function toChainHead(row: ChainRow): EtaReceiptChainHead {
  return {
    serial: row.device_serial,
    lastUuid: row.last_uuid,
    lastSeq: row.last_seq,
    lastReceiptNumber: row.last_receipt_number,
    updatedAt: row.updated_at,
  };
}

/**
 * The per-device receipt chain (DEC-25, D283). `append` inserts the receipt and
 * moves the head in ONE SQLite transaction, and only when the head is still the
 * one the receipt was built on — so a second writer, even another process on
 * the same file, can never chain a receipt onto a predecessor already taken.
 */
class SqliteEtaReceiptChainRepository implements EtaReceiptChainRepository {
  private readonly selectOne: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly insertHead: Database.Statement;
  private readonly advanceHead: Database.Statement;
  private readonly appendTx: (entry: Parameters<EtaReceiptChainRepository["append"]>[0]) => boolean;

  constructor(sqlite: Database.Database, submissions: SqliteEtaSubmissionRepository) {
    this.selectOne = sqlite.prepare(`SELECT * FROM eta_receipt_chain WHERE device_serial = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM eta_receipt_chain ORDER BY device_serial`);
    this.insertHead = sqlite.prepare(`
      INSERT INTO eta_receipt_chain (device_serial, last_uuid, last_seq, last_receipt_number, updated_at)
      VALUES (@serial, @uuid, @seq, @receipt_number, @at)
      ON CONFLICT(device_serial) DO NOTHING
    `);
    this.advanceHead = sqlite.prepare(`
      UPDATE eta_receipt_chain
         SET last_uuid = @uuid, last_seq = @seq, last_receipt_number = @receipt_number, updated_at = @at
       WHERE device_serial = @serial AND last_uuid IS @expected AND last_seq = @seq - 1
    `);
    this.appendTx = sqlite.transaction((entry: Parameters<EtaReceiptChainRepository["append"]>[0]): boolean => {
      const { serial, expectedPreviousUuid, submission } = entry;
      const seq = submission.receiptSeq ?? 1;
      const params = {
        serial,
        uuid: submission.etaUuid,
        seq,
        receipt_number: submission.internalId,
        at: submission.createdAt,
        expected: expectedPreviousUuid,
      };
      const moved =
        expectedPreviousUuid === null && seq === 1
          ? this.insertHead.run(params).changes
          : this.advanceHead.run(params).changes;
      if (moved !== 1) return false;
      submissions.write(submission);
      return true;
    });
  }

  async head(serial: string): Promise<EtaReceiptChainHead | null> {
    const row = this.selectOne.get(serial) as ChainRow | undefined;
    return row ? toChainHead(row) : null;
  }

  async list(): Promise<EtaReceiptChainHead[]> {
    return (this.selectAll.all() as ChainRow[]).map(toChainHead);
  }

  async append(entry: Parameters<EtaReceiptChainRepository["append"]>[0]): Promise<boolean> {
    return this.appendTx(entry);
  }
}

interface BranchCodeRow {
  branch_id: string;
  eta_branch_code: string;
  device_serial_number: string | null;
  pos_client_id: string | null;
  pos_client_secret_enc: string | null;
  pos_os_version: string | null;
  pos_model_framework: string | null;
  pos_preshared_key_enc: string | null;
}

class SqliteEtaBranchCodeRepository implements EtaBranchCodeRepository {
  private readonly selectAll: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly setSecret: Database.Statement;
  private readonly setPresharedKey: Database.Statement;
  private readonly selectBySerial: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.selectAll = sqlite.prepare(`SELECT * FROM eta_branch_code ORDER BY branch_id`);
    this.upsert = sqlite.prepare(`
      INSERT INTO eta_branch_code (branch_id, eta_branch_code, device_serial_number, pos_client_id, pos_os_version, pos_model_framework)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id) DO UPDATE SET
        eta_branch_code = excluded.eta_branch_code,
        device_serial_number = excluded.device_serial_number,
        pos_client_id = excluded.pos_client_id,
        pos_os_version = excluded.pos_os_version,
        pos_model_framework = excluded.pos_model_framework
    `);
    this.setSecret = sqlite.prepare(`UPDATE eta_branch_code SET pos_client_secret_enc = ? WHERE branch_id = ?`);
    this.setPresharedKey = sqlite.prepare(`UPDATE eta_branch_code SET pos_preshared_key_enc = ? WHERE branch_id = ?`);
    this.selectBySerial = sqlite.prepare(
      `SELECT * FROM eta_branch_code WHERE device_serial_number = ? ORDER BY branch_id LIMIT 1`,
    );
  }

  async list(): Promise<EtaBranchCode[]> {
    const rows = this.selectAll.all() as BranchCodeRow[];
    return rows.map((r) => ({
      branchId: r.branch_id,
      etaBranchCode: r.eta_branch_code,
      deviceSerialNumber: r.device_serial_number,
      posClientId: r.pos_client_id,
      hasPosClientSecret: r.pos_client_secret_enc != null,
      posOsVersion: r.pos_os_version ?? null,
      posModelFramework: r.pos_model_framework ?? null,
      hasPosPresharedKey: r.pos_preshared_key_enc != null,
    }));
  }

  async save(mapping: EtaBranchCode): Promise<void> {
    this.upsert.run(
      mapping.branchId,
      mapping.etaBranchCode,
      mapping.deviceSerialNumber,
      mapping.posClientId,
      mapping.posOsVersion ?? null,
      mapping.posModelFramework ?? null,
    );
  }

  async setPosClientSecret(branchId: string, secret: string): Promise<void> {
    this.setSecret.run(seal(secret), branchId);
  }

  async setPosPresharedKey(branchId: string, key: string): Promise<void> {
    this.setPresharedKey.run(seal(key), branchId);
  }

  /**
   * SECURITY: the only reader of a device's sealed secret and pre-shared key,
   * for the receipt token request alone. Never route this into a response.
   */
  posCredentialsForSerial(serial: string): EtaPosCredentials | null {
    const row = this.selectBySerial.get(serial) as BranchCodeRow | undefined;
    if (!row?.pos_client_id || !row.pos_client_secret_enc) return null;
    return {
      serial,
      clientId: row.pos_client_id,
      clientSecret: unseal(row.pos_client_secret_enc),
      osVersion: row.pos_os_version ?? null,
      modelFramework: row.pos_model_framework ?? null,
      presharedKey: row.pos_preshared_key_enc ? unseal(row.pos_preshared_key_enc) : null,
    };
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
  /** SECURITY: for the OAuth token request only. Never route this into a response. */
  getClientSecret(): Promise<string | null>;
}

export interface SqliteEtaStoreHandle {
  readonly config: EtaConfigStore;
  readonly submissions: EtaSubmissionRepository;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly receiptChain: EtaReceiptChainRepository;
  readonly receiptGaps: EtaReceiptGapRepository;
  /** SECURITY: for the receipt token request only. Never route this into a response. */
  posCredentialsForSerial(serial: string): Promise<EtaPosCredentials | null>;
  readonly unitMappings: EtaUnitMappingRepository;
  close(): void;
}

function addColumnIfMissing(sqlite: Database.Database, table: string, column: string, ddl: string): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!existing.has(column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/**
 * An existing books file already has these tables, and CREATE TABLE IF NOT
 * EXISTS no-ops on it, so every column added after they shipped is widened
 * in place here. Dropping one silently loses the setting it carries.
 */
function migrateEtaTables(sqlite: Database.Database): void {
  addColumnIfMissing(sqlite, "eta_config", "receipt_reporting_window_hours", "receipt_reporting_window_hours INTEGER");
  addColumnIfMissing(sqlite, "eta_config", "preproduction_identity_url", "preproduction_identity_url TEXT");
  addColumnIfMissing(sqlite, "eta_config", "preproduction_api_url", "preproduction_api_url TEXT");
  addColumnIfMissing(sqlite, "eta_config", "production_identity_url", "production_identity_url TEXT");
  addColumnIfMissing(sqlite, "eta_config", "production_api_url", "production_api_url TEXT");
  addColumnIfMissing(sqlite, "eta_config", "signing_command", "signing_command TEXT");
  addColumnIfMissing(sqlite, "eta_config", "signing_command_args", "signing_command_args TEXT");
  addColumnIfMissing(sqlite, "eta_submission", "gateway_submission_id", "gateway_submission_id TEXT");
  addColumnIfMissing(sqlite, "eta_submission", "signature", "signature TEXT");
  addColumnIfMissing(sqlite, "eta_submission", "transmit_log", "transmit_log TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "device_serial_number", "device_serial_number TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "pos_client_id", "pos_client_id TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "pos_client_secret_enc", "pos_client_secret_enc TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "pos_os_version", "pos_os_version TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "pos_model_framework", "pos_model_framework TEXT");
  addColumnIfMissing(sqlite, "eta_branch_code", "pos_preshared_key_enc", "pos_preshared_key_enc TEXT");
  addColumnIfMissing(sqlite, "eta_submission", "receipt_serial", "receipt_serial TEXT");
  addColumnIfMissing(sqlite, "eta_submission", "receipt_seq", "receipt_seq INTEGER");
  addColumnIfMissing(sqlite, "eta_submission", "prevalidation", "prevalidation TEXT");
  addColumnIfMissing(sqlite, "eta_submission", "rejection_codes", "rejection_codes TEXT");
}

/**
 * A books file written before the chain table existed already holds receipts;
 * each device's last one becomes its head, or the next receipt would restart the
 * chain at an empty previousUUID the authority accepts only once per device.
 */
function seedReceiptChainFromSubmissions(sqlite: Database.Database): void {
  const hasHeads = (sqlite.prepare(`SELECT COUNT(*) AS n FROM eta_receipt_chain`).get() as { n: number }).n > 0;
  if (hasHeads) return;
  const rows = sqlite
    .prepare(`SELECT internal_id, eta_uuid, payload, created_at FROM eta_submission
               WHERE document_type = 'receipt' AND eta_uuid IS NOT NULL ORDER BY created_at, rowid`)
    .all() as { internal_id: string; eta_uuid: string; payload: string; created_at: string }[];
  if (rows.length === 0) return;
  const heads = new Map<string, { uuid: string; seq: number; receipt: string; at: string }>();
  for (const row of rows) {
    const serial = (JSON.parse(row.payload) as { seller?: { deviceSerialNumber?: unknown } })?.seller?.deviceSerialNumber;
    if (typeof serial !== "string" || serial === "") continue;
    const seq = (heads.get(serial)?.seq ?? 0) + 1;
    heads.set(serial, { uuid: row.eta_uuid, seq, receipt: row.internal_id, at: row.created_at });
  }
  const insert = sqlite.prepare(
    `INSERT INTO eta_receipt_chain (device_serial, last_uuid, last_seq, last_receipt_number, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  sqlite.transaction(() => {
    for (const [serial, h] of heads) insert.run(serial, h.uuid, h.seq, h.receipt, h.at);
  })();
}

/** Open the SQLite-backed ETA stores. ":memory:" for tests, a path for real. */
export function createSqliteEtaStore(path: SqliteConnectionInput = ":memory:"): SqliteEtaStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  migrateEtaTables(sqlite);
  const submissions = new SqliteEtaSubmissionRepository(sqlite);
  const branchCodes = new SqliteEtaBranchCodeRepository(sqlite);
  seedReceiptChainFromSubmissions(sqlite);
  return {
    config: new SqliteEtaConfigRepository(sqlite),
    submissions,
    branchCodes,
    receiptChain: new SqliteEtaReceiptChainRepository(sqlite, submissions),
    receiptGaps: new SqliteEtaReceiptGapRepository(sqlite),
    posCredentialsForSerial: async (serial) => branchCodes.posCredentialsForSerial(serial),
    unitMappings: new SqliteEtaUnitMappingRepository(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
