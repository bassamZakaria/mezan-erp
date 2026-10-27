import type Database from "better-sqlite3";
import {
  DEFAULT_ACCOUNT_ROUTING_OPTIONS,
  type AccountRouting,
  type AccountRoutingOptions,
  type AccountRoutingRepository,
} from "@mezan/domain";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS account_routing (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  overrides TEXT NOT NULL,
  options   TEXT NOT NULL
);
`;

interface Row {
  overrides: string;
  options: string;
}

export async function ensureAccountRoutingSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createAccountRoutingStore(db: SqlDb): AccountRoutingRepository {
  return {
    async get() {
      const row = await db.get<Row>(`SELECT overrides, options FROM account_routing WHERE id = 1`);
      if (!row) return null;
      return {
        overrides: JSON.parse(row.overrides) as Record<string, string>,
        options: { ...DEFAULT_ACCOUNT_ROUTING_OPTIONS, ...(JSON.parse(row.options) as Partial<AccountRoutingOptions>) },
      };
    },
    async save(routing: AccountRouting) {
      await db.run(
        `INSERT INTO account_routing (id, overrides, options)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET overrides = excluded.overrides, options = excluded.options`,
        [JSON.stringify(routing.overrides), JSON.stringify(routing.options)],
      );
    },
  };
}

export function createSqliteAccountRoutingStore(sqlite: Database.Database): AccountRoutingRepository {
  sqlite.exec(CREATE_TABLE);
  return createAccountRoutingStore(sqliteDb(sqlite));
}
