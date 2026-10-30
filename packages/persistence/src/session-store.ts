import type { ScopeSelection } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { ensureInsertionOrder, insertionOrder } from "./sql/insertion-order.js";
import { TransactionMode, type SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS auth_session (
  token_hash        TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  permissions       TEXT NOT NULL,
  role_code         TEXT,
  branch_scope      TEXT NOT NULL,
  warehouse_scope   TEXT NOT NULL,
  issued_at         INTEGER NOT NULL,
  issued_from       TEXT,
  device_hash       TEXT,
  last_origin       TEXT,
  moved_since_pin   INTEGER NOT NULL CHECK (moved_since_pin IN (0, 1)),
  last_seen_at      INTEGER NOT NULL,
  device_mismatches TEXT NOT NULL,
  idle_ms           INTEGER NOT NULL CHECK (idle_ms > 0),
  max_ms            INTEGER NOT NULL CHECK (max_ms > 0),
  access_expires_at INTEGER,
  must_change_password INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_device ON auth_session(device_hash) WHERE device_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_session_last_seen ON auth_session(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_auth_session_issued ON auth_session(issued_at);
CREATE TABLE IF NOT EXISTS auth_session_displaced (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  issued_from  TEXT,
  displaced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_session_displaced_at ON auth_session_displaced(displaced_at);
`;

export const SESSION_TABLES = ["auth_session", "auth_session_displaced"] as const;

const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;
const DISPLACED_REMEMBERED = 1000;

export interface PersistedSession {
  readonly userId: string;
  readonly permissions: readonly string[];
  readonly roleCode: string | null;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
  readonly issuedAt: number;
  readonly issuedFrom: string | null;
  readonly deviceHash: string | null;
  readonly lastOrigin: string | null;
  readonly movedSincePin: boolean;
  readonly lastSeenAt: number;
  readonly deviceMismatches: readonly number[];
  readonly idleMs: number;
  readonly maxMs: number;
  readonly accessExpiresAt?: number | null;
  readonly mustChangePassword?: boolean;
}

export interface PersistedDisplacedSession {
  readonly userId: string;
  readonly issuedFrom: string | null;
  readonly at: number;
}

export interface SqliteSessionStore {
  readonly lastSeenWriteIntervalMs: number;
  atomically<T>(work: () => Promise<T>): Promise<T>;
  get(key: string): Promise<PersistedSession | null>;
  put(key: string, session: PersistedSession): Promise<void>;
  remove(key: string): Promise<void>;
  removeUser(userId: string): Promise<void>;
  onDevice(deviceHash: string): Promise<ReadonlyArray<readonly [string, PersistedSession]>>;
  displaced(key: string): Promise<PersistedDisplacedSession | null>;
  rememberDisplaced(key: string, ended: PersistedDisplacedSession): Promise<void>;
  forgetDisplaced(key: string): Promise<void>;
  sweep(at: number, displacedForMs: number): Promise<void>;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  permissions: string;
  role_code: string | null;
  branch_scope: string;
  warehouse_scope: string;
  issued_at: bigint;
  issued_from: string | null;
  device_hash: string | null;
  last_origin: string | null;
  moved_since_pin: bigint;
  last_seen_at: bigint;
  device_mismatches: string;
  idle_ms: bigint;
  max_ms: bigint;
  access_expires_at: bigint | null;
  must_change_password: bigint | number;
}

interface DisplacedRow {
  user_id: string;
  issued_from: string | null;
  displaced_at: bigint;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function strings(raw: string): string[] {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

// SECURITY: a scope that does not parse narrows to nothing, never to "*".
function scope(raw: string): ScopeSelection {
  const parsed = parseJson(raw);
  if (parsed === "*") return "*";
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

function numbers(raw: string): number[] {
  const parsed = parseJson(raw);
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
}

function toSession(row: SessionRow): PersistedSession {
  return {
    userId: row.user_id,
    permissions: strings(row.permissions),
    roleCode: row.role_code,
    branchScope: scope(row.branch_scope),
    warehouseScope: scope(row.warehouse_scope),
    issuedAt: Number(row.issued_at),
    issuedFrom: row.issued_from,
    deviceHash: row.device_hash,
    lastOrigin: row.last_origin,
    movedSincePin: Number(row.moved_since_pin) === 1,
    lastSeenAt: Number(row.last_seen_at),
    deviceMismatches: numbers(row.device_mismatches),
    idleMs: Number(row.idle_ms),
    maxMs: Number(row.max_ms),
    accessExpiresAt: row.access_expires_at === null ? null : Number(row.access_expires_at),
    mustChangePassword: Number(row.must_change_password) === 1,
  };
}

const SESSION_COLUMNS = `token_hash, user_id, permissions, role_code, branch_scope, warehouse_scope, issued_at, issued_from, device_hash,
       last_origin, moved_since_pin, last_seen_at, device_mismatches, idle_ms, max_ms, access_expires_at, must_change_password`;

export async function ensureSessionSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
  await ensureInsertionOrder(db, "auth_session_displaced");
}

/**
 * SECURITY: sessions live in the database every server instance of the tenant
 * (or of the platform) shares, so a token minted on one instance is known to
 * the next, and a revoke on one — sign-out, password change, unlock,
 * displacement — is a revoke on all. Only the SHA-256 of a token is ever
 * stored; a dump of this table hands over no live session.
 */
export function createSessionStore(db: SqlDb): SqliteSessionStore {
  const order = insertionOrder(db);
  const atomic = <T>(work: () => Promise<T>): Promise<T> => db.transaction(work, TransactionMode.Immediate);
  return {
    lastSeenWriteIntervalMs: LAST_SEEN_WRITE_INTERVAL_MS,
    atomically: atomic,
    async get(key) {
      const row = await db.get<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM auth_session WHERE token_hash = ?`, [key]);
      return row ? toSession(row) : null;
    },
    async put(key, session) {
      await db.run(
        `INSERT INTO auth_session (${SESSION_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (token_hash) DO UPDATE SET
           last_origin = excluded.last_origin, moved_since_pin = excluded.moved_since_pin,
           last_seen_at = excluded.last_seen_at, device_mismatches = excluded.device_mismatches`,
        [
          key,
          session.userId,
          JSON.stringify(session.permissions),
          session.roleCode,
          JSON.stringify(session.branchScope),
          JSON.stringify(session.warehouseScope),
          session.issuedAt,
          session.issuedFrom,
          session.deviceHash,
          session.lastOrigin,
          session.movedSincePin ? 1 : 0,
          session.lastSeenAt,
          JSON.stringify(session.deviceMismatches),
          session.idleMs,
          session.maxMs,
          session.accessExpiresAt ?? null,
          session.mustChangePassword ? 1 : 0,
        ],
      );
    },
    remove: async (key) => {
      await db.run(`DELETE FROM auth_session WHERE token_hash = ?`, [key]);
    },
    removeUser: async (userId) => {
      await db.run(`DELETE FROM auth_session WHERE user_id = ?`, [userId]);
    },
    onDevice: async (deviceHash) =>
      (await db.all<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM auth_session WHERE device_hash = ?`, [deviceHash])).map((row) => [row.token_hash, toSession(row)] as const),
    async displaced(key) {
      const row = await db.get<DisplacedRow>(`SELECT user_id, issued_from, displaced_at FROM auth_session_displaced WHERE token_hash = ?`, [key]);
      return row ? { userId: row.user_id, issuedFrom: row.issued_from, at: Number(row.displaced_at) } : null;
    },
    rememberDisplaced: (key, ended) =>
      atomic(async () => {
        await db.run(
          `INSERT INTO auth_session_displaced (token_hash, user_id, issued_from, displaced_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (token_hash) DO UPDATE SET user_id = excluded.user_id, issued_from = excluded.issued_from, displaced_at = excluded.displaced_at`,
          [key, ended.userId, ended.issuedFrom, ended.at],
        );
        await db.run(
          `DELETE FROM auth_session_displaced WHERE token_hash NOT IN (
             SELECT token_hash FROM auth_session_displaced ORDER BY displaced_at DESC, ${order} DESC LIMIT ?
           )`,
          [DISPLACED_REMEMBERED],
        );
      }),
    forgetDisplaced: async (key) => {
      await db.run(`DELETE FROM auth_session_displaced WHERE token_hash = ?`, [key]);
    },
    sweep: (at, displacedForMs) =>
      atomic(async () => {
        await db.run(
          `DELETE FROM auth_session WHERE ? - last_seen_at > idle_ms OR ? - issued_at > max_ms OR (access_expires_at IS NOT NULL AND ? >= access_expires_at)`,
          [at, at, at],
        );
        await db.run(`DELETE FROM auth_session_displaced WHERE ? - displaced_at > ?`, [at, displacedForMs]);
      }),
  };
}

export function createSqliteSessionStore(input: SqliteConnectionInput): SqliteSessionStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLES);
  return createSessionStore(sqliteDb(sqlite));
}
