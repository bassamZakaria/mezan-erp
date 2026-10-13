import type Database from "better-sqlite3";

export interface CredentialResetMarks {
  mark(userId: string, at: string, actor: string): void;
  has(userId: string): boolean;
  clear(userId: string): void;
}

// SECURITY: a mark means "the credential this account signs in with was set by
// somebody else". It is cleared only by the platform confirming who owns the
// tenant, never by the account itself: whoever holds a reset PIN can change it.
export function createSqliteCredentialResetMarks(sqlite: Database.Database): CredentialResetMarks {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS credential_reset_mark (user_id TEXT PRIMARY KEY, reset_at TEXT NOT NULL, actor TEXT NOT NULL)`);
  const write = sqlite.prepare(
    `INSERT INTO credential_reset_mark (user_id, reset_at, actor) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reset_at = excluded.reset_at, actor = excluded.actor`,
  );
  const read = sqlite.prepare(`SELECT 1 FROM credential_reset_mark WHERE user_id = ?`);
  const remove = sqlite.prepare(`DELETE FROM credential_reset_mark WHERE user_id = ?`);
  return {
    mark: (userId, at, actor) => {
      write.run(userId, at, actor);
    },
    has: (userId) => read.get(userId) !== undefined,
    clear: (userId) => {
      remove.run(userId);
    },
  };
}
