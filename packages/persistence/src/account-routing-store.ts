import Database from "better-sqlite3";
import {
  DEFAULT_ACCOUNT_ROUTING_OPTIONS,
  type AccountRouting,
  type AccountRoutingOptions,
  type AccountRoutingRepository,
} from "@mezan/domain";

/**
 * SQLite-backed account routing (R6.1). One row, because a tenant has one
 * routing table — the same single-row shape `settings` uses.
 */
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

export function createSqliteAccountRoutingStore(sqlite: Database.Database): AccountRoutingRepository {
  sqlite.exec(CREATE_TABLE);
  const select = sqlite.prepare(`SELECT overrides, options FROM account_routing WHERE id = 1`);
  const upsert = sqlite.prepare(`
    INSERT INTO account_routing (id, overrides, options)
    VALUES (1, @overrides, @options)
    ON CONFLICT(id) DO UPDATE SET overrides = excluded.overrides, options = excluded.options
  `);

  return {
    async get() {
      const row = select.get() as Row | undefined;
      if (!row) return null;
      return {
        overrides: JSON.parse(row.overrides) as Record<string, string>,
        options: { ...DEFAULT_ACCOUNT_ROUTING_OPTIONS, ...(JSON.parse(row.options) as Partial<AccountRoutingOptions>) },
      };
    },
    async save(routing: AccountRouting) {
      upsert.run({ overrides: JSON.stringify(routing.overrides), options: JSON.stringify(routing.options) });
    },
  };
}
