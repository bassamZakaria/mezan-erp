import Database from "better-sqlite3";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  insideSqliteTransaction,
  openSqliteConnection,
  sqliteTransactionsSettled,
  withSqliteTurn,
  outsideSqliteTurn,
  holdsSqliteTurn,
  withSqliteTransaction,
  type SqliteConnectionInput,
} from "./sqlite-connection.js";
import { auditChangedFieldNames, AuditChainHeadReason, AuditStreamName, recordSecurityEventOrFallback } from "@mezan/domain";
import { reportUntransactedAudit } from "./untransacted-audits.js";
import { placeholders, SqlDialect, TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import type { AuditEvent, AuditQueryFilter, AuditQueryPort, AuditQueryResult, AuditSink, AuditStream, TurnObserver } from "@mezan/domain";

/**
 * SQL-backed AuditSink (docs/archive/plan.md §5.7).
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
`;

const SQLITE_APPEND_ONLY_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS audit_event_no_update
  BEFORE UPDATE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_no_delete
  BEFORE DELETE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
`;

const FIELD_INDEX_TABLE = `
CREATE TABLE IF NOT EXISTS audit_event_field (
  event_id INTEGER NOT NULL,
  field    TEXT NOT NULL,
  PRIMARY KEY (event_id, field)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_audit_event_field ON audit_event_field(field, event_id);
`;

const SQLITE_FIELD_INDEX_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS audit_event_field_no_update
  BEFORE UPDATE ON audit_event_field
  BEGIN SELECT RAISE(ABORT, 'audit_event_field is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_field_no_delete
  BEFORE DELETE ON audit_event_field
  BEGIN SELECT RAISE(ABORT, 'audit_event_field is append-only'); END;
`;

const CREATE_FIELD_INDEX = `${FIELD_INDEX_TABLE}${SQLITE_FIELD_INDEX_TRIGGERS}`;

const LATER_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_audit_branch ON audit_event(branch_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_event(entity_type, entity_id, id);
`;

// CONTRACT: the same message text as the SQLite RAISE(ABORT, ...) above — callers match on it.
// TRUNCATE has no row trigger, so it is refused by a statement trigger of its own.
const POSTGRES_APPEND_ONLY_TRIGGERS = ["audit_event", "audit_event_field"]
  .map(
    (table) => `
CREATE OR REPLACE FUNCTION ${table}_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '${table} is append-only';
END;
$fn$;
CREATE OR REPLACE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only();
CREATE OR REPLACE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_append_only();
CREATE OR REPLACE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${table}_append_only();
`,
  )
  .join("");

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
function chainKeyOf(material: string): Buffer {
  return createHash("sha256").update(`${CHAIN_VERSION}:key`, "utf8").update(material, "utf8").digest();
}

function resolveChainKey(sqlite: Database.Database, provided: string | undefined): Buffer {
  return chainKeyOf(provided ?? process.env["MEZAN_AUDIT_CHAIN_KEY"] ?? perInstallKey(sqlite));
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

function chainFieldsOf(event: AuditEvent): AuditChainFields {
  return {
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
  };
}

const AUDIT_ROW_COLUMNS = "stream, module, entity_type, entity_id, action, actor, branch_id, timestamp, severity, details";
const INSERT_AUDIT_ROW = `INSERT INTO audit_event (${AUDIT_ROW_COLUMNS}, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_FIELD = `INSERT INTO audit_event_field (event_id, field) VALUES (?, ?) ON CONFLICT DO NOTHING`;
const WRITE_HEAD = `INSERT INTO audit_chain_head (id, row_id, row_hash, mac) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET row_id = excluded.row_id, row_hash = excluded.row_hash, mac = excluded.mac`;

function rowParams(row: AuditChainFields, prevHash: string | null, rowHash: string): (string | null)[] {
  return [row.stream, row.module, row.entity_type, row.entity_id, row.action, row.actor, row.branch_id, row.timestamp, row.severity, row.details, prevHash, rowHash];
}

/**
 * How an append reaches the SQLite connection when its caller already holds a
 * transaction there. Absent on Postgres, where every append goes through
 * `db.transaction` and joins the caller's transaction as a savepoint.
 */
interface AuditSinkAmbient {
  appendInsideCallerTransaction(row: AuditChainFields, fields: readonly string[]): boolean;
  reportUntransacted(event: AuditEvent): void;
}

interface ChainRow extends AuditChainFields {
  id: bigint;
  prev_hash: string | null;
  row_hash: string | null;
}

interface HeadRow {
  row_id: bigint;
  row_hash: string;
  mac: string;
}

class SqlAuditSink implements AuditSink, AuditQueryPort, AuditChainVerifyPort {
  private readonly heldBack = new AsyncLocalStorage<{ open: boolean; readonly events: AuditEvent[] }>();

  constructor(
    private readonly db: SqlDb,
    private readonly chainKey: Buffer,
    private readonly ambient?: AuditSinkAmbient,
  ) {}

  // ORDERING IS THE WHOLE CONTROL: the row and the head it advances have to
  // land together. A row appended without its head update reads as a
  // truncated chain on the next verify; a head advanced without its row reads
  // as a deleted one. Both are false alarms that would teach an owner to
  // ignore the alarm.
  // The field index rides in the same transaction as the row: a row whose
  // index entries are missing is invisible to a field search, which is the
  // exact hiding place this index exists to close.
  // REQUIRED: runs under `db.transaction(..., Immediate)` — the tenant's write
  // lock — so two appends can never read the same head.
  private async appendChained(row: AuditChainFields, fields: readonly string[]): Promise<void> {
    const prevHash = (await this.db.get<{ row_hash: string }>(`SELECT row_hash FROM audit_chain_head WHERE id = 1`))?.row_hash ?? GENESIS;
    const rowHash = hashRow(row, prevHash);
    const inserted = await this.db.get<{ id: bigint }>(`${INSERT_AUDIT_ROW} RETURNING id`, rowParams(row, prevHash, rowHash));
    const rowId = Number(inserted!.id);
    for (const field of fields) await this.db.run(INSERT_FIELD, [rowId, field]);
    await this.db.run(WRITE_HEAD, [rowId, rowHash, macHead(this.chainKey, rowId, rowHash)]);
  }

  // A STAND-ALONE append takes the tenant's write lock through `db.transaction`,
  // never a driver-level transaction of its own: on the shared SQLite
  // connection that would nest as a SAVEPOINT inside whatever unrelated
  // request has a BEGIN open and vanish if that request rolls back.
  // On SQLite an append made INSIDE its caller's transaction stays synchronous
  // (see `AuditSinkAmbient`): its savepoint is released before this function
  // returns, so a caller that does not await the append cannot commit ahead of it.
  async append(event: AuditEvent): Promise<void> {
    const held = event.stream === AuditStreamName.Security ? this.heldBack.getStore() : undefined;
    if (held?.open) {
      held.events.push(event);
      return;
    }
    const row = chainFieldsOf(event);
    const fields = auditChangedFieldNames(event.details);
    if (this.ambient?.appendInsideCallerTransaction(row, fields)) return;
    this.ambient?.reportUntransacted(event);
    await this.db.transaction(() => this.appendChained(row, fields), TransactionMode.Immediate);
  }

  // SECURITY: a security event appended while `fn` runs is written only after
  // `fn` settles, so a transaction `fn` opens and rolls back cannot take the
  // record of a refused attempt with it; one that still cannot be written
  // goes to the unrecorded-events file. `appendSync` is not held back: its
  // callers need the row atomic with their own write.
  // On Postgres the held events are written after `fn`'s transaction has
  // ended, so they go out on a pool connection of their own — the same
  // guarantee, by the same ordering.
  async securityEventsOutlive<T>(fn: () => Promise<T>): Promise<T> {
    const held = { open: true, events: [] as AuditEvent[] };
    try {
      return await this.heldBack.run(held, fn);
    } finally {
      held.open = false;
      for (const event of held.events) await recordSecurityEventOrFallback(this, event);
    }
  }

  atomic<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  private async findIndexFault(rows: readonly { id: bigint; details: string | null }[]): Promise<number | null> {
    const stored = new Map<number, string[]>();
    for (const r of await this.db.all<{ event_id: bigint; field: string }>(`SELECT event_id, field FROM audit_event_field ORDER BY event_id, field`)) {
      const eventId = Number(r.event_id);
      const list = stored.get(eventId);
      if (list) list.push(r.field);
      else stored.set(eventId, [r.field]);
    }
    for (const row of rows) {
      const id = Number(row.id);
      const expected = auditChangedFieldNames(parseDetails(row.details)).join("\u0000");
      const actual = [...(stored.get(id) ?? [])].sort().join("\u0000");
      stored.delete(id);
      if (expected !== actual) return id;
    }
    const orphan = stored.keys().next();
    return orphan.done ? null : orphan.value;
  }

  private head(): Promise<HeadRow | undefined> {
    return this.db.get<HeadRow>(`SELECT row_id, row_hash, mac FROM audit_chain_head WHERE id = 1`);
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
  // One transaction, so no append can land between reading the rows and reading the head.
  async verifyChain(): Promise<AuditChainVerification> {
    return this.db.transaction(async () => {
      const rows = await this.db.all<ChainRow>(`SELECT id, ${AUDIT_ROW_COLUMNS}, prev_hash, row_hash FROM audit_event ORDER BY id ASC`);

      const unchained = rows.filter((r) => r.row_hash === null).length;
      const chained = rows.filter((r) => r.row_hash !== null);
      const head = await this.head();

      const indexFault = await this.findIndexFault(rows);
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
          return { ok: false, checked, unchained, brokenRowId: Number(row.id), reason: "CHAIN_BROKEN" };
        }
        if (hashRow(row, row.prev_hash) !== row.row_hash) {
          return { ok: false, checked, unchained, brokenRowId: Number(row.id), reason: "ROW_ALTERED" };
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
      const headRowId = Number(head.row_id);
      if (!macMatches(head.mac, macHead(this.chainKey, headRowId, head.row_hash))) {
        return { ok: false, checked, unchained, brokenRowId: headRowId, reason: "HEAD_ALTERED" };
      }
      // The head is authentic, so what it names is the true end of the chain. If
      // the table stops earlier, rows were removed from the end — the one edit
      // the per-row hashes cannot see, because every remaining row still links.
      if (headRowId !== Number(last.id) || head.row_hash !== last.row_hash) {
        return { ok: false, checked, unchained, brokenRowId: Number(last.id), reason: "TRUNCATED" };
      }
      if (indexFault !== null) return indexAltered;
      return { ok: true, checked, unchained, brokenRowId: null, reason: "OK" };
    });
  }

  async verifyHead(): Promise<{ reason: AuditChainHeadReason; headRowId: number | null }> {
    const { head, last } = await this.db.transaction(async () => ({
      head: await this.head(),
      last: await this.db.get<{ id: bigint; row_hash: string }>(`SELECT id, row_hash FROM audit_event WHERE row_hash IS NOT NULL ORDER BY id DESC LIMIT 1`),
    }));
    if (!head) return { reason: last ? AuditChainHeadReason.HeadMissing : AuditChainHeadReason.Empty, headRowId: null };
    const headRowId = Number(head.row_id);
    if (!macMatches(head.mac, macHead(this.chainKey, headRowId, head.row_hash))) {
      return { reason: AuditChainHeadReason.HeadAltered, headRowId };
    }
    if (!last || Number(last.id) !== headRowId || last.row_hash !== head.row_hash) {
      return { reason: AuditChainHeadReason.Truncated, headRowId };
    }
    return { reason: AuditChainHeadReason.Ok, headRowId };
  }

  async chainHead(): Promise<AuditChainHeadReading | null> {
    const head = await this.db.get<{ row_id: bigint; row_hash: string }>(`SELECT row_id, row_hash FROM audit_chain_head WHERE id = 1`);
    return head ? { rowId: Number(head.row_id), rowHash: head.row_hash } : null;
  }

  async chainRowHash(rowId: number): Promise<string | null> {
    const row = await this.db.get<{ row_hash: string | null }>(`SELECT row_hash FROM audit_event WHERE id = ?`, [rowId]);
    return row?.row_hash ?? null;
  }

  async query(stream: AuditStream, limit = 100): Promise<readonly AuditEvent[]> {
    const rows = await this.db.all<AuditRow>(`SELECT ${AUDIT_ROW_COLUMNS} FROM audit_event WHERE stream = ? ORDER BY id DESC LIMIT ?`, [stream, limit]);
    return rows.map(rowToEvent);
  }

  /**
   * Filtered, paginated read for the audit viewer (`/audit`). Every field in
   * {@link AuditQueryFilter} is optional and AND-combined; `from`/`to` bound
   * `timestamp` inclusively. Newest-first, same as `query`.
   */
  async queryEvents(filter: AuditQueryFilter): Promise<AuditQueryResult> {
    const conditions: string[] = [];
    const params: SqlValue[] = [];
    for (const [key, column] of Object.entries(FILTER_COLUMNS)) {
      const value = (filter as Record<string, unknown>)[key];
      if (value !== undefined) {
        conditions.push(`${column} = ?`);
        params.push(value as SqlValue);
      }
    }
    if (filter.branchIds !== undefined) {
      conditions.push(filter.branchIds.length > 0 ? `branch_id IN (${placeholders(filter.branchIds.length)})` : "0 = 1");
      params.push(...filter.branchIds);
    }
    if (filter.field !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM audit_event_field f WHERE f.event_id = audit_event.id AND f.field = ?)");
      params.push(filter.field);
    }
    if (filter.from !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(filter.from);
    }
    if (filter.to !== undefined) {
      conditions.push("timestamp <= ?");
      params.push(filter.to);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);

    const total = Number((await this.db.get<{ c: bigint }>(`SELECT COUNT(*) AS c FROM audit_event ${where}`, params))!.c);
    const rows = await this.db.all<AuditRow>(
      `SELECT ${AUDIT_ROW_COLUMNS} FROM audit_event ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return { events: rows.map(rowToEvent), total };
  }
}

export interface AuditSinkHandle extends AuditSink, AuditQueryPort, AuditChainVerifyPort, AuditChainAnchorSource {
  atomic<T>(fn: () => Promise<T>): Promise<T>;
  verifyHead(): Promise<{ reason: AuditChainHeadReason; headRowId: number | null }>;
  securityEventsOutlive<T>(fn: () => Promise<T>): Promise<T>;
}

export interface AuditSinkOptions {
  /**
   * Key material the chain HEAD is MAC'd under. Absent, `MEZAN_AUDIT_CHAIN_KEY`
   * is used; with neither, the sink refuses to open — a per-process key would
   * report every head written before a restart as altered.
   */
  readonly chainKey?: string;
}

export async function ensureAuditSchema(db: SqlDb): Promise<void> {
  await db.applySchema(`${CREATE_TABLE}${FIELD_INDEX_TABLE}${LATER_INDEXES}`);
  if (db.dialect === SqlDialect.Postgres) await db.exec(POSTGRES_APPEND_ONLY_TRIGGERS);
  else await db.exec(`${SQLITE_APPEND_ONLY_TRIGGERS}${SQLITE_FIELD_INDEX_TRIGGERS}`);
}

export function createAuditSink(db: SqlDb, options: AuditSinkOptions = {}): AuditSinkHandle {
  const material = options.chainKey ?? process.env["MEZAN_AUDIT_CHAIN_KEY"];
  if (material === undefined) throw new AuditChainKeyMissingError("the tenant database");
  return new SqlAuditSink(db, chainKeyOf(material));
}

export interface SqliteAuditSinkHandle extends AuditSinkHandle {
  insideTransaction(): boolean;
  settled(): Promise<void>;
  turn<T>(fn: () => Promise<T>, observer?: TurnObserver): Promise<T>;
  outsideTurn<T>(fn: () => Promise<T>): Promise<T>;
  // CONTRACT: for a caller already inside its own synchronous transaction on
  // this connection; the row is a savepoint of that transaction. SQLite only.
  appendSync(event: AuditEvent): void;
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
  const insert = sqlite.prepare(INSERT_FIELD);
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
  sqlite.exec(SQLITE_APPEND_ONLY_TRIGGERS);
  addBranchColumnIfMissing(sqlite);
  createFieldIndex(sqlite);
  sqlite.exec(LATER_INDEXES);
  const chainKey = resolveChainKey(sqlite, options.chainKey);
  const appendNested = sqliteNestedAppend(sqlite, chainKey);
  const sink = new SqlAuditSink(sqliteDb(sqlite), chainKey, {
    appendInsideCallerTransaction(row, fields) {
      if (!insideSqliteTransaction(sqlite)) return false;
      appendNested(row, fields);
      return true;
    },
    reportUntransacted(event) {
      if (event.stream === AuditStreamName.Sensitive && holdsSqliteTurn(sqlite)) {
        reportUntransactedAudit(`${event.module}/${event.entityType}/${event.action}`);
      }
    },
  });
  return Object.assign(sink, {
    atomic: <T>(fn: () => Promise<T>): Promise<T> => withSqliteTransaction(sqlite, fn),
    insideTransaction: () => insideSqliteTransaction(sqlite),
    settled: () => sqliteTransactionsSettled(sqlite),
    turn: <T>(fn: () => Promise<T>, observer?: TurnObserver): Promise<T> => withSqliteTurn(sqlite, fn, observer),
    outsideTurn: <T>(fn: () => Promise<T>): Promise<T> => outsideSqliteTurn(sqlite, fn),
    appendSync: (event: AuditEvent): void => appendNested(chainFieldsOf(event), auditChangedFieldNames(event.details)),
    close: () => { if (owned) sqlite.close(); },
    db: sqlite,
  }) as SqliteAuditSinkHandle;
}

// The synchronous append the SQLite connection needs for a caller inside its
// own transaction: better-sqlite3's `transaction()` nests as a SAVEPOINT of it
// and is released before this returns. Same statements as `appendChained`.
function sqliteNestedAppend(sqlite: Database.Database, chainKey: Buffer): (row: AuditChainFields, fields: readonly string[]) => void {
  const head = sqlite.prepare(`SELECT row_hash FROM audit_chain_head WHERE id = 1`);
  const insert = sqlite.prepare(INSERT_AUDIT_ROW);
  const insertField = sqlite.prepare(INSERT_FIELD);
  const writeHead = sqlite.prepare(WRITE_HEAD);
  return sqlite.transaction((row: AuditChainFields, fields: readonly string[]) => {
    const prevHash = (head.get() as { row_hash: string } | undefined)?.row_hash ?? GENESIS;
    const rowHash = hashRow(row, prevHash);
    const rowId = Number(insert.run(...rowParams(row, prevHash, rowHash)).lastInsertRowid);
    for (const field of fields) insertField.run(rowId, field);
    writeHead.run(rowId, rowHash, macHead(chainKey, rowId, rowHash));
  });
}

export interface AuditChainHeadReading {
  readonly rowId: number;
  readonly rowHash: string;
}

/** What the anchor job reads from a live sink. Call it inside the sink's turn: the sink shares its connection with in-flight requests. */
export interface AuditChainAnchorSource {
  chainHead(): Promise<AuditChainHeadReading | null>;
  chainRowHash(rowId: number): Promise<string | null>;
}

export function isAuditChainAnchorSource(sink: unknown): sink is AuditChainAnchorSource {
  return typeof sink === "object" && sink !== null && typeof (sink as AuditChainAnchorSource).chainHead === "function";
}

export interface AuditChainFileReader {
  head(): AuditChainHeadReading | null;
  rowHashAt(rowId: number): string | null;
  verify(): Promise<AuditChainVerification>;
  close(): void;
}

export class AuditChainKeyMissingError extends Error {
  constructor(file: string) {
    super(`no audit chain key for "${file}": set MEZAN_AUDIT_CHAIN_KEY or place the original audit-chain.key beside the database`);
    this.name = "AuditChainKeyMissingError";
  }
}

function existingChainKeyMaterial(file: string, provided: string | undefined): string {
  if (provided !== undefined) return provided;
  const fromEnv = process.env["MEZAN_AUDIT_CHAIN_KEY"];
  if (fromEnv !== undefined) return fromEnv;
  try {
    const existing = readFileSync(path.join(path.dirname(path.resolve(file)), "audit-chain.key"), "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    // Falls through to the refusal below.
  }
  throw new AuditChainKeyMissingError(file);
}

/**
 * Read-only view of one database file's audit chain, for the anchor job and the
 * verifier. SECURITY: never writes the file and never mints a chain key — a
 * verifier that minted one would report a forged head as merely "altered".
 */
export function openAuditChainFile(file: string, options: SqliteAuditSinkOptions = {}): AuditChainFileReader {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  const hasTable = (name: string): boolean =>
    sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
  let sink: SqlAuditSink | null = null;
  return {
    head() {
      if (!hasTable("audit_chain_head")) return null;
      const row = sqlite.prepare(`SELECT row_id, row_hash FROM audit_chain_head WHERE id = 1`).get() as
        | { row_id: number; row_hash: string }
        | undefined;
      return row ? { rowId: row.row_id, rowHash: row.row_hash } : null;
    },
    rowHashAt(rowId) {
      if (!hasTable("audit_event")) return null;
      const row = sqlite.prepare(`SELECT row_hash FROM audit_event WHERE id = ?`).get(rowId) as { row_hash: string | null } | undefined;
      return row?.row_hash ?? null;
    },
    async verify() {
      if (!hasTable("audit_event")) return { ok: true, checked: 0, unchained: 0, brokenRowId: null, reason: "OK" };
      sink ??= new SqlAuditSink(sqliteDb(sqlite), chainKeyOf(existingChainKeyMaterial(file, options.chainKey)));
      return sink.verifyChain();
    },
    close: () => sqlite.close(),
  };
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
