import Database from "better-sqlite3";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { auditChangedFieldNames } from "@mezan/domain";
import type { AuditEvent, AuditQueryFilter, AuditQueryPort, AuditQueryResult, AuditSink, AuditStream } from "@mezan/domain";

/**
 * SQLite-backed AuditSink (docs/archive/plan.md §5.7).
 *
 * Append-only is enforced at the storage layer: BEFORE UPDATE / BEFORE DELETE
 * triggers RAISE(ABORT), so even a stray SQL statement cannot mutate history.
 * `details` is stored as JSON text (or NULL). Rows are read newest-first per
 * stream. No money columns here, so safeIntegers() is unnecessary — the numeric
 * column is only the autoincrement id.
 *
 * `branch_id` is NULLABLE by decision: rows appended before the column existed
 * cannot be back-filled (the table is append-only — the UPDATE trigger below
 * would abort), and a request whose branch scope spans several branches has no
 * single branch to name. It is added by ALTER on an existing database, which
 * does not fire the append-only triggers.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS audit_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stream      TEXT NOT NULL,
  module      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  actor       TEXT NOT NULL,
  branch_id   TEXT,
  timestamp   TEXT NOT NULL,
  severity    TEXT NOT NULL,
  details     TEXT,
  prev_hash   TEXT,
  row_hash    TEXT
);
CREATE TABLE IF NOT EXISTS audit_chain_head (
  id       INTEGER PRIMARY KEY CHECK (id = 1),
  row_id   INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  mac      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_stream ON audit_event(stream, id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_event(entity_type, entity_id, id);
CREATE TRIGGER IF NOT EXISTS audit_event_no_update
  BEFORE UPDATE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_no_delete
  BEFORE DELETE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
`;

const CREATE_FIELD_INDEX = `
CREATE TABLE IF NOT EXISTS audit_event_field (
  event_id INTEGER NOT NULL,
  field    TEXT NOT NULL,
  PRIMARY KEY (event_id, field)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_audit_event_field ON audit_event_field(field, event_id);
CREATE TRIGGER IF NOT EXISTS audit_event_field_no_update
  BEFORE UPDATE ON audit_event_field
  BEGIN SELECT RAISE(ABORT, 'audit_event_field is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_field_no_delete
  BEFORE DELETE ON audit_event_field
  BEGIN SELECT RAISE(ABORT, 'audit_event_field is append-only'); END;
`;

function parseDetails(details: string | null): Record<string, unknown> | null {
  if (details === null) return null;
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * SECURITY CONTRACT — do not reorder, rename or drop a field.
 *
 * This tuple IS the canonical serialisation every `row_hash` in every existing
 * database was computed over. Changing it does not "improve the hash"; it
 * invalidates every chain in the field, and the audit screen then reports the
 * shop's intact trail as tampered with. A new field goes on the END, and only
 * behind a version bump in {@link CHAIN_VERSION}.
 */
function canonicalRow(row: AuditChainFields, prevHash: string | null): string {
  return JSON.stringify([
    CHAIN_VERSION,
    prevHash,
    row.stream,
    row.module,
    row.entity_type,
    row.entity_id,
    row.action,
    row.actor,
    row.branch_id,
    row.timestamp,
    row.severity,
    row.details,
  ]);
}

const CHAIN_VERSION = "mezan-audit-chain-v1";
/** What the first row in the chain links back to. */
const GENESIS = "";

interface AuditChainFields {
  stream: string;
  module: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor: string;
  branch_id: string | null;
  timestamp: string;
  severity: string;
  details: string | null;
}

function hashRow(row: AuditChainFields, prevHash: string | null): string {
  return createHash("sha256").update(canonicalRow(row, prevHash), "utf8").digest("hex");
}

function macHead(key: Buffer, rowId: number, rowHash: string): string {
  return createHmac("sha256", key).update(`${CHAIN_VERSION}:${rowId}:${rowHash}`, "utf8").digest("hex");
}

function macMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Where the walk stopped and why. `ok` means every chained row verified AND the head MAC agreed. */
export interface AuditChainVerification {
  readonly ok: boolean;
  /** Rows that carry a hash and were re-computed. */
  readonly checked: number;
  /**
   * Rows written before the chain existed. They cannot be verified and are not
   * a fault: the table is append-only, so they can never be back-filled.
   */
  readonly unchained: number;
  /** `audit_event.id` of the first row that failed, or null. */
  readonly brokenRowId: number | null;
  readonly reason: "OK" | "ROW_ALTERED" | "CHAIN_BROKEN" | "HEAD_MISSING" | "HEAD_ALTERED" | "TRUNCATED" | "INDEX_ALTERED";
}

/** Read side of the tamper check — `GET /audit/verify` needs nothing else. */
export interface AuditChainVerifyPort {
  verifyChain(): Promise<AuditChainVerification>;
}

/**
 * The key the chain HEAD is MAC'd with.
 *
 * The row hashes alone stop an edit in place; they do not stop someone
 * re-hashing the whole table after deleting a row, because the algorithm is in
 * the open. The head MAC is what they cannot forge — so its key must NOT live
 * inside the database the attacker is holding.
 *
 * Desktop passes a key derived from the sealed database key (which lives in the
 * OS keychain). A server edition has no keychain, so it gets a per-install
 * random key in a 0600 file beside the database — weaker, and still one more
 * artefact an attacker has to find and rewrite. An in-memory database gets a
 * per-process key: nothing survives the process, so nothing can be forged
 * across one.
 */
function resolveChainKey(sqlite: Database.Database, provided: string | undefined): Buffer {
  const material =
    provided ??
    process.env["MEZAN_AUDIT_CHAIN_KEY"] ??
    perInstallKey(sqlite);
  return createHash("sha256").update(`${CHAIN_VERSION}:key`, "utf8").update(material, "utf8").digest();
}

