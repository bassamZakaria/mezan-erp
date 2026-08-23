import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { ApiKey, ApiKeyRepository } from "@mezan/domain";

/** SQLite-backed ApiKeyRepository — `key_hash` is a one-way hash, never the plaintext key. */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS api_key (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL,
  scopes        TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_key_created_at ON api_key(created_at);
`;

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    keyHash: row.key_hash,
    scopes: JSON.parse(row.scopes) as string[],
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

class SqliteApiKeyStore implements ApiKeyRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO api_key (id, name, prefix, key_hash, scopes, created_by, created_at, last_used_at, revoked_at)
       VALUES (@id, @name, @prefix, @keyHash, @scopes, @createdBy, @createdAt, @lastUsedAt, @revokedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, prefix = @prefix, key_hash = @keyHash, scopes = @scopes,
         created_by = @createdBy, created_at = @createdAt, last_used_at = @lastUsedAt, revoked_at = @revokedAt`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM api_key ORDER BY created_at DESC`);
    this.selectById = sqlite.prepare(`SELECT * FROM api_key WHERE id = ?`);
  }

  async list(): Promise<ApiKey[]> {
    return (this.selectAll.all() as ApiKeyRow[]).map(toApiKey);
  }

  async findById(id: string): Promise<ApiKey | null> {
    const row = this.selectById.get(id) as ApiKeyRow | undefined;
    return row ? toApiKey(row) : null;
  }

  async save(key: ApiKey): Promise<void> {
    this.upsert.run({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      keyHash: key.keyHash,
      scopes: JSON.stringify(key.scopes),
      createdBy: key.createdBy,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
    });
  }
}

export interface SqliteApiKeyStoreHandle extends ApiKeyRepository {
  close(): void;
}

/** Open a SQLite-backed ApiKeyRepository. ":memory:" for tests, a path for real. */
export function createSqliteApiKeyStore(path: SqliteConnectionInput = ":memory:"): SqliteApiKeyStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteApiKeyStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteApiKeyStoreHandle;
}
