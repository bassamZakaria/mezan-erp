import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { PrintTemplateConfigRepository, PrintTemplateConfig } from "@mezan/domain";

/**
 * SQLite-backed PrintTemplateConfigRepository.
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

class SqlitePrintTemplateConfigStore implements PrintTemplateConfigRepository {
  private readonly upsert: Database.Statement;
  private readonly select: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO print_template_config (id, data, updated_at) VALUES (@id, @data, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET data = @data, updated_at = @updatedAt`,
    );
    this.select = sqlite.prepare(`SELECT data FROM print_template_config WHERE id = ?`);
  }

  async get(): Promise<PrintTemplateConfig | null> {
    const row = this.select.get(ROW_ID) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as PrintTemplateConfig;
  }

  async save(config: PrintTemplateConfig): Promise<void> {
    this.upsert.run({
      id: ROW_ID,
      data: JSON.stringify(config),
      updatedAt: new Date().toISOString(),
    });
  }
}

export interface SqlitePrintTemplateConfigStoreHandle extends PrintTemplateConfigRepository {
  close(): void;
}

/** Open a SQLite-backed PrintTemplateConfigRepository. ":memory:" for tests, a path for real. */
export function createSqlitePrintTemplateConfigStore(
  path: SqliteConnectionInput = ":memory:",
): SqlitePrintTemplateConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqlitePrintTemplateConfigStore(sqlite);
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqlitePrintTemplateConfigStoreHandle;
}
