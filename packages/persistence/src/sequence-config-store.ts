import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SequenceConfigStore, SequenceOverride } from "@mezan/domain";

/**
 * SQLite-backed store for admin overrides of a sequence's prefix / pad length
 * / annual-reset flag (`/settings/sequences`). A row exists only for sequences
 * an admin has actually customized — everything else keeps reading its
 * compiled-in default from `SEQUENCE_DEFINITIONS`. Deliberately does NOT store
 * the counter value: that stays in `sequence_counter`, guarded separately.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS sequence_config (
  code         TEXT PRIMARY KEY,
  prefix       TEXT,
  pad_length   INTEGER,
  annual_reset INTEGER,
  branch_scoped INTEGER
);
`;

/**
 * `branch_scoped` arrived after the table shipped; CREATE TABLE IF NOT EXISTS
 * will not widen an existing database, so add it in place.
 */
function addMissingColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare(`PRAGMA table_info(sequence_config)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "branch_scoped")) {
    sqlite.exec(`ALTER TABLE sequence_config ADD COLUMN branch_scoped INTEGER`);
  }
}

interface ConfigRow {
  code: string;
  prefix: string | null;
  pad_length: number | null;
  annual_reset: number | null;
  branch_scoped: number | null;
}

function rowToOverride(row: ConfigRow): SequenceOverride {
  const override: { -readonly [K in keyof SequenceOverride]?: SequenceOverride[K] } = {};
  if (row.prefix !== null) override.prefix = row.prefix;
  if (row.pad_length !== null) override.padLength = row.pad_length;
  if (row.annual_reset !== null) override.annualReset = row.annual_reset === 1;
  if (row.branch_scoped !== null) override.branchScoped = row.branch_scoped === 1;
  return override;
}

class SqliteSequenceConfigStore implements SequenceConfigStore {
  private readonly selectOne: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly upsert: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.selectOne = sqlite.prepare(
      `SELECT code, prefix, pad_length, annual_reset, branch_scoped FROM sequence_config WHERE code = ?`,
    );
    this.selectAll = sqlite.prepare(`SELECT code, prefix, pad_length, annual_reset, branch_scoped FROM sequence_config`);
    this.upsert = sqlite.prepare(`
      INSERT INTO sequence_config (code, prefix, pad_length, annual_reset, branch_scoped)
      VALUES (@code, @prefix, @padLength, @annualReset, @branchScoped)
      ON CONFLICT(code) DO UPDATE SET
        prefix = COALESCE(@prefix, prefix),
        pad_length = COALESCE(@padLength, pad_length),
        annual_reset = COALESCE(@annualReset, annual_reset),
        branch_scoped = COALESCE(@branchScoped, branch_scoped)
    `);
  }

  async getOverride(code: string): Promise<SequenceOverride | null> {
    const row = this.selectOne.get(code) as ConfigRow | undefined;
    return row ? rowToOverride(row) : null;
  }

  async getAllOverrides(): Promise<ReadonlyMap<string, SequenceOverride>> {
    const rows = this.selectAll.all() as ConfigRow[];
    return new Map(rows.map((r) => [r.code, rowToOverride(r)]));
  }

  async upsertOverride(code: string, patch: SequenceOverride): Promise<void> {
    this.upsert.run({
      code,
      prefix: patch.prefix ?? null,
      padLength: patch.padLength ?? null,
      annualReset: patch.annualReset === undefined ? null : patch.annualReset ? 1 : 0,
      branchScoped: patch.branchScoped === undefined ? null : patch.branchScoped ? 1 : 0,
    });
  }
}

export interface SqliteSequenceConfigStoreHandle extends SequenceConfigStore {
  close(): void;
  getAllOverrides(): Promise<ReadonlyMap<string, SequenceOverride>>;
  upsertOverride(code: string, patch: SequenceOverride): Promise<void>;
}

/** Open a SQLite-backed SequenceConfigStore. ":memory:" for tests, a path for real. */
export function createSqliteSequenceConfigStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteSequenceConfigStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  const store = new SqliteSequenceConfigStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteSequenceConfigStoreHandle;
}
