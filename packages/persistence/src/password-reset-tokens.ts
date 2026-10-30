import type Database from "better-sqlite3";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const PASSWORD_RESET_TOKEN_DDL = `
CREATE TABLE IF NOT EXISTS password_reset_token (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_user ON password_reset_token(user_id);`;

export interface PasswordResetTokens {
  /** Replaces every earlier token of the user, so only the newest emailed link works. */
  issue(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
  /** Single use: the token is deleted whether or not it had expired. */
  redeem(tokenHash: string, at: number): Promise<string | null>;
  forgetUser(userId: string): Promise<void>;
}

export async function ensurePasswordResetTokensSchema(db: SqlDb): Promise<void> {
  await db.applySchema(PASSWORD_RESET_TOKEN_DDL);
}

// SECURITY: only the SHA-256 of a token is stored; a dump of this table opens no account.
export function createPasswordResetTokens(db: SqlDb): PasswordResetTokens {
  return {
    issue: async (userId, tokenHash, expiresAt) => {
      await db.transaction(async () => {
        await db.run(`DELETE FROM password_reset_token WHERE user_id = ? OR expires_at < ?`, [userId, Date.now()]);
        await db.run(`INSERT INTO password_reset_token (token_hash, user_id, expires_at) VALUES (?, ?, ?)`, [tokenHash, userId, expiresAt]);
      });
    },
    redeem: async (tokenHash, at) =>
      db.transaction(async () => {
        const row = await db.get<{ user_id: string; expires_at: bigint | number }>(`SELECT user_id, expires_at FROM password_reset_token WHERE token_hash = ?`, [tokenHash]);
        if (!row) return null;
        await db.run(`DELETE FROM password_reset_token WHERE token_hash = ?`, [tokenHash]);
        return Number(row.expires_at) >= at ? row.user_id : null;
      }),
    forgetUser: async (userId) => {
      await db.run(`DELETE FROM password_reset_token WHERE user_id = ?`, [userId]);
    },
  };
}

export function createSqlitePasswordResetTokens(sqlite: Database.Database): PasswordResetTokens {
  sqlite.exec(PASSWORD_RESET_TOKEN_DDL);
  return createPasswordResetTokens(sqliteDb(sqlite));
}
