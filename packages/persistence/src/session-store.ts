import type { ScopeSelection } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

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
  max_ms            INTEGER NOT NULL CHECK (max_ms > 0)
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
}

export interface PersistedDisplacedSession {
  readonly userId: string;
  readonly issuedFrom: string | null;
  readonly at: number;
}

export interface SqliteSessionStore {
  readonly lastSeenWriteIntervalMs: number;
  atomically<T>(work: () => T): T;
  get(key: string): PersistedSession | null;
  put(key: string, session: PersistedSession): void;
  remove(key: string): void;
  removeUser(userId: string): void;
  onDevice(deviceHash: string): ReadonlyArray<readonly [string, PersistedSession]>;
  displaced(key: string): PersistedDisplacedSession | null;
  rememberDisplaced(key: string, ended: PersistedDisplacedSession): void;
  forgetDisplaced(key: string): void;
  sweep(at: number, displacedForMs: number): void;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  permissions: string;
  role_code: string | null;
  branch_scope: string;
  warehouse_scope: string;
  issued_at: number;
  issued_from: string | null;
  device_hash: string | null;
  last_origin: string | null;
  moved_since_pin: number;
  last_seen_at: number;
  device_mismatches: string;
  idle_ms: number;
  max_ms: number;
}

interface DisplacedRow {
  user_id: string;
  issued_from: string | null;
  displaced_at: number;
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
    issuedAt: row.issued_at,
    issuedFrom: row.issued_from,
    deviceHash: row.device_hash,
    lastOrigin: row.last_origin,
    movedSincePin: row.moved_since_pin === 1,
    lastSeenAt: row.last_seen_at,
    deviceMismatches: numbers(row.device_mismatches),
    idleMs: row.idle_ms,
    maxMs: row.max_ms,
  };
}

/**
 * SECURITY: sessions live in the database every server instance of the tenant
 * (or of the platform) shares, so a token minted on one instance is known to
 * the next, and a revoke on one — sign-out, password change, unlock,
 * displacement — is a revoke on all. Only the SHA-256 of a token is ever
 * stored; a dump of this table hands over no live session.
 */
export function createSqliteSessionStore(input: SqliteConnectionInput): SqliteSessionStore {
  const { sqlite } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLES);

  const get = sqlite.prepare(`SELECT * FROM auth_session WHERE token_hash = ?`);
  const put = sqlite.prepare(
    `INSERT INTO auth_session (token_hash, user_id, permissions, role_code, branch_scope, warehouse_scope, issued_at, issued_from, device_hash,
       last_origin, moved_since_pin, last_seen_at, device_mismatches, idle_ms, max_ms)
     VALUES (@token_hash, @user_id, @permissions, @role_code, @branch_scope, @warehouse_scope, @issued_at, @issued_from, @device_hash,
       @last_origin, @moved_since_pin, @last_seen_at, @device_mismatches, @idle_ms, @max_ms)
     ON CONFLICT (token_hash) DO UPDATE SET
       last_origin = excluded.last_origin, moved_since_pin = excluded.moved_since_pin,
       last_seen_at = excluded.last_seen_at, device_mismatches = excluded.device_mismatches`,
  );
  const remove = sqlite.prepare(`DELETE FROM auth_session WHERE token_hash = ?`);
  const removeUser = sqlite.prepare(`DELETE FROM auth_session WHERE user_id = ?`);
  const onDevice = sqlite.prepare(`SELECT * FROM auth_session WHERE device_hash = ?`);
  const expire = sqlite.prepare(`DELETE FROM auth_session WHERE ? - last_seen_at > idle_ms OR ? - issued_at > max_ms`);
  const getDisplaced = sqlite.prepare(`SELECT user_id, issued_from, displaced_at FROM auth_session_displaced WHERE token_hash = ?`);
  const putDisplaced = sqlite.prepare(
    `INSERT INTO auth_session_displaced (token_hash, user_id, issued_from, displaced_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (token_hash) DO UPDATE SET user_id = excluded.user_id, issued_from = excluded.issued_from, displaced_at = excluded.displaced_at`,
  );
  const forgetDisplaced = sqlite.prepare(`DELETE FROM auth_session_displaced WHERE token_hash = ?`);
  const expireDisplaced = sqlite.prepare(`DELETE FROM auth_session_displaced WHERE ? - displaced_at > ?`);
  const boundDisplaced = sqlite.prepare(
    `DELETE FROM auth_session_displaced WHERE rowid NOT IN (
       SELECT rowid FROM auth_session_displaced ORDER BY displaced_at DESC, rowid DESC LIMIT ?
     )`,
  );

  const atomic = <T>(work: () => T): T => sqlite.transaction(work).immediate() as T;

  return {
    lastSeenWriteIntervalMs: LAST_SEEN_WRITE_INTERVAL_MS,
    atomically: atomic,
    get(key) {
      const row = get.get(key) as SessionRow | undefined;
      return row ? toSession(row) : null;
    },
    put(key, session) {
      put.run({
        token_hash: key,
        user_id: session.userId,
        permissions: JSON.stringify(session.permissions),
        role_code: session.roleCode,
        branch_scope: JSON.stringify(session.branchScope),
        warehouse_scope: JSON.stringify(session.warehouseScope),
        issued_at: session.issuedAt,
        issued_from: session.issuedFrom,
        device_hash: session.deviceHash,
        last_origin: session.lastOrigin,
        moved_since_pin: session.movedSincePin ? 1 : 0,
        last_seen_at: session.lastSeenAt,
        device_mismatches: JSON.stringify(session.deviceMismatches),
        idle_ms: session.idleMs,
        max_ms: session.maxMs,
      });
    },
    remove: (key) => void remove.run(key),
    removeUser: (userId) => void removeUser.run(userId),
    onDevice: (deviceHash) => (onDevice.all(deviceHash) as SessionRow[]).map((row) => [row.token_hash, toSession(row)] as const),
    displaced(key) {
      const row = getDisplaced.get(key) as DisplacedRow | undefined;
      return row ? { userId: row.user_id, issuedFrom: row.issued_from, at: row.displaced_at } : null;
    },
    rememberDisplaced(key, ended) {
      atomic(() => {
        putDisplaced.run(key, ended.userId, ended.issuedFrom, ended.at);
        boundDisplaced.run(DISPLACED_REMEMBERED);
      });
    },
    forgetDisplaced: (key) => void forgetDisplaced.run(key),
    sweep(at, displacedForMs) {
      atomic(() => {
        expire.run(at, at);
        expireDisplaced.run(at, displacedForMs);
      });
    },
  };
}
