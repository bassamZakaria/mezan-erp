import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SequenceConfigStore, SequenceOverride } from "@mezan/domain";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS sequence_config (
  code         TEXT PRIMARY KEY,
  prefix       TEXT,
  pad_length   INTEGER,
  annual_reset INTEGER,
  branch_scoped INTEGER
);
`;

function addMissingColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(sequence_config)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "branch_scoped")) {
    sqlite.exec(`ALTER TABLE sequence_config ADD COLUMN branch_scoped INTEGER`);
  }
}

interface ConfigRow {
  code: string;
  prefix: string | null;
  pad_length: bigint | null;
  annual_reset: bigint | null;
  branch_scoped: bigint | null;
}

const COLUMNS = "code, prefix, pad_length, annual_reset, branch_scoped";

function rowToOverride(row: ConfigRow): SequenceOverride {
  const override: { -readonly [K in keyof SequenceOverride]?: SequenceOverride[K] } = {};
  if (row.prefix !== null) override.prefix = row.prefix;
  if (row.pad_length !== null) override.padLength = Number(row.pad_length);
  if (row.annual_reset !== null) override.annualReset = Number(row.annual_reset) === 1;
  if (row.branch_scoped !== null) override.branchScoped = Number(row.branch_scoped) === 1;
  return override;
}

function flag(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

class SqlSequenceConfigStore implements SequenceConfigStore {
  constructor(private readonly db: SqlDb) {}

  async getOverride(code: string): Promise<SequenceOverride | null> {
    const row = await this.db.get<ConfigRow>(`SELECT ${COLUMNS} FROM sequence_config WHERE code = ?`, [code]);
    return row ? rowToOverride(row) : null;
  }

  async getAllOverrides(): Promise<ReadonlyMap<string, SequenceOverride>> {
    const rows = await this.db.all<ConfigRow>(`SELECT ${COLUMNS} FROM sequence_config`);
    return new Map(rows.map((r) => [r.code, rowToOverride(r)]));
  }

  async upsertOverride(code: string, patch: SequenceOverride): Promise<void> {
    await this.db.run(
      `INSERT INTO sequence_config (code, prefix, pad_length, annual_reset, branch_scoped)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET
         prefix = COALESCE(excluded.prefix, sequence_config.prefix),
         pad_length = COALESCE(excluded.pad_length, sequence_config.pad_length),
         annual_reset = COALESCE(excluded.annual_reset, sequence_config.annual_reset),
         branch_scoped = COALESCE(excluded.branch_scoped, sequence_config.branch_scoped)`,
      [code, patch.prefix ?? null, patch.padLength ?? null, flag(patch.annualReset), flag(patch.branchScoped)],
    );
  }
}

export interface SequenceConfigStoreHandle extends SequenceConfigStore {
  getAllOverrides(): Promise<ReadonlyMap<string, SequenceOverride>>;
  upsertOverride(code: string, patch: SequenceOverride): Promise<void>;
}

export interface SqliteSequenceConfigStoreHandle extends SequenceConfigStoreHandle {
  close(): void;
}

export async function ensureSequenceConfigSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createSequenceConfigStore(db: SqlDb): SequenceConfigStoreHandle {
  return new SqlSequenceConfigStore(db);
}

export function createSqliteSequenceConfigStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteSequenceConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  return Object.assign(createSequenceConfigStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteSequenceConfigStoreHandle;
}
