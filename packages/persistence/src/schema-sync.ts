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

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi;
const COLUMN_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/;
const TABLE_CONSTRAINT_RE = /^(?:PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;

const hooked = new WeakSet<Database.Database>();

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