function perInstallKey(sqlite: Database.Database): string {
  const dbFile = sqlite.name;
  if (!dbFile || dbFile === ":memory:" || dbFile === "") return randomBytes(32).toString("hex");
  const keyFile = path.join(path.dirname(path.resolve(dbFile)), "audit-chain.key");
  try {
    const existing = readFileSync(keyFile, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    // Falls through to minting one.
  }
  const minted = randomBytes(32).toString("hex");
  try {
    mkdirSync(path.dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, `${minted}\n`, { mode: 0o600 });
    // `writeFileSync`'s mode is ignored for a file that already exists, and the
    // process umask can clear bits on a new one. Neither is a reason to leave
    // the key world-readable.
    chmodSync(keyFile, 0o600);
  } catch (err) {
    console.error("[audit] could not persist the chain key; the head MAC will not survive a restart", err);
  }
  return minted;
}

interface AuditRow {
  stream: string;
  module: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  actor: string;
  branch_id: string | null;
  timestamp: string;
  severity: string;
  details: string | null;
}

function rowToEvent(r: AuditRow): AuditEvent {
  return {
    stream: r.stream as AuditStream,
    module: r.module,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    actor: r.actor,
    branchId: r.branch_id,
    timestamp: r.timestamp,
    severity: r.severity as AuditEvent["severity"],
    details: r.details === null ? null : (JSON.parse(r.details) as Record<string, unknown>),
  };
}

/** Filterable column -> SQL column, for {@link SqliteAuditSink.queryEvents}. */
const FILTER_COLUMNS: Record<string, string> = {
  stream: "stream",
  module: "module",
  action: "action",
  actor: "actor",
  branchId: "branch_id",
  entityType: "entity_type",
  entityId: "entity_id",
  severity: "severity",
};

class SqliteAuditSink implements AuditSink, AuditQueryPort, AuditChainVerifyPort {
  private readonly insert: Database.Statement;
  private readonly select: Database.Statement;
  private readonly writeHead: Database.Statement;
  private readonly insertField: Database.Statement;
  private readonly appendChained: (row: AuditChainFields, fields: readonly string[]) => void;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly chainKey: Buffer,
  ) {
    this.insert = sqlite.prepare(
      `INSERT INTO audit_event
         (stream, module, entity_type, entity_id, action, actor, branch_id, timestamp, severity, details, prev_hash, row_hash)
       VALUES (@stream, @module, @entity_type, @entity_id, @action, @actor, @branch_id, @timestamp, @severity, @details, @prev_hash, @row_hash)`,
    );
    this.select = sqlite.prepare(
      `SELECT stream, module, entity_type, entity_id, action, actor, branch_id, timestamp, severity, details
         FROM audit_event WHERE stream = ? ORDER BY id DESC LIMIT ?`,
    );
    this.insertField = sqlite.prepare(`INSERT OR IGNORE INTO audit_event_field (event_id, field) VALUES (?, ?)`);
    this.writeHead = sqlite.prepare(
      `INSERT INTO audit_chain_head (id, row_id, row_hash, mac) VALUES (1, @row_id, @row_hash, @mac)
         ON CONFLICT(id) DO UPDATE SET row_id = @row_id, row_hash = @row_hash, mac = @mac`,
    );
    // ORDERING IS THE WHOLE CONTROL: the row and the head it advances have to
    // land together. A row appended without its head update reads as a
    // truncated chain on the next verify; a head advanced without its row reads
    // as a deleted one. Both are false alarms that would teach an owner to
    // ignore the alarm.
    // The field index rides in the same transaction as the row: a row whose
    // index entries are missing is invisible to a field search, which is the
    // exact hiding place this index exists to close.
    this.appendChained = sqlite.transaction((row: AuditChainFields, fields: readonly string[]) => {
      const prevHash = this.currentHeadHash();
      const rowHash = hashRow(row, prevHash);
      const info = this.insert.run({ ...row, prev_hash: prevHash, row_hash: rowHash });
      const rowId = Number(info.lastInsertRowid);
      for (const field of fields) this.insertField.run(rowId, field);
      this.writeHead.run({ row_id: rowId, row_hash: rowHash, mac: macHead(this.chainKey, rowId, rowHash) });
    });
  }

  private currentHeadHash(): string {
    const head = this.sqlite.prepare(`SELECT row_hash FROM audit_chain_head WHERE id = 1`).get() as
      | { row_hash: string }
      | undefined;
    if (head) return head.row_hash;
    // A database seeded before the chain existed: the chain starts at the next
    // row appended, and everything before it is reported as `unchained`.
    return GENESIS;
  }

  async append(event: AuditEvent): Promise<void> {
    this.appendChained({
      stream: event.stream,
      module: event.module,
      entity_type: event.entityType,
      entity_id: event.entityId,
      action: event.action,
      actor: event.actor,
      branch_id: event.branchId,
      timestamp: event.timestamp,
      severity: event.severity,
      details: event.details === null ? null : JSON.stringify(event.details),
    }, auditChangedFieldNames(event.details));
  }

  private findIndexFault(rows: readonly { id: number; details: string | null }[]): number | null {
    const stored = new Map<number, string[]>();
    for (const r of this.sqlite
      .prepare(`SELECT event_id, field FROM audit_event_field ORDER BY event_id, field`)
      .all() as { event_id: number; field: string }[]) {
      const list = stored.get(r.event_id);
      if (list) list.push(r.field);
      else stored.set(r.event_id, [r.field]);
    }
    for (const row of rows) {
      const expected = auditChangedFieldNames(parseDetails(row.details)).join("\u0000");
      const actual = [...(stored.get(row.id) ?? [])].sort().join("\u0000");
      stored.delete(row.id);
      if (expected !== actual) return row.id;
    }
    const orphan = stored.keys().next();
    return orphan.done ? null : orphan.value;
  }

  /**
   * Walks the chain oldest-first and reports the FIRST row that does not verify.
   *
   * Three separate faults are distinguished because they need different
   * answers: a row whose own fields were edited (`ROW_ALTERED`), a row whose
   * link to its predecessor no longer holds — which is what a DELETE in the
   * middle looks like (`CHAIN_BROKEN`), and a chain whose newest rows were cut
   * off, which only the head MAC can see (`TRUNCATED`/`HEAD_ALTERED`).
   */
  async verifyChain(): Promise<AuditChainVerification> {
    const rows = this.sqlite
      .prepare(
        `SELECT id, stream, module, entity_type, entity_id, action, actor, branch_id, timestamp, severity, details, prev_hash, row_hash
           FROM audit_event ORDER BY id ASC`,
      )
      .all() as (AuditChainFields & { id: number; prev_hash: string | null; row_hash: string | null })[];

    const unchained = rows.filter((r) => r.row_hash === null).length;
    const chained = rows.filter((r) => r.row_hash !== null);
    const head = this.sqlite.prepare(`SELECT row_id, row_hash, mac FROM audit_chain_head WHERE id = 1`).get() as
      | { row_id: number; row_hash: string; mac: string }
      | undefined;

    const indexFault = this.findIndexFault(rows);
    const indexAltered: AuditChainVerification = {
      ok: false,
      checked: chained.length,
      unchained,
      brokenRowId: indexFault,
      reason: "INDEX_ALTERED",
    };

    let prevHash = GENESIS;
    let checked = 0;
    for (const row of chained) {
      if ((row.prev_hash ?? GENESIS) !== prevHash) {
        return { ok: false, checked, unchained, brokenRowId: row.id, reason: "CHAIN_BROKEN" };
      }
      if (hashRow(row, row.prev_hash) !== row.row_hash) {
        return { ok: false, checked, unchained, brokenRowId: row.id, reason: "ROW_ALTERED" };
      }
      prevHash = row.row_hash as string;
      checked += 1;
    }

    if (chained.length === 0) {
      if (head === undefined && indexFault !== null) return indexAltered;
      return { ok: head === undefined, checked, unchained, brokenRowId: null, reason: head === undefined ? "OK" : "TRUNCATED" };
    }
    if (!head) return { ok: false, checked, unchained, brokenRowId: null, reason: "HEAD_MISSING" };

    const last = chained[chained.length - 1] as (typeof chained)[number];
    if (!macMatches(head.mac, macHead(this.chainKey, head.row_id, head.row_hash))) {
      return { ok: false, checked, unchained, brokenRowId: head.row_id, reason: "HEAD_ALTERED" };
    }
    // The head is authentic, so what it names is the true end of the chain. If
    // the table stops earlier, rows were removed from the end — the one edit
    // the per-row hashes cannot see, because every remaining row still links.
    if (head.row_id !== last.id || head.row_hash !== last.row_hash) {
      return { ok: false, checked, unchained, brokenRowId: last.id, reason: "TRUNCATED" };
    }
    if (indexFault !== null) return indexAltered;
    return { ok: true, checked, unchained, brokenRowId: null, reason: "OK" };
  }

  async query(stream: AuditStream, limit = 100): Promise<readonly AuditEvent[]> {
    const rows = this.select.all(stream, limit) as AuditRow[];
    return rows.map(rowToEvent);
  }

  /**
   * Filtered, paginated read for the audit viewer (`/audit`). Every field in
   * {@link AuditQueryFilter} is optional and AND-combined; `from`/`to` bound
   * `timestamp` inclusively. Newest-first, same as `query`.
   */
  async queryEvents(filter: AuditQueryFilter): Promise<AuditQueryResult> {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(FILTER_COLUMNS)) {
      const value = (filter as Record<string, unknown>)[key];
      if (value !== undefined) {
        conditions.push(`${column} = @${key}`);
        params[key] = value;
      }
    }
    if (filter.branchIds !== undefined) {
      const names = filter.branchIds.map((id, index) => {
        params[`branchIds${index}`] = id;
        return `@branchIds${index}`;
      });
      conditions.push(names.length > 0 ? `branch_id IN (${names.join(", ")})` : "0 = 1");
    }
    if (filter.field !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM audit_event_field f WHERE f.event_id = audit_event.id AND f.field = @field)");
      params.field = filter.field;
    }
    if (filter.from !== undefined) {
      conditions.push("timestamp >= @from");
      params.from = filter.from;
    }
    if (filter.to !== undefined) {
      conditions.push("timestamp <= @to");
      params.to = filter.to;
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);

    const total = (
      this.sqlite.prepare(`SELECT COUNT(*) AS c FROM audit_event ${where}`).get(params) as { c: number }
    ).c;
    const rows = this.sqlite
      .prepare(
        `SELECT stream, module, entity_type, entity_id, action, actor, branch_id, timestamp, severity, details
           FROM audit_event ${where} ORDER BY id DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as AuditRow[];

    return { events: rows.map(rowToEvent), total };
  }
}

export interface SqliteAuditSinkHandle extends AuditSink, AuditQueryPort, AuditChainVerifyPort {
  close(): void;
  /** The raw connection, for tests asserting the append-only triggers fire. */
  readonly db: Database.Database;
}

/**
 * Adds `branch_id` to a database created before the column existed. Existing
 * rows keep NULL — the table is append-only, so they cannot be back-filled and
 * are not meant to be.
 */
function addBranchColumnIfMissing(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(audit_event)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "branch_id")) {
    sqlite.exec(`ALTER TABLE audit_event ADD COLUMN branch_id TEXT`);
  }
  // Same reasoning as branch_id: cannot be back-filled on an append-only table,
  // and ALTER does not fire the UPDATE trigger.
  if (!columns.some((c) => c.name === "entity_id")) {
    sqlite.exec(`ALTER TABLE audit_event ADD COLUMN entity_id TEXT`);
  }
  // The hash chain, added to a database that predates it. NULLABLE, and left
  // NULL on every existing row: back-filling would need the UPDATE the
  // append-only trigger aborts, and a back-filled hash would prove nothing
  // anyway — it would attest to whatever the table said at migration time.
  // `verifyChain` counts those rows as `unchained` and starts at the first one
  // this build wrote.
  if (!columns.some((c) => c.name === "prev_hash")) {
    sqlite.exec(`ALTER TABLE audit_event ADD COLUMN prev_hash TEXT`);
  }
  if (!columns.some((c) => c.name === "row_hash")) {
    sqlite.exec(`ALTER TABLE audit_event ADD COLUMN row_hash TEXT`);
  }
}

/**
 * Creates the field index and, the first time only, fills it for rows written
 * before it existed. Later rows are indexed inside their own append.
 */
function createFieldIndex(sqlite: Database.Database): void {
  const existed =
    sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'audit_event_field'`).get() !== undefined;
  sqlite.exec(CREATE_FIELD_INDEX);
  if (existed) return;
  const rows = sqlite
    .prepare(`SELECT id, details FROM audit_event WHERE details LIKE '%"changes"%' ORDER BY id`)
    .all() as { id: number; details: string | null }[];
  const insert = sqlite.prepare(`INSERT OR IGNORE INTO audit_event_field (event_id, field) VALUES (?, ?)`);
  sqlite.transaction(() => {
    for (const row of rows) {
      for (const field of auditChangedFieldNames(parseDetails(row.details))) insert.run(row.id, field);
    }
  })();
}

