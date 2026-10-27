import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { PrintTemplateConfigRepository, PrintTemplateConfig } from "@mezan/domain";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * SQL-backed PrintTemplateConfigRepository.
 *
 * There is exactly one Print Template Config per tenant, and it changes as a
 * whole via `save` — so storage is a single JSON-text column keyed by a fixed
 * row id, matching settings-store.ts's pattern for the same kind of
 * one-row-per-tenant config bag.
 */

const ROW_ID = "default";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS print_template_config (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

class SqlPrintTemplateConfigStore implements PrintTemplateConfigRepository {
  constructor(private readonly db: SqlDb) {}

  async get(): Promise<PrintTemplateConfig | null> {
    const row = await this.db.get<{ data: string }>(`SELECT data FROM print_template_config WHERE id = ?`, [ROW_ID]);
    if (!row) return null;
    return JSON.parse(row.data) as PrintTemplateConfig;
  }

  async save(config: PrintTemplateConfig): Promise<void> {
    const updatedAt = new Date().toISOString();
    const data = JSON.stringify(config);
    await this.db.run(
      `INSERT INTO print_template_config (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [ROW_ID, data, updatedAt],
    );
  }
}

export interface SqlitePrintTemplateConfigStoreHandle extends PrintTemplateConfigRepository {
  close(): void;
}

export async function ensurePrintTemplateConfigSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createPrintTemplateConfigStore(db: SqlDb): PrintTemplateConfigRepository {
  return new SqlPrintTemplateConfigStore(db);
}

/** Open a SQLite-backed PrintTemplateConfigRepository. ":memory:" for tests, a path for real. */
export function createSqlitePrintTemplateConfigStore(
  path: SqliteConnectionInput = ":memory:",
): SqlitePrintTemplateConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createPrintTemplateConfigStore(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqlitePrintTemplateConfigStoreHandle;
}
