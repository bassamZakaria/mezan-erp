import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { UserPreferences, UserPreferencesRepository } from "@mezan/domain";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * SQL-backed {@link UserPreferencesRepository} — one row per user.
 *
 * Same "spike pattern" as settings-store.ts / barcode-config-store.ts: the bag
 * itself is a single JSON-text column, because it always changes as a whole
 * through the domain's merge. `layout_name` and `numerals` are lifted OUT of
 * the JSON into real columns so the admin diagnosis surface can list who has
 * which named layout without parsing every row. There is no tenant column
 * anywhere in this schema — one database is one tenant.
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

const COLUMNS = "user_id, layout_name, numerals, data, created_at, updated_at";

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

class SqlUserPreferencesStore implements UserPreferencesRepository {
  constructor(private readonly db: SqlDb) {}

  async get(userId: string): Promise<UserPreferences | null> {
    const row = await this.db.get<PreferencesRow>(`SELECT ${COLUMNS} FROM user_preferences WHERE user_id = ?`, [userId]);
    return row ? toPreferences(row) : null;
  }

  async save(preferences: UserPreferences): Promise<void> {
    await this.db.run(
      `INSERT INTO user_preferences (${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         layout_name = excluded.layout_name,
         numerals    = excluded.numerals,
         data        = excluded.data,
         updated_at  = excluded.updated_at`,
      [preferences.userId, preferences.layoutName, preferences.numerals, JSON.stringify(preferences), preferences.createdAt, preferences.updatedAt],
    );
  }

  async remove(userId: string): Promise<void> {
    await this.db.run(`DELETE FROM user_preferences WHERE user_id = ?`, [userId]);
  }

  async list(): Promise<readonly UserPreferences[]> {
    return (await this.db.all<PreferencesRow>(`SELECT ${COLUMNS} FROM user_preferences ORDER BY updated_at DESC`)).map(toPreferences);
  }
}

export interface SqliteUserPreferencesStoreHandle extends UserPreferencesRepository {
  close(): void;
}

export async function ensureUserPreferencesSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createUserPreferencesStore(db: SqlDb): UserPreferencesRepository {
  return new SqlUserPreferencesStore(db);
}

/** Open a SQLite-backed UserPreferencesRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteUserPreferencesStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteUserPreferencesStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createUserPreferencesStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteUserPreferencesStoreHandle;
}