export interface SqliteAuditSinkOptions {
  /**
   * Key material the chain HEAD is MAC'd under. The desktop passes a value
   * derived from the sealed database key; leaving it undefined falls back to
   * `MEZAN_AUDIT_CHAIN_KEY`, then to a per-install 0600 file beside the
   * database. See {@link resolveChainKey}.
   */
  readonly chainKey?: string;
}

/** Open a SQLite-backed AuditSink. ":memory:" for tests, a path for real. */
export function createSqliteAuditSink(
  path: SqliteConnectionInput = ":memory:",
  options: SqliteAuditSinkOptions = {},
): SqliteAuditSinkHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addBranchColumnIfMissing(sqlite);
  createFieldIndex(sqlite);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_audit_branch ON audit_event(branch_id, id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_event(entity_type, entity_id, id)`);
  const sink = new SqliteAuditSink(sqlite, resolveChainKey(sqlite, options.chainKey));
  return Object.assign(sink, {
    close: () => { if (owned) sqlite.close(); },
    db: sqlite,
  }) as SqliteAuditSinkHandle;
}

/**
 * Derives the audit chain key from the database encryption key.
 *
 * Separate value, same secret: the sealed DB key never leaves the keychain, and
 * an attacker holding the .db file has neither. Exported so the desktop
 * composition root can pass it in without knowing the derivation.
 */
export function deriveAuditChainKey(databaseKey: string): string {
  return createHash("sha256").update(`${CHAIN_VERSION}:db-key`, "utf8").update(databaseKey, "utf8").digest("hex");
}
