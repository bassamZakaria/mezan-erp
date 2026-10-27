import type Database from "better-sqlite3";
import { DuplicateRecordIdError } from "@mezan/domain";
import { isPrimaryKeyViolation, type SqlDb } from "./sql/sql-db.js";

const UPSERT_TAIL = /\s+ON\s+CONFLICT\s*\(\s*id\s*\)\s*DO\s+UPDATE\s+SET[\s\S]*$/i;

/*
 * SECURITY INVARIANT: a create path must run the statement this returns, never
 * the upsert it is derived from. An upsert reached from a create route lets a
 * caller who names an existing id replace that record, whatever state or branch
 * it is in.
 */
export function prepareInsertOnly(sqlite: Database.Database, upsertSql: string): Database.Statement {
  if (!UPSERT_TAIL.test(upsertSql)) throw new Error("prepareInsertOnly expects an INSERT ... ON CONFLICT(id) DO UPDATE statement");
  return sqlite.prepare(upsertSql.replace(UPSERT_TAIL, ""));
}

// SECURITY INVARIANT, as for prepareInsertOnly: a create path runs this, never
// the upsert. It never raises on a taken id — pair it with refuseUnlessInserted.
export function insertOnlySql(upsertSql: string): string {
  if (!UPSERT_TAIL.test(upsertSql)) throw new Error("insertOnlySql expects an INSERT ... ON CONFLICT(id) DO UPDATE statement");
  return `${upsertSql.replace(UPSERT_TAIL, "")} ON CONFLICT (id) DO NOTHING`;
}

export async function insertNew(db: SqlDb, recordId: string, upsertSql: string, params: Parameters<SqlDb["run"]>[1]): Promise<void> {
  refuseUnlessInserted(recordId, (await db.run(insertOnlySql(upsertSql), params)).changes);
}

export function insertingNew<T>(recordId: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (isPrimaryKeyViolation(error)) throw new DuplicateRecordIdError(recordId);
    throw error;
  }
}

// For an `INSERT … ON CONFLICT (id) DO NOTHING`. A conflict must not raise on
// Postgres: one failed statement aborts the whole transaction there.
export function refuseUnlessInserted(recordId: string, changes: number): void {
  if (changes === 0) throw new DuplicateRecordIdError(recordId);
}

/*
 * For a store whose save replaces a record's rows over several statements: its
 * create path refuses a taken id before the first of them. ORDERING: call it
 * with no await between it and the write, so nothing can take the id in between.
 */
export function refusingTakenId(sqlite: Database.Database, table: string, recordId: string): void {
  if (sqlite.prepare(`SELECT 1 FROM "${table}" WHERE id = ?`).get(recordId) !== undefined) throw new DuplicateRecordIdError(recordId);
}

export async function refuseTakenIdAsync(db: SqlDb, table: string, recordId: string): Promise<void> {
  if ((await db.get(`SELECT 1 AS taken FROM "${table}" WHERE id = ?`, [recordId])) !== undefined) throw new DuplicateRecordIdError(recordId);
}
