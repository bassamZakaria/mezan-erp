import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { isSealedSecret, SecretUnsealError, type SecretBox } from "./secret-box.js";
import { insertNew } from "./insert-new.js";
import { TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
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
 * SQL-backed ETA config + submission-queue stores (docs/archive/catalog/04 "الفاتورة
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
  rejection_codes  TEXT,
  transmit_started_at TEXT
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

enum StoredSecretState {
  None = "none",
  Readable = "readable",
  Unreadable = "unreadable",
}

/** Columns added after the first release; existing files get them here rather than on a rebuild. */
// CONTRACT: these are the associated data each sealed value is bound to; changing one orphans
// every value already sealed under it.
const CLIENT_SECRET_CONTEXT = "eta.clientSecret";
const posSecretContext = (branchId: string) => `eta.pos.clientSecret:${branchId}`;
const posPresharedKeyContext = (branchId: string) => `eta.pos.presharedKey:${branchId}`;

/**
 * Secret-at-rest for the ETA credentials. With the platform's secret box (the
 * cloud) a value is AES-256-GCM sealed under the same key as the webhook and
 * SMTP secrets; without one (the desktop, whose whole database file is
 * encrypted) it stays base64, as it always was. Either way it is NEVER returned
 * by the config port.
 */
class EtaSecretCodec {
  constructor(private readonly secrets?: SecretBox) {}

  seal(plain: string, context: string): string {
    return this.secrets ? this.secrets.seal(plain, context) : Buffer.from(plain, "utf8").toString("base64");
  }

  // SECURITY: a value this process cannot open — sealed on the cloud and carried to a desktop, or
  // sealed under a key since replaced — reads as unset, so it is entered again rather than sent as ciphertext.
  open(stored: string, context: string): string | null {
    if (!isSealedSecret(stored)) return Buffer.from(stored, "base64").toString("utf8");
    if (!this.secrets) return null;
    try {
      return this.secrets.open(stored, context);
    } catch (err) {
      if (err instanceof SecretUnsealError) return null;
      throw err;
    }
  }

  needsSealing(stored: string | null): stored is string {
    return this.secrets !== undefined && stored !== null && !isSealedSecret(stored);
  }
}

/** Seals every ETA credential written before sealing existed; a no-op without a key. */
function sealStoredEtaSecrets(sqlite: Database.Database, codec: EtaSecretCodec): void {
  const config = sqlite.prepare(`SELECT client_secret_enc FROM eta_config WHERE id = ?`).get(SINGLETON) as { client_secret_enc: string | null } | undefined;
  const branches = sqlite.prepare(`SELECT branch_id, pos_client_secret_enc, pos_preshared_key_enc FROM eta_branch_code`).all() as {
    branch_id: string;
    pos_client_secret_enc: string | null;
    pos_preshared_key_enc: string | null;
  }[];
  sqlite.transaction(() => {
    const stored = config?.client_secret_enc ?? null;
    if (codec.needsSealing(stored)) {
      const plain = codec.open(stored, CLIENT_SECRET_CONTEXT) ?? "";
      sqlite.prepare(`UPDATE eta_config SET client_secret_enc = ? WHERE id = ? AND client_secret_enc = ?`).run(codec.seal(plain, CLIENT_SECRET_CONTEXT), SINGLETON, stored);
    }
    for (const row of branches) {
      if (codec.needsSealing(row.pos_client_secret_enc)) {
        const plain = codec.open(row.pos_client_secret_enc, posSecretContext(row.branch_id)) ?? "";
        sqlite
          .prepare(`UPDATE eta_branch_code SET pos_client_secret_enc = ? WHERE branch_id = ? AND pos_client_secret_enc = ?`)
          .run(codec.seal(plain, posSecretContext(row.branch_id)), row.branch_id, row.pos_client_secret_enc);
      }
      if (codec.needsSealing(row.pos_preshared_key_enc)) {
        const plain = codec.open(row.pos_preshared_key_enc, posPresharedKeyContext(row.branch_id)) ?? "";
        sqlite
          .prepare(`UPDATE eta_branch_code SET pos_preshared_key_enc = ? WHERE branch_id = ? AND pos_preshared_key_enc = ?`)
          .run(codec.seal(plain, posPresharedKeyContext(row.branch_id)), row.branch_id, row.pos_preshared_key_enc);
      }
    }
  })();
}

interface ConfigRow {
  environment: string;
  tax_registration_number: string | null;
  activity_code: string | null;
  address: string | null;
  buyer_data_threshold: bigint;
  document_version: string;
  auto_submit_on_confirm: bigint;
  signing_method: string;
  client_id: string | null;
  client_secret_enc: string | null;
  preproduction_identity_url: string | null;
  preproduction_api_url: string | null;
  production_identity_url: string | null;
  production_api_url: string | null;
  signing_command: string | null;
  signing_command_args: string | null;
  receipt_reporting_window_hours: bigint | null;
}

const UPSERT_CONFIG = `
      INSERT INTO eta_config
        (id, environment, tax_registration_number, activity_code, address, buyer_data_threshold,
         document_version, auto_submit_on_confirm, signing_method, client_id,
         preproduction_identity_url, preproduction_api_url, production_identity_url, production_api_url,
         signing_command, signing_command_args, receipt_reporting_window_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        receipt_reporting_window_hours = excluded.receipt_reporting_window_hours`;

class SqlEtaConfigRepository implements EtaConfigRepository {
  constructor(
    private readonly db: SqlDb,
    private readonly codec: EtaSecretCodec,
  ) {}

  async get(): Promise<EtaConfig> {
    const row = await this.db.get<ConfigRow>(`SELECT * FROM eta_config WHERE id = ?`, [SINGLETON]);
    if (!row) return DEFAULT_ETA_CONFIG;
    const secretState =
      row.client_secret_enc == null
        ? StoredSecretState.None
        : this.codec.open(row.client_secret_enc, CLIENT_SECRET_CONTEXT) === null
          ? StoredSecretState.Unreadable
          : StoredSecretState.Readable;
    const address = row.address ? (JSON.parse(row.address) as EtaCompanyAddress) : null;
    return {
      environment: row.environment as EtaEnvironment,
      taxRegistrationNumber: row.tax_registration_number,
      activityCode: row.activity_code,
      address,
      buyerDataThreshold: Number(row.buyer_data_threshold),
      documentVersion: row.document_version as EtaDocumentVersion,
      autoSubmitOnConfirm: Number(row.auto_submit_on_confirm) === 1,
      signingMethod: row.signing_method as EtaSigningMethod,
      clientId: row.client_id,
      hasClientSecret: secretState === StoredSecretState.Readable,
      clientSecretNeedsReentry: secretState === StoredSecretState.Unreadable,
      preproductionIdentityUrl: row.preproduction_identity_url ?? ETA_DEFAULT_ENDPOINTS.preproductionIdentityUrl,
      preproductionApiUrl: row.preproduction_api_url ?? ETA_DEFAULT_ENDPOINTS.preproductionApiUrl,
      productionIdentityUrl: row.production_identity_url ?? ETA_DEFAULT_ENDPOINTS.productionIdentityUrl,
      productionApiUrl: row.production_api_url ?? ETA_DEFAULT_ENDPOINTS.productionApiUrl,
      signingCommand: row.signing_command,
      signingCommandArgs: row.signing_command_args ? (JSON.parse(row.signing_command_args) as string[]) : [],
      receiptReportingWindowHours:
        row.receipt_reporting_window_hours === null ? DEFAULT_ETA_CONFIG.receiptReportingWindowHours : Number(row.receipt_reporting_window_hours),
    };
  }

  async save(config: EtaConfig): Promise<void> {
    await this.db.run(UPSERT_CONFIG, [
      SINGLETON,
      config.environment,
      config.taxRegistrationNumber,
      config.activityCode,
      config.address ? JSON.stringify(config.address) : null,
      config.buyerDataThreshold,
      config.documentVersion,
      config.autoSubmitOnConfirm ? 1 : 0,
      config.signingMethod,
      config.clientId,
      config.preproductionIdentityUrl,
      config.preproductionApiUrl,
      config.productionIdentityUrl,
      config.productionApiUrl,
      config.signingCommand,
      JSON.stringify(config.signingCommandArgs),
      config.receiptReportingWindowHours,
    ]);
  }

  /**
   * SECURITY: the only reader of the sealed secret. It exists solely for the
   * OAuth token request; it is never surfaced through {@link EtaConfig} or any
   * API response.
   */
  async getClientSecret(): Promise<string | null> {
    const row = await this.db.get<{ client_secret_enc: string | null }>(`SELECT client_secret_enc FROM eta_config WHERE id = ?`, [SINGLETON]);
    if (!row?.client_secret_enc) return null;
    return this.codec.open(row.client_secret_enc, CLIENT_SECRET_CONTEXT);
  }

  /** Store a new client secret (sealed). Ensures a config row exists first. */
  async setClientSecret(secret: string): Promise<void> {
    await this.db.transaction(async () => {
      const existing = await this.db.get(`SELECT 1 AS present FROM eta_config WHERE id = ?`, [SINGLETON]);
      if (!existing) await this.save(DEFAULT_ETA_CONFIG);
      await this.db.run(`UPDATE eta_config SET client_secret_enc = ? WHERE id = ?`, [this.codec.seal(secret, CLIENT_SECRET_CONTEXT), SINGLETON]);
    });
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
  receipt_seq: bigint | null;
  prevalidation: string | null;
  rejection_codes: string | null;
  transmit_started_at: string | null;
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
    receiptSeq: row.receipt_seq === null ? null : Number(row.receipt_seq),
    prevalidation: row.prevalidation ? (JSON.parse(row.prevalidation) as EtaPrevalidationFinding[]) : [],
    rejectionCodes: row.rejection_codes ? (JSON.parse(row.rejection_codes) as (string | null)[]) : [],
    transmitStartedAt: row.transmit_started_at ?? null,
  };
}

const UPSERT_SUBMISSION = `
      INSERT INTO eta_submission
        (id, internal_id, document_type, status, eta_uuid, payload, errors, exclusion_reason, created_at, updated_at, submitted_at,
         gateway_submission_id, signature, transmit_log, receipt_serial, receipt_seq, prevalidation, rejection_codes, transmit_started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        rejection_codes = excluded.rejection_codes,
        transmit_started_at = excluded.transmit_started_at`;

function submissionParams(s: EtaSubmission): SqlValue[] {
  return [
    s.id,
    s.internalId,
    s.documentType,
    s.status,
    s.etaUuid,
    JSON.stringify(s.payload),
    JSON.stringify(s.errors),
    s.exclusionReason,
    s.createdAt,
    s.updatedAt,
    s.submittedAt,
    s.gatewaySubmissionId,
    s.signature,
    JSON.stringify(s.transmitLog),
    s.receiptSerial ?? null,
    s.receiptSeq ?? null,
    JSON.stringify(s.prevalidation ?? []),
    JSON.stringify(s.rejectionCodes ?? []),
    s.transmitStartedAt ?? null,
  ];
}

class SqlEtaSubmissionRepository implements EtaSubmissionRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<EtaSubmission | null> {
    const row = await this.db.get<SubmissionRow>(`SELECT * FROM eta_submission WHERE id = ?`, [id]);
    return row ? toSubmission(row) : null;
  }

  async findByInternalId(internalId: string): Promise<EtaSubmission | null> {
    const row = await this.db.get<SubmissionRow>(`SELECT * FROM eta_submission WHERE internal_id = ?`, [internalId]);
    return row ? toSubmission(row) : null;
  }

  async list(status?: EtaSubmissionStatus): Promise<EtaSubmission[]> {
    const rows = status
      ? await this.db.all<SubmissionRow>(`SELECT * FROM eta_submission WHERE status = ? ORDER BY created_at DESC`, [status])
      : await this.db.all<SubmissionRow>(`SELECT * FROM eta_submission ORDER BY created_at DESC`);
    return rows.map(toSubmission);
  }

  async statusByEtaUuid(etaUuid: string): Promise<EtaSubmissionStatus | null> {
    const row = await this.db.get<{ status: EtaSubmissionStatus }>(`SELECT status FROM eta_submission WHERE eta_uuid = ? AND document_type = 'receipt'`, [etaUuid]);
    return row?.status ?? null;
  }

  async create(submission: EtaSubmission): Promise<void> {
    await insertNew(this.db, submission.id, UPSERT_SUBMISSION, submissionParams(submission));
  }

  async update(submission: EtaSubmission): Promise<void> {
    await this.write(submission);
  }

  /** Exposed for the chain's transaction; everything else goes through `create`/`update`. */
  async write(s: EtaSubmission): Promise<void> {
    await this.db.run(UPSERT_SUBMISSION, submissionParams(s));
  }
}

class SqlEtaReceiptGapRepository implements EtaReceiptGapRepository {
  constructor(private readonly db: SqlDb) {}

  async record(gap: EtaReceiptGap): Promise<void> {
    await this.db.run(
      `INSERT INTO eta_receipt_gap (internal_id, doc_type, doc_id, issued_at, code, reason, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(internal_id) DO UPDATE SET code = excluded.code, reason = excluded.reason, recorded_at = excluded.recorded_at`,
      [gap.internalId, gap.docType, gap.docId, gap.issuedAt, gap.code, gap.reason, gap.recordedAt],
    );
  }

  async clear(internalId: string): Promise<void> {
    await this.db.run(`DELETE FROM eta_receipt_gap WHERE internal_id = ?`, [internalId]);
  }

  async list(): Promise<EtaReceiptGap[]> {
    return (
      await this.db.all<{
        internal_id: string;
        doc_type: string;
        doc_id: string;
        issued_at: string;
        code: string;
        reason: string;
        recorded_at: string;
      }>(`SELECT * FROM eta_receipt_gap ORDER BY issued_at`)
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
  last_seq: bigint;
  last_receipt_number: string | null;
  updated_at: string | null;
}

function toChainHead(row: ChainRow): EtaReceiptChainHead {
  return {
    serial: row.device_serial,
    lastUuid: row.last_uuid,
    lastSeq: Number(row.last_seq),
    lastReceiptNumber: row.last_receipt_number,
    updatedAt: row.updated_at,
  };
}

/**
 * The per-device receipt chain (DEC-25, D283). `append` inserts the receipt and
 * moves the head in ONE write-locked transaction, and only when the head is still
 * the one the receipt was built on — so a second writer, even another server
 * instance, can never chain a receipt onto a predecessor already taken.
 */
class SqlEtaReceiptChainRepository implements EtaReceiptChainRepository {
  constructor(
    private readonly db: SqlDb,
    private readonly submissions: SqlEtaSubmissionRepository,
  ) {}

  async head(serial: string): Promise<EtaReceiptChainHead | null> {
    const row = await this.db.get<ChainRow>(`SELECT * FROM eta_receipt_chain WHERE device_serial = ?`, [serial]);
    return row ? toChainHead(row) : null;
  }

  async list(): Promise<EtaReceiptChainHead[]> {
    return (await this.db.all<ChainRow>(`SELECT * FROM eta_receipt_chain ORDER BY device_serial`)).map(toChainHead);
  }

  async append(entry: Parameters<EtaReceiptChainRepository["append"]>[0]): Promise<boolean> {
    return this.db.transaction(async () => {
      const { serial, expectedPreviousUuid, submission } = entry;
      const seq = submission.receiptSeq ?? 1;
      const moved =
        expectedPreviousUuid === null && seq === 1
          ? (
              await this.db.run(
                `INSERT INTO eta_receipt_chain (device_serial, last_uuid, last_seq, last_receipt_number, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(device_serial) DO NOTHING`,
                [serial, submission.etaUuid, seq, submission.internalId, submission.createdAt],
              )
            ).changes
          : (
              await this.db.run(
                `UPDATE eta_receipt_chain
                    SET last_uuid = ?, last_seq = ?, last_receipt_number = ?, updated_at = ?
                  WHERE device_serial = ? AND last_uuid IS NOT DISTINCT FROM ? AND last_seq = ?`,
                [submission.etaUuid, seq, submission.internalId, submission.createdAt, serial, expectedPreviousUuid, seq - 1],
              )
            ).changes;
      if (moved !== 1) return false;
      await this.submissions.write(submission);
      return true;
    }, TransactionMode.Immediate);
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

class SqlEtaBranchCodeRepository implements EtaBranchCodeRepository {
  constructor(
    private readonly db: SqlDb,
    private readonly codec: EtaSecretCodec,
  ) {}

  async list(): Promise<EtaBranchCode[]> {
    const rows = await this.db.all<BranchCodeRow>(`SELECT * FROM eta_branch_code ORDER BY branch_id`);
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
    await this.db.run(
      `INSERT INTO eta_branch_code (branch_id, eta_branch_code, device_serial_number, pos_client_id, pos_os_version, pos_model_framework)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(branch_id) DO UPDATE SET
         eta_branch_code = excluded.eta_branch_code,
         device_serial_number = excluded.device_serial_number,
         pos_client_id = excluded.pos_client_id,
         pos_os_version = excluded.pos_os_version,
         pos_model_framework = excluded.pos_model_framework`,
      [mapping.branchId, mapping.etaBranchCode, mapping.deviceSerialNumber, mapping.posClientId, mapping.posOsVersion ?? null, mapping.posModelFramework ?? null],
    );
  }

  async setPosClientSecret(branchId: string, secret: string): Promise<void> {
    await this.db.run(`UPDATE eta_branch_code SET pos_client_secret_enc = ? WHERE branch_id = ?`, [this.codec.seal(secret, posSecretContext(branchId)), branchId]);
  }

  async setPosPresharedKey(branchId: string, key: string): Promise<void> {
    await this.db.run(`UPDATE eta_branch_code SET pos_preshared_key_enc = ? WHERE branch_id = ?`, [this.codec.seal(key, posPresharedKeyContext(branchId)), branchId]);
  }

  /**
   * SECURITY: the only reader of a device's sealed secret and pre-shared key,
   * for the receipt token request alone. Never route this into a response.
   */
  async posCredentialsForSerial(serial: string): Promise<EtaPosCredentials | null> {
    const row = await this.db.get<BranchCodeRow>(`SELECT * FROM eta_branch_code WHERE device_serial_number = ? ORDER BY branch_id LIMIT 1`, [serial]);
    if (!row?.pos_client_id || !row.pos_client_secret_enc) return null;
    const clientSecret = this.codec.open(row.pos_client_secret_enc, posSecretContext(row.branch_id));
    if (clientSecret === null) return null;
    return {
      serial,
      clientId: row.pos_client_id,
      clientSecret,
      osVersion: row.pos_os_version ?? null,
      modelFramework: row.pos_model_framework ?? null,
      presharedKey: row.pos_preshared_key_enc ? this.codec.open(row.pos_preshared_key_enc, posPresharedKeyContext(row.branch_id)) : null,
    };
  }
}

class SqlEtaUnitMappingRepository implements EtaUnitMappingRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<EtaUnitMapping[]> {
    const rows = await this.db.all<{ unit_code: string; eta_unit_code: string }>(`SELECT * FROM eta_unit_mapping ORDER BY unit_code`);
    return rows.map((r) => ({ unitCode: r.unit_code, etaUnitCode: r.eta_unit_code }));
  }

  async save(mapping: EtaUnitMapping): Promise<void> {
    await this.db.run(
      `INSERT INTO eta_unit_mapping (unit_code, eta_unit_code) VALUES (?, ?)
       ON CONFLICT(unit_code) DO UPDATE SET eta_unit_code = excluded.eta_unit_code`,
      [mapping.unitCode, mapping.etaUnitCode],
    );
  }
}

/** Config repo with the extra secret-write the API uses (never on the domain port). */
export interface EtaConfigStore extends EtaConfigRepository {
  setClientSecret(secret: string): Promise<void>;
  /** SECURITY: for the OAuth token request only. Never route this into a response. */
  getClientSecret(): Promise<string | null>;
}

export interface EtaStoreHandle {
  readonly config: EtaConfigStore;
  readonly submissions: EtaSubmissionRepository;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly receiptChain: EtaReceiptChainRepository;
  readonly receiptGaps: EtaReceiptGapRepository;
  /** SECURITY: for the receipt token request only. Never route this into a response. */
  posCredentialsForSerial(serial: string): Promise<EtaPosCredentials | null>;
  readonly unitMappings: EtaUnitMappingRepository;
}

export interface SqliteEtaStoreHandle extends EtaStoreHandle {
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
  addColumnIfMissing(sqlite, "eta_submission", "transmit_started_at", "transmit_started_at TEXT");
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

export async function ensureEtaSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createEtaStore(db: SqlDb, secrets?: SecretBox): EtaStoreHandle {
  const codec = new EtaSecretCodec(secrets);
  const submissions = new SqlEtaSubmissionRepository(db);
  const branchCodes = new SqlEtaBranchCodeRepository(db, codec);
  return {
    config: new SqlEtaConfigRepository(db, codec),
    submissions,
    branchCodes,
    receiptChain: new SqlEtaReceiptChainRepository(db, submissions),
    receiptGaps: new SqlEtaReceiptGapRepository(db),
    posCredentialsForSerial: (serial) => branchCodes.posCredentialsForSerial(serial),
    unitMappings: new SqlEtaUnitMappingRepository(db),
  };
}

/** Open the SQLite-backed ETA stores. ":memory:" for tests, a path for real. */
export function createSqliteEtaStore(path: SqliteConnectionInput = ":memory:", secrets?: SecretBox): SqliteEtaStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLES);
  migrateEtaTables(sqlite);
  sealStoredEtaSecrets(sqlite, new EtaSecretCodec(secrets));
  seedReceiptChainFromSubmissions(sqlite);
  return Object.assign(createEtaStore(sqliteDb(sqlite), secrets), {
    close: () => { if (owned) sqlite.close(); },
  });
}
