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
export const CURRENT_SCHEMA_VERSION = 3;

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

export class SchemaUpgradeFailedError extends Error {
  readonly messageEn: string;
  constructor(
    readonly fileVersion: number,
    readonly appSchemaVersion: number,
    override readonly cause: unknown,
  ) {
    super(
      "تعذّر تحديث قاعدة البيانات إلى هذا الإصدار من ميزان. بياناتك لم تُمَسّ: الملف كما كان قبل المحاولة، " +
        "ونسخة ما قبل التحديث محفوظة في مجلد النسخ الاحتياطية. أغلق البرنامج وأعد تثبيت الإصدار السابق، " +
        "أو أرسل سجل الأخطاء إلى الدعم. " +
        `(schema ${fileVersion} → ${appSchemaVersion})`,
    );
    this.name = "SchemaUpgradeFailedError";
    this.messageEn =
      "The database could not be upgraded to this version of Mezan. Your data is untouched: the file is exactly as it was, " +
      "and the pre-update backup is in the backups folder. Close the app and reinstall the previous version, or send the error log to support. " +
      `(schema ${fileVersion} → ${appSchemaVersion}; ${cause instanceof Error ? cause.message : String(cause)})`;
  }
}

const hooked = new WeakSet<Database.Database>();

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
 * REFUSES a database written by a newer schema, while it is still untouched.
 *
 * The failure it prevents is silent and total: an older build opening a file a
 * newer build wrote reads the columns it knows, ignores the ones it does not,
 * and writes rows the newer build will later find incomplete. The books look
 * fine the whole time.
 */
export function assertSchemaReadable(sqlite: Database.Database): void {
  const fileVersion = readSchemaVersion(sqlite);
  if (fileVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaTooNewError(fileVersion, CURRENT_SCHEMA_VERSION, readStoredAppVersion(sqlite));
  }
}

/**
 * Stamps this build's schema version into the file.
 *
 * REQUIRED ORDERING: it is the LAST write of an upgrade, inside the upgrade's
 * own transaction (packages/backend's `createBackend`), never something a mere
 * open does. A stamp written first survives a failed upgrade: the file then
 * claims a shape it does not have, the previous build refuses it as "too new",
 * and the desktop app sees no schema change left to take its pre-update backup
 * for. `PRAGMA user_version` is transactional, and survives a `VACUUM INTO`
 * snapshot, which is why the stamp travels into every backup archive for free.
 */
export function stampSchemaVersion(sqlite: Database.Database, appVersion?: string): void {
  assertSchemaReadable(sqlite);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const put = sqlite.prepare(
    `INSERT INTO schema_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  put.run("schema_version", String(CURRENT_SCHEMA_VERSION));
  put.run("app_version", appVersion ?? process.env["MEZAN_APP_VERSION"] ?? "unknown");
  put.run("stamped_at", new Date().toISOString());
  sqlite.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
}

export function holdsExistingBooks(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_meta'`)
    .get();
  return (row?.n ?? 0) > 0;
}

export interface AddableColumn {
  readonly table: string;
  readonly name: string;
  readonly type: string;
}

// The columns each `CREATE TABLE IF NOT EXISTS` in `ddl` declares, in the form
// an `ALTER TABLE … ADD COLUMN` can add to a table that already holds rows.
export function declaredAddableColumns(ddl: string): AddableColumn[] {
  const columns: AddableColumn[] = [];
  for (const match of ddl.matchAll(CREATE_TABLE_RE)) {
    const table = match[1] ?? "";
    for (const line of (match[2] ?? "").split("\n")) {
      const definition = line.trim().replace(/,$/, "");
      if (!definition || TABLE_CONSTRAINT_RE.test(definition)) continue;
      const column = COLUMN_RE.exec(definition);
      if (!column) continue;
      const name = column[1] ?? "";
      const rawType = column[2] ?? "";
      if (!name || /PRIMARY KEY|UNIQUE/i.test(rawType)) continue;
      columns.push({ table, name, type: /DEFAULT/i.test(rawType) ? rawType : rawType.replace(/\s*NOT NULL/i, "") });
    }
  }
  return columns;
}

function addMissingColumns(sqlite: Database.Database, ddl: string): void {
  const existingByTable = new Map<string, Set<string>>();
  for (const { table, name, type } of declaredAddableColumns(ddl)) {
    let existing = existingByTable.get(table);
    if (!existing) {
      existing = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
      existingByTable.set(table, existing);
    }
    if (existing.size === 0 || existing.has(name)) continue;
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    existing.add(name);
  }
}

/**
 * Wraps `exec` so every `CREATE TABLE IF NOT EXISTS` a store runs also brings
 * an existing table up to the declared shape. Idempotent per connection.
 *
 * REQUIRED ORDERING: the missing columns are added BEFORE the store's script
 * runs. A script that declares a column and indexes it in the same breath is
 * the normal way to write a store, and against an older file the index would
 * otherwise meet a table that does not have the column yet — "no such column",
 * at boot, on every launch (the 2026-09-20 bank_statement indexes).
 */
export function installSchemaSync(sqlite: Database.Database): void {
  assertSchemaReadable(sqlite);
  if (hooked.has(sqlite)) return;
  hooked.add(sqlite);
  const exec = sqlite.exec.bind(sqlite);
  sqlite.exec = (sql: string) => {
    if (/CREATE\s+TABLE/i.test(sql)) addMissingColumns(sqlite, sql);
    return exec(sql);
  };
}
