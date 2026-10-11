import type Database from "better-sqlite3";
import { DuplicateRecordIdError } from "@mezan/domain";

const UPSERT_TAIL = /\s+ON\s+CONFLICT\s*\(\s*id\s*\)\s*DO\s+UPDATE\s+SET[\s\S]*$/i;
const PRIMARY_KEY_VIOLATION = "SQLITE_CONSTRAINT_PRIMARYKEY";

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

export function insertingNew<T>(recordId: string, write: () => T): T {
  try {
    return write();
  } catch (error) {
    if ((error as { code?: string }).code === PRIMARY_KEY_VIOLATION) throw new DuplicateRecordIdError(recordId);
    throw error;
  }
}
