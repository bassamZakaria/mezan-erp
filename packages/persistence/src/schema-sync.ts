import type Database from "better-sqlite3";

/**
 * Adds columns a store's CREATE TABLE declares but an older database file is
 * missing, so a database written by a previous build keeps opening instead of
 * failing at `prepare()` with "table X has no column named Y".
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op once the table exists, so a column
 * added to a store's schema never reached an existing file: every store had to
 * remember its own ALTER, and the ones that forgot (item, warehouse, ledger…)
 * crashed the whole backend at boot. Hooking `exec` puts the migration where
 * the declaration already is — the store's own CREATE TABLE stays the single
 * source of truth for its shape.
 *
 * Only additive, non-destructive migration: it never drops, renames, retypes,
 * or backfills a column. A NOT NULL column without a DEFAULT is added nullable
 * because SQLite cannot do otherwise on a table that may hold rows; inserts
 * still go through the store's full column list.
 */

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:WITHOUT\s+ROWID\s*)?;/gi;
const COLUMN_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/;
const TABLE_CONSTRAINT_RE = /^(?:PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;

/**
 * The on-disk shape this build writes and understands.
 *
 * BUMP IT whenever a change makes a database unreadable by the previous build —
 * a column an older build's INSERT would violate, a table it would not create,
 * a meaning that changed under a name that did not. Additive columns alone do
 * not need a bump; the hook above brings an older file up to shape on open.
 *
 * It is stamped into `PRAGMA user_version` and into `schema_meta`, and it is
 * what stops the failure this constant exists for: an older build opening a
 * database a newer one wrote, silently, and writing into it.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** Thrown when the FILE is newer than this build. Message is Arabic-first, on purpose. */
export class SchemaTooNewError extends Error {
  constructor(
    readonly fileVersion: number,
    readonly appSchemaVersion: number,
    readonly writtenByAppVersion: string | null,
  ) {
    super(
      "قاعدة البيانات هذه كُتبت بإصدار أحدث من مزان" +
        (writtenByAppVersion ? ` (${writtenByAppVersion})` : "") +
        ". افتحها بالإصدار الأحدث، أو استعد نسخة احتياطية أُخذت بهذا الإصدار. " +
        "لم يُفتح الملف ولم يتغيّر شيء فيه. " +
        `(schema ${fileVersion} > ${appSchemaVersion})`,
    );
    this.name = "SchemaTooNewError";
  }
}

const hooked = new WeakSet<Database.Database>();
const stamped = new WeakSet<Database.Database>();

function readStoredAppVersion(sqlite: Database.Database): string | null {
  try {
    const row = sqlite
      .prepare<[], { value: string }>(`SELECT value FROM schema_meta WHERE key = 'app_version'`)
      .get();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The schema version the FILE was last written with, before this build touches
 * it. Zero on a database that predates the stamp or has just been created.
 */
export function readSchemaVersion(sqlite: Database.Database): number {
  const rows = sqlite.pragma("user_version") as Array<{ user_version?: number }>;
  const value = Array.isArray(rows) ? rows[0]?.user_version : undefined;
  return typeof value === "number" ? value : 0;
}

/**
 * REFUSES a database written by a newer schema, and otherwise stamps this one.
 *
 * The failure it prevents is silent and total: an older build opening a file a
 * newer build wrote reads the columns it knows, ignores the ones it does not,
 * and writes rows the newer build will later find incomplete. The books look
 * fine the whole time. `PRAGMA user_version` is the one place SQLite keeps an
 * application integer that survives a `VACUUM INTO` snapshot, which is why the
 * stamp travels into every backup archive for free.
 *
 * Idempotent per connection, and a no-op on a read-only handle (the stamp is
 * best-effort; the REFUSAL is not).
 */
export function stampSchemaVersion(sqlite: Database.Database, appVersion?: string): void {
  const fileVersion = readSchemaVersion(sqlite);
  if (fileVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(fileVersion, CURRENT_SCHEMA_VERSION, readStoredAppVersion(sqlite));
  }
  if (stamped.has(sqlite)) return;
  stamped.add(sqlite);
  try {
    sqlite.exec(
      `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    );
    const put = sqlite.prepare(
      `INSERT INTO schema_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    put.run("schema_version", String(CURRENT_SCHEMA_VERSION));
    put.run("app_version", appVersion ?? process.env["MEZAN_APP_VERSION"] ?? "unknown");
    put.run("stamped_at", new Date().toISOString());
    sqlite.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  } catch {
    // A read-only connection cannot stamp, and must still be allowed to read.
  }
}

function addMissingColumns(sqlite: Database.Database, table: string, body: string): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name),
  );
  if (existing.size === 0) return;
  for (const line of body.split("\n")) {
    const definition = line.trim().replace(/,$/, "");
    if (!definition || TABLE_CONSTRAINT_RE.test(definition)) continue;
    const match = COLUMN_RE.exec(definition);
    if (!match) continue;
    const name = match[1] ?? "";
    const rawType = match[2] ?? "";
    if (!name || existing.has(name) || /PRIMARY KEY|UNIQUE/i.test(rawType)) continue;
    const type = /DEFAULT/i.test(rawType) ? rawType : rawType.replace(/\s*NOT NULL/i, "");
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/**
 * Wraps `exec` so every `CREATE TABLE IF NOT EXISTS` a store runs also brings
 * an existing table up to the declared shape. Idempotent per connection.
 */
export function installSchemaSync(sqlite: Database.Database): void {
  // BEFORE the hook, and before any store's CREATE TABLE runs: a file written
  // by a newer build must be refused while it is still untouched.
  stampSchemaVersion(sqlite);
  if (hooked.has(sqlite)) return;
  hooked.add(sqlite);
  const exec = sqlite.exec.bind(sqlite);
  sqlite.exec = (sql: string) => {
    const result = exec(sql);
    if (!/CREATE\s+TABLE/i.test(sql)) return result;
    for (const match of sql.matchAll(CREATE_TABLE_RE)) {
      addMissingColumns(sqlite, match[1] ?? "", match[2] ?? "");
    }
    return result;
  };
}
