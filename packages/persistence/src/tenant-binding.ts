import Database from "better-sqlite3";
import { applyKey, type SqliteOpenOptions } from "./sqlite-connection.js";
import { SETTINGS_ROW_ID } from "./settings-store.js";

const BINDING_ROW_ID = 1;

const CREATE_BINDING_TABLE = `
CREATE TABLE IF NOT EXISTS tenant_binding (
  id        INTEGER PRIMARY KEY CHECK (id = ${BINDING_ROW_ID}),
  tenant_id TEXT NOT NULL,
  bound_at  TEXT NOT NULL
);
`;

export class TenantBindingMismatchError extends Error {
  readonly code = "TENANT_BINDING_MISMATCH";

  constructor(readonly expectedTenantId: string, readonly boundTenantId: string) {
    super(`this database is bound to tenant "${boundTenantId}", not "${expectedTenantId}"; nothing was written`);
    this.name = "TenantBindingMismatchError";
  }
}

export class NotASqliteDatabaseError extends Error {
  readonly code = "NOT_A_SQLITE_DATABASE";

  constructor(readonly file: string, readonly cause: unknown) {
    super(`"${file}" is not a readable SQLite database`);
    this.name = "NotASqliteDatabaseError";
  }
}

const UNREADABLE_CODES = ["SQLITE_NOTADB", "SQLITE_CORRUPT"] as const;

export function isUnreadableSqliteError(err: unknown): boolean {
  const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "";
  return UNREADABLE_CODES.some((unreadable) => code.startsWith(unreadable));
}

export interface TenantBooksUser {
  readonly id: string;
  readonly email: string;
  readonly isCompanyAdmin: boolean;
  readonly status: string;
  readonly erased: boolean;
}

export interface TenantBooksIdentity {
  readonly boundTenantId: string | null;
  readonly claimed: boolean;
  readonly users: readonly TenantBooksUser[];
}

function hasTable(sqlite: Database.Database, name: string): boolean {
  return sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
}

function boundTenantIdOf(sqlite: Database.Database): string | null {
  if (!hasTable(sqlite, "tenant_binding")) return null;
  const row = sqlite.prepare(`SELECT tenant_id FROM tenant_binding WHERE id = ?`).get(BINDING_ROW_ID) as { tenant_id: string } | undefined;
  return row?.tenant_id ?? null;
}

function claimedIn(sqlite: Database.Database): boolean {
  if (!hasTable(sqlite, "tenant_settings")) return false;
  const row = sqlite.prepare(`SELECT data FROM tenant_settings WHERE id = ?`).get(SETTINGS_ROW_ID) as { data: string } | undefined;
  if (!row) return false;
  const claimedAt = (JSON.parse(row.data) as { tenantClaimedAt?: unknown }).tenantClaimedAt;
  return typeof claimedAt === "string" && claimedAt !== "";
}

interface UserRow {
  id: string;
  email: string;
  is_company_admin: number;
  status: string;
  erased_at: string | null;
}

function usersIn(sqlite: Database.Database): TenantBooksUser[] {
  if (!hasTable(sqlite, "user")) return [];
  const columns = new Set((sqlite.pragma("table_info(user)") as { name: string }[]).map((column) => column.name));
  const erasedAt = columns.has("erased_at") ? "erased_at" : "NULL AS erased_at";
  const rows = sqlite.prepare(`SELECT id, email, is_company_admin, status, ${erasedAt} FROM user`).all() as UserRow[];
  return rows.map((row) => ({ id: row.id, email: row.email, isCompanyAdmin: row.is_company_admin === 1, status: row.status, erased: row.erased_at !== null }));
}

// SECURITY: asked before the database is opened for use, so it must change
// nothing: no journal mode, no schema, no row. `query_only` holds the
// connection to that. It is NOT opened read-only: a read-only handle cannot
// take the exclusive lock WAL needs on a network filesystem, and it leaves a
// `-shm` beside the file.
export function readTenantBooksIdentity(file: string, options: Pick<SqliteOpenOptions, "driver" | "key" | "exclusive"> = {}): TenantBooksIdentity {
  let sqlite: Database.Database;
  try {
    sqlite = new (options.driver ?? Database)(file, { fileMustExist: true });
  } catch (err) {
    if (isUnreadableSqliteError(err)) throw new NotASqliteDatabaseError(file, err);
    throw err;
  }
  try {
    if (options.key !== undefined) applyKey(sqlite, options.key);
    if (options.exclusive === true) sqlite.pragma("locking_mode = EXCLUSIVE");
    sqlite.pragma("query_only = ON");
    return { boundTenantId: boundTenantIdOf(sqlite), claimed: claimedIn(sqlite), users: usersIn(sqlite) };
  } catch (err) {
    if (isUnreadableSqliteError(err) || err instanceof SyntaxError) throw new NotASqliteDatabaseError(file, err);
    throw err;
  } finally {
    sqlite.close();
  }
}

// SECURITY: written once and never moved. A database already bound to another
// tenant is refused before anything else is written to it.
export function bindTenantDatabase(sqlite: Database.Database, tenantId: string, now: () => Date = () => new Date()): void {
  const bound = boundTenantIdOf(sqlite);
  if (bound === tenantId) return;
  if (bound !== null) throw new TenantBindingMismatchError(tenantId, bound);
  sqlite.exec(CREATE_BINDING_TABLE);
  sqlite.prepare(`INSERT INTO tenant_binding (id, tenant_id, bound_at) VALUES (?, ?, ?)`).run(BINDING_ROW_ID, tenantId, now().toISOString());
}
