import { SqlDialect, type SqlDb } from "./sql-db.js";

const POSTGRES_INSERTION_ORDER_COLUMN = "insertion_seq";

// The column that orders a table's rows by when they were first inserted: SQLite's
// rowid, and on Postgres an identity column `ensureInsertionOrder` adds. An upsert
// that updates a row keeps its place on both.
export function insertionOrder(db: SqlDb): string {
  return db.dialect === SqlDialect.Postgres ? POSTGRES_INSERTION_ORDER_COLUMN : "rowid";
}

export async function ensureInsertionOrder(db: SqlDb, table: string): Promise<void> {
  if (db.dialect !== SqlDialect.Postgres) return;
  await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${POSTGRES_INSERTION_ORDER_COLUMN} BIGINT GENERATED ALWAYS AS IDENTITY`);
}

export function greatest(db: SqlDb, a: string, b: string): string {
  return db.dialect === SqlDialect.Postgres ? `GREATEST(${a}, ${b})` : `MAX(${a}, ${b})`;
}
