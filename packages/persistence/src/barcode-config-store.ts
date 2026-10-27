import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import type { BarcodeConfig, BarcodeConfigRepository } from "@mezan/domain";

/**
 * Barcode-configuration store.
 *
 * Same "spike pattern" as settings-store.ts: exactly one row per tenant,
 * stored as a single JSON-text column keyed by a fixed row id. The domain
 * never sees JSON; only this store serializes/deserializes it.
 */

const ROW_ID = "default";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS barcode_config (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

class SqlBarcodeConfigStore implements BarcodeConfigRepository {
  constructor(private readonly db: SqlDb) {}

  async get(): Promise<BarcodeConfig | null> {
    const row = await this.db.get<{ data: string }>(`SELECT data FROM barcode_config WHERE id = ?`, [ROW_ID]);
    if (!row) return null;
    return JSON.parse(row.data) as BarcodeConfig;
  }

  async save(config: BarcodeConfig): Promise<void> {
    await this.db.run(
      `INSERT INTO barcode_config (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [ROW_ID, JSON.stringify(config), new Date().toISOString()],
    );
  }
}

export interface SqliteBarcodeConfigStoreHandle extends BarcodeConfigRepository {
  close(): void;
}

export async function ensureBarcodeConfigSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createBarcodeConfigStore(db: SqlDb): BarcodeConfigRepository {
  return new SqlBarcodeConfigStore(db);
}

/** Open a SQLite-backed BarcodeConfigRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteBarcodeConfigStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteBarcodeConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createBarcodeConfigStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteBarcodeConfigStoreHandle;
}
