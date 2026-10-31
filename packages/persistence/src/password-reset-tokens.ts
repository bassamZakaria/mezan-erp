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
  /** Earlier live tokens stay valid until one is redeemed, so a stranger re-requesting cannot void the link already mailed. */
  issue(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
  /** Single use: the token is deleted whether or not it had expired; a successful redeem voids every other token of the user. */
  redeem(tokenHash: string, at: number): Promise<string | null>;
  forgetUser(userId: string): Promise<void>;
  /** When the user's newest live token expires, or null when none is live. */
  latestExpiry(userId: string, at: number): Promise<number | null>;
}

export async function ensurePasswordResetTokensSchema(db: SqlDb): Promise<void> {
  await db.applySchema(PASSWORD_RESET_TOKEN_DDL);
}

// SECURITY: only the SHA-256 of a token is stored; a dump of this table opens no account.
export function createPasswordResetTokens(db: SqlDb): PasswordResetTokens {
  return {
    issue: async (userId, tokenHash, expiresAt) => {
      await db.transaction(async () => {
        await db.run(`DELETE FROM password_reset_token WHERE expires_at < ?`, [Date.now()]);
        await db.run(`INSERT INTO password_reset_token (token_hash, user_id, expires_at) VALUES (?, ?, ?)`, [tokenHash, userId, expiresAt]);
      });
    },
    redeem: async (tokenHash, at) =>
      db.transaction(async () => {
        const row = await db.get<{ user_id: string; expires_at: bigint | number }>(`SELECT user_id, expires_at FROM password_reset_token WHERE token_hash = ?`, [tokenHash]);
        if (!row) return null;
        if (Number(row.expires_at) < at) {
          await db.run(`DELETE FROM password_reset_token WHERE token_hash = ?`, [tokenHash]);
          return null;
        }
        await db.run(`DELETE FROM password_reset_token WHERE user_id = ?`, [row.user_id]);
        return row.user_id;
      }),
    forgetUser: async (userId) => {
      await db.run(`DELETE FROM password_reset_token WHERE user_id = ?`, [userId]);
    },
    latestExpiry: async (userId, at) => {
      const row = await db.get<{ latest: bigint | number | null }>(`SELECT MAX(expires_at) AS latest FROM password_reset_token WHERE user_id = ? AND expires_at >= ?`, [userId, at]);
      return row?.latest === null || row?.latest === undefined ? null : Number(row.latest);
    },
  };
}

export function createSqlitePasswordResetTokens(sqlite: Database.Database): PasswordResetTokens {
  sqlite.exec(PASSWORD_RESET_TOKEN_DDL);
  return createPasswordResetTokens(sqliteDb(sqlite));
}
