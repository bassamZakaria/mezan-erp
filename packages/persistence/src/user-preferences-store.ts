import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { UserPreferences, UserPreferencesRepository } from "@mezan/domain";

/**
 * SQLite-backed {@link UserPreferencesRepository} — one row per user.
 *
 * Same "spike pattern" as settings-store.ts / barcode-config-store.ts: the bag
 * itself is a single JSON-text column, because it always changes as a whole
 * through the domain's merge. `layout_name` and `numerals` are lifted OUT of
 * the JSON into real columns so the admin diagnosis surface can list who has
 * which named layout without parsing every row. There is no tenant column
 * anywhere in this schema — one database file is one tenant.
 *
 * Adding a column later needs no migration file: `installSchemaSync` ALTERs an
 * existing table to match this CREATE TABLE (see ./schema-sync.ts).
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id     TEXT PRIMARY KEY,
  layout_name TEXT NOT NULL,
  numerals    TEXT,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_preferences_updated ON user_preferences(updated_at);
`;

interface PreferencesRow {
  user_id: string;
  layout_name: string;
  numerals: string | null;
  data: string;
  created_at: string;
  updated_at: string;
}

function toPreferences(row: PreferencesRow): UserPreferences {
  const bag = JSON.parse(row.data) as UserPreferences;
  // The columns win over the JSON copy: they are what a query filtered on.
  return {
    ...bag,
    userId: row.user_id,
    layoutName: row.layout_name,
    numerals: (row.numerals as UserPreferences["numerals"]) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteUserPreferencesStore implements UserPreferencesRepository {
  private readonly upsert: Database.Statement;
  private readonly select: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly deleteOne: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO user_preferences (user_id, layout_name, numerals, data, created_at, updated_at)
       VALUES (@userId, @layoutName, @numerals, @data, @createdAt, @updatedAt)
       ON CONFLICT(user_id) DO UPDATE SET
         layout_name = @layoutName,
         numerals    = @numerals,
         data        = @data,
         updated_at  = @updatedAt`,
    );
    this.select = sqlite.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM user_preferences ORDER BY updated_at DESC`);
    this.deleteOne = sqlite.prepare(`DELETE FROM user_preferences WHERE user_id = ?`);
  }

  async get(userId: string): Promise<UserPreferences | null> {
    const row = this.select.get(userId) as PreferencesRow | undefined;
    return row ? toPreferences(row) : null;
  }

  async save(preferences: UserPreferences): Promise<void> {
    this.upsert.run({
      userId: preferences.userId,
      layoutName: preferences.layoutName,
      numerals: preferences.numerals,
      data: JSON.stringify(preferences),
      createdAt: preferences.createdAt,
      updatedAt: preferences.updatedAt,
    });
  }

  async remove(userId: string): Promise<void> {
    this.deleteOne.run(userId);
  }

  async list(): Promise<readonly UserPreferences[]> {
    return (this.selectAll.all() as PreferencesRow[]).map(toPreferences);
  }
}

export interface SqliteUserPreferencesStoreHandle extends UserPreferencesRepository {
  close(): void;
}

/** Open a SQLite-backed UserPreferencesRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteUserPreferencesStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteUserPreferencesStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteUserPreferencesStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteUserPreferencesStoreHandle;
}
