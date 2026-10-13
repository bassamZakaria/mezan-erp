import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { applyKey, type SqliteOpenOptions } from "./sqlite-connection.js";
import { SqliteFileBusyError } from "./sqlite-file-hold.js";
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
  readonly nameAr: string;
  readonly email: string;
  readonly isCompanyAdmin: boolean;
  readonly status: string;
  readonly erased: boolean;
}

export interface TenantBooksIdentity {
  readonly boundTenantId: string | null;
  readonly claimedAt: string | null;
  readonly companyName: string | null;
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

interface StoredSettings {
  readonly tenantClaimedAt?: unknown;
  readonly companyName?: unknown;
}

function settingsIn(sqlite: Database.Database): StoredSettings {
  if (!hasTable(sqlite, "tenant_settings")) return {};
  const row = sqlite.prepare(`SELECT data FROM tenant_settings WHERE id = ?`).get(SETTINGS_ROW_ID) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as StoredSettings) : {};
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

interface UserRow {
  id: string;
  name_ar: string;
  email: string;
  is_company_admin: number;
  status: string;
  erased_at: string | null;
}

function usersIn(sqlite: Database.Database): TenantBooksUser[] {
  if (!hasTable(sqlite, "user")) return [];
  const columns = new Set((sqlite.pragma("table_info(user)") as { name: string }[]).map((column) => column.name));
  const erasedAt = columns.has("erased_at") ? "erased_at" : "NULL AS erased_at";
  const rows = sqlite.prepare(`SELECT id, name_ar, email, is_company_admin, status, ${erasedAt} FROM user`).all() as UserRow[];
  return rows.map((row) => ({ id: row.id, nameAr: row.name_ar, email: row.email, isCompanyAdmin: row.is_company_admin === 1, status: row.status, erased: row.erased_at !== null }));
}

function identityOf(sqlite: Database.Database): TenantBooksIdentity {
  const settings = settingsIn(sqlite);
  return { boundTenantId: boundTenantIdOf(sqlite), claimedAt: textOrNull(settings.tenantClaimedAt), companyName: textOrNull(settings.companyName), users: usersIn(sqlite) };
}

const REPLAYED_SIBLINGS = ["-wal", "-journal"] as const;
const SIBLINGS = [...REPLAYED_SIBLINGS, "-shm"] as const;
const STAMPED = ["", ...REPLAYED_SIBLINGS] as const;

// CONTRACT: changes whenever the database, its log or its journal is written,
// replaced or removed. The index (`-shm`) is left out: reading moves it.
export function sqliteFileStamp(file: string): string {
  return STAMPED.map((suffix) => {
    const stat = statSync(`${file}${suffix}`, { throwIfNoEntry: false });
    return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : "-";
  }).join("|");
}

type BooksConnection = Pick<SqliteOpenOptions, "driver" | "key" | "exclusive">;

function identityIn(file: string, options: BooksConnection): TenantBooksIdentity {
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
    return identityOf(sqlite);
  } catch (err) {
    if (isUnreadableSqliteError(err) || err instanceof SyntaxError) throw new NotASqliteDatabaseError(file, err);
    throw err;
  } finally {
    sqlite.close();
  }
}

const SCRATCH_DIR_MODE = 0o700;
const SCRATCH_FILE_MODE = 0o600;
const SNAPSHOT_ATTEMPTS = 3;

// SECURITY: the scratch directory holds copies of customers' databases while
// they are read. It is the owner's alone, and whatever a killed process left
// in it is removed before anything else is started.
export function emptyBooksScratch(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: SCRATCH_DIR_MODE });
  chmodSync(dir, SCRATCH_DIR_MODE);
}

