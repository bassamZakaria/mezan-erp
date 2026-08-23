import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { BarcodeConfig, BarcodeConfigRepository } from "@mezan/domain";

/**
 * SQLite-backed barcode-configuration store.
 *
 * Same "spike pattern" as settings-store.ts: exactly one row per tenant,
 * stored as a single JSON-text column keyed by a fixed row id, with a
 * self-contained connection. The domain never sees JSON; only this store
 * serializes/deserializes it.
 */

const ROW_ID = "default";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS barcode_config (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

class SqliteBarcodeConfigStore implements BarcodeConfigRepository {
  private readonly upsert: Database.Statement;
  private readonly select: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO barcode_config (id, data, updated_at) VALUES (@id, @data, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET data = @data, updated_at = @updatedAt`,
    );
    this.select = sqlite.prepare(`SELECT data FROM barcode_config WHERE id = ?`);
  }

  async get(): Promise<BarcodeConfig | null> {
    const row = this.select.get(ROW_ID) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as BarcodeConfig;
  }

  async save(config: BarcodeConfig): Promise<void> {
    this.upsert.run({
      id: ROW_ID,
      data: JSON.stringify(config),
      updatedAt: new Date().toISOString(),
    });
  }
}

export interface SqliteBarcodeConfigStoreHandle extends BarcodeConfigRepository {
  close(): void;
}

/** Open a SQLite-backed BarcodeConfigRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteBarcodeConfigStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteBarcodeConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteBarcodeConfigStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteBarcodeConfigStoreHandle;
}
