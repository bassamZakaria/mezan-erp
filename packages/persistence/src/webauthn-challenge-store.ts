import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { WEBAUTHN_CHALLENGE_TTL_MS, type PendingWebauthnChallenge, type WebauthnChallengeRepository } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

/**
 * SQLite-backed `WebauthnChallengeRepository` (D289's cloud twin) — the fix
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
  expires_at: number;
}

function toPending(row: ChallengeRow): PendingWebauthnChallenge {
  return { challenge: row.challenge, purpose: row.purpose, rpId: row.rp_id, expiresAt: row.expires_at };
}

class SqliteWebauthnChallengeRepository implements WebauthnChallengeRepository {
  private readonly deleteExpired: Database.Statement;
  private readonly upsert: Database.Statement;
  private readonly selectByUser: Database.Statement;
  private readonly deleteByUser: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.deleteExpired = sqlite.prepare(`DELETE FROM webauthn_challenge WHERE expires_at <= ?`);
    this.upsert = sqlite.prepare(`
      INSERT INTO webauthn_challenge (user_id, challenge, purpose, rp_id, expires_at)
      VALUES (@user_id, @challenge, @purpose, @rp_id, @expires_at)
      ON CONFLICT(user_id) DO UPDATE SET
        challenge = excluded.challenge,
        purpose = excluded.purpose,
        rp_id = excluded.rp_id,
        expires_at = excluded.expires_at
    `);
    this.selectByUser = sqlite.prepare(`SELECT * FROM webauthn_challenge WHERE user_id = ?`);
    this.deleteByUser = sqlite.prepare(`DELETE FROM webauthn_challenge WHERE user_id = ?`);
  }

  async issue(userId: string, purpose: string, rpId: string, now = Date.now()): Promise<string> {
    this.deleteExpired.run(now);
    const challenge = randomChallenge();
    this.upsert.run({ user_id: userId, challenge, purpose, rp_id: rpId, expires_at: now + WEBAUTHN_CHALLENGE_TTL_MS });
    return challenge;
  }

  // Single-use by construction: the row is deleted here on every call, match
  // or not — see the port's own doc comment for why that matters.
  async consume(userId: string, purpose: string, now = Date.now()): Promise<PendingWebauthnChallenge | null> {
    const row = this.selectByUser.get(userId) as ChallengeRow | undefined;
    this.deleteByUser.run(userId);
    if (!row) return null;
    const pending = toPending(row);
    if (pending.purpose !== purpose || pending.expiresAt <= now) return null;
    return pending;
  }
  async deleteByUserId(userId: string): Promise<number> {
    return this.deleteByUser.run(userId).changes;
  }
}

function randomChallenge(): string {
  return randomBytes(32).toString("base64url");
}

export type SqliteWebauthnChallengeRepositoryHandle = WebauthnChallengeRepository & { close(): void };

export function createSqliteWebauthnChallengeRepository(
  path: SqliteConnectionInput = ":memory:",
): SqliteWebauthnChallengeRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteWebauthnChallengeRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteWebauthnChallengeRepositoryHandle;
}