function isGone(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

async function copyPrivately(from: string, to: string): Promise<void> {
  await copyFile(from, to);
  await chmod(to, SCRATCH_FILE_MODE);
}

async function snapshotInto(scratch: string, file: string): Promise<string | null> {
  const before = sqliteFileStamp(file);
  const copy = path.join(scratch, "books.db");
  try {
    await copyPrivately(file, copy);
    for (const suffix of REPLAYED_SIBLINGS) if (existsSync(`${file}${suffix}`)) await copyPrivately(`${file}${suffix}`, `${copy}${suffix}`);
  } catch (err) {
    if (isGone(err)) return null;
    throw err;
  }
  return sqliteFileStamp(file) === before ? copy : null;
}

// SECURITY: asked before the database is judged, so it must leave the file,
// its log and its index byte for byte. A database with a log or a journal
// beside it is replayed by whoever opens it, and that rewrites it: such a
// database is read from a private copy in `scratchDir`. The copy is made off
// the event loop, so a writer in this process may write between the database
// and its log being copied; a copy whose source changed meanwhile is thrown
// away and made again, and after three tries the file is reported busy rather
// than judged from a torn pair. With nothing beside it the database is read in
// place, where `query_only` holds the connection to reading. It is NOT opened
// read-only: a read-only handle cannot take the exclusive lock WAL needs on a
// network filesystem, and it leaves a `-shm` beside the file.
export async function readTenantBooksIdentity(file: string, scratchDir: string, options: BooksConnection = {}): Promise<TenantBooksIdentity> {
  if (!SIBLINGS.some((suffix) => existsSync(`${file}${suffix}`))) return identityIn(file, options);
  mkdirSync(scratchDir, { recursive: true, mode: SCRATCH_DIR_MODE });
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
    const scratch = await mkdtemp(path.join(scratchDir, "identity-"));
    try {
      const copy = await snapshotInto(scratch, file);
      if (copy === null) continue;
      try {
        return identityIn(copy, options);
      } catch (err) {
        if (err instanceof NotASqliteDatabaseError) throw new NotASqliteDatabaseError(file, err.cause);
        throw err;
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  throw new SqliteFileBusyError(file);
}

// SECURITY: an open never moves a binding. A database already bound to another
// tenant is refused before anything else is written to it; only the platform
// console's audited unbinding takes a binding out.
export function bindTenantDatabase(sqlite: Database.Database, tenantId: string, now: () => Date = () => new Date()): void {
  const bound = boundTenantIdOf(sqlite);
  if (bound === tenantId) return;
  if (bound !== null) throw new TenantBindingMismatchError(tenantId, bound);
  sqlite.exec(CREATE_BINDING_TABLE);
  sqlite.prepare(`INSERT INTO tenant_binding (id, tenant_id, bound_at) VALUES (?, ?, ?)`).run(BINDING_ROW_ID, tenantId, now().toISOString());
}

const BINDING_WRITE_WAIT_MS = 2000;

function onBooks<T>(file: string, options: BooksConnection, write: (sqlite: Database.Database) => T): T {
  const sqlite = new (options.driver ?? Database)(file, { fileMustExist: true, timeout: BINDING_WRITE_WAIT_MS });
  try {
    if (options.key !== undefined) applyKey(sqlite, options.key);
    if (options.exclusive === true) sqlite.pragma("locking_mode = EXCLUSIVE");
    return write(sqlite);
  } finally {
    sqlite.close();
  }
}

export interface TenantBindingWrite extends BooksConnection {
  readonly now?: () => Date;
  // SECURITY: handed the books as they are inside the write that binds them.
  // Throwing leaves them unbound.
  readonly accept?: (books: TenantBooksIdentity) => void;
}

export function writeTenantBinding(file: string, tenantId: string, options: TenantBindingWrite = {}): void {
  onBooks(file, options, (sqlite) =>
    sqlite
      .transaction(() => {
        options.accept?.(identityOf(sqlite));
        bindTenantDatabase(sqlite, tenantId, options.now);
      })
      .immediate(),
  );
}

// SECURITY: takes out this tenant's binding and no other's. False when the
// database is not bound to this tenant; nothing is written then.
export function clearTenantBinding(file: string, tenantId: string, options: BooksConnection = {}): boolean {
  return onBooks(file, options, (sqlite) => {
    if (boundTenantIdOf(sqlite) !== tenantId) return false;
    return sqlite.prepare(`DELETE FROM tenant_binding WHERE id = ? AND tenant_id = ?`).run(BINDING_ROW_ID, tenantId).changes === 1;
  });
}
