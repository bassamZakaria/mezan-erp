import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SettingsRepository, TenantSettings } from "@mezan/domain";

/**
 * SQLite-backed SettingsRepository.
 *
 * The config bag is ~30 typed fields at the domain layer (see
 * packages/domain/src/settings/settings.ts), but there is exactly one row of
 * it per tenant and it changes as a whole via `updateSettings`'s merge — so
 * storage is a single JSON-text column keyed by a fixed row id, matching the
 * "spike pattern" of a self-contained store with its own connection (see
 * sequence-store.ts / audit-sink.ts). The domain never sees JSON; only this
 * store serializes/deserializes it.
 */

const ROW_ID = "default";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS tenant_settings (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

class SqliteSettingsStore implements SettingsRepository {
  private readonly upsert: Database.Statement;
  private readonly select: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO tenant_settings (id, data, updated_at) VALUES (@id, @data, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET data = @data, updated_at = @updatedAt`,
    );
    this.select = sqlite.prepare(`SELECT data FROM tenant_settings WHERE id = ?`);
  }

  async get(): Promise<TenantSettings | null> {
    const row = this.select.get(ROW_ID) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as TenantSettings;
  }

  async save(settings: TenantSettings): Promise<void> {
    this.upsert.run({
      id: ROW_ID,
      data: JSON.stringify(settings),
      updatedAt: new Date().toISOString(),
    });
  }
}

export interface SqliteSettingsStoreHandle extends SettingsRepository {
  close(): void;
}

/** Open a SQLite-backed SettingsRepository. ":memory:" for tests, a path for real. */
export function createSqliteSettingsStore(path: SqliteConnectionInput = ":memory:"): SqliteSettingsStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteSettingsStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSettingsStoreHandle;
}
