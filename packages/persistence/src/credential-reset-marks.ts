import type Database from "better-sqlite3";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREDENTIAL_RESET_MARK_DDL = `CREATE TABLE IF NOT EXISTS credential_reset_mark (user_id TEXT PRIMARY KEY, reset_at TEXT NOT NULL, actor TEXT NOT NULL)`;

export interface CredentialResetMarks {
  mark(userId: string, at: string, actor: string): Promise<void>;
  has(userId: string): Promise<boolean>;
  clear(userId: string): Promise<void>;
}

export async function ensureCredentialResetMarksSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREDENTIAL_RESET_MARK_DDL);
}

// SECURITY: a mark means "the credential this account signs in with was set by
// somebody else". It is cleared only by the platform confirming who owns the
// tenant, never by the account itself: whoever holds a reset PIN can change it.
export function createCredentialResetMarks(db: SqlDb): CredentialResetMarks {
  return {
    mark: async (userId, at, actor) => {
      await db.run(
        `INSERT INTO credential_reset_mark (user_id, reset_at, actor) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reset_at = excluded.reset_at, actor = excluded.actor`,
        [userId, at, actor],
      );
    },
    has: async (userId) => (await db.get(`SELECT 1 AS marked FROM credential_reset_mark WHERE user_id = ?`, [userId])) !== undefined,
    clear: async (userId) => {
      await db.run(`DELETE FROM credential_reset_mark WHERE user_id = ?`, [userId]);
    },
  };
}

export function createSqliteCredentialResetMarks(sqlite: Database.Database): CredentialResetMarks {
  sqlite.exec(CREDENTIAL_RESET_MARK_DDL);
  return createCredentialResetMarks(sqliteDb(sqlite));
}
