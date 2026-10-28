import { randomBytes } from "node:crypto";
import { WEBAUTHN_CHALLENGE_TTL_MS, type PendingWebauthnChallenge, type WebauthnChallengeRepository } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * SQL-backed `WebauthnChallengeRepository` (D289's cloud twin) — the fix
 * for a challenge issued by one cloud server instance and answered to
 * another: both read and write the SAME row in the tenant's own database
 * instead of an in-process `Map` only one instance can see.
 *
 * One row per user (`PRIMARY KEY(user_id)`), matching the ceremony's own
 * shape — at most one outstanding challenge per user. `newChallenge` is
 * generated here with `node:crypto` directly rather than importing the api
 * layer's `newChallenge` helper: persistence must not depend on api.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS webauthn_challenge (
  user_id     TEXT PRIMARY KEY,
  challenge   TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  rp_id       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenge_expires ON webauthn_challenge(expires_at);
`;

interface ChallengeRow {
  user_id: string;
  challenge: string;
  purpose: string;
  rp_id: string;
  expires_at: bigint;
}

function toPending(row: ChallengeRow): PendingWebauthnChallenge {
  return { challenge: row.challenge, purpose: row.purpose, rpId: row.rp_id, expiresAt: Number(row.expires_at) };
}

class SqlWebauthnChallengeRepository implements WebauthnChallengeRepository {
  constructor(private readonly db: SqlDb) {}

  async issue(userId: string, purpose: string, rpId: string, now = Date.now()): Promise<string> {
    await this.db.run(`DELETE FROM webauthn_challenge WHERE expires_at <= ?`, [now]);
    const challenge = randomChallenge();
    await this.db.run(
      `INSERT INTO webauthn_challenge (user_id, challenge, purpose, rp_id, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         challenge = excluded.challenge,
         purpose = excluded.purpose,
         rp_id = excluded.rp_id,
         expires_at = excluded.expires_at`,
      [userId, challenge, purpose, rpId, now + WEBAUTHN_CHALLENGE_TTL_MS],
    );
    return challenge;
  }

  // Single-use by construction: the row is deleted here on every call, match
  // or not — see the port's own doc comment for why that matters. ONE
  // statement takes and deletes it, so two concurrent answers cannot both read it.
  async consume(userId: string, purpose: string, now = Date.now()): Promise<PendingWebauthnChallenge | null> {
    const row = await this.db.get<ChallengeRow>(
      `DELETE FROM webauthn_challenge WHERE user_id = ? RETURNING user_id, challenge, purpose, rp_id, expires_at`,
      [userId],
    );
    if (!row) return null;
    const pending = toPending(row);
    if (pending.purpose !== purpose || pending.expiresAt <= now) return null;
    return pending;
  }

  async deleteByUserId(userId: string): Promise<number> {
    return (await this.db.run(`DELETE FROM webauthn_challenge WHERE user_id = ?`, [userId])).changes;
  }
}

function randomChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export type SqliteWebauthnChallengeRepositoryHandle = WebauthnChallengeRepository & { close(): void };

export async function ensureWebauthnChallengeSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createWebauthnChallengeRepository(db: SqlDb): WebauthnChallengeRepository {
  return new SqlWebauthnChallengeRepository(db);
}

export function createSqliteWebauthnChallengeRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteWebauthnChallengeRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createWebauthnChallengeRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteWebauthnChallengeRepositoryHandle;
}
