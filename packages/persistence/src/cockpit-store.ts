import type Database from "better-sqlite3";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

export interface LedgerWatermark {
  read(): Promise<string>;
}

export function createLedgerWatermark(db: SqlDb): LedgerWatermark {
  return {
    async read() {
      const lastLine = (await db.get<{ n: bigint }>(`SELECT COALESCE(MAX(id), 0) AS n FROM journal_line`))!.n;
      const effective = (await db.get<{ n: bigint }>(`SELECT COUNT(*) AS n FROM journal_entry WHERE status IN ('posted', 'reversed')`))!.n;
      return `${lastLine.toString()}-${effective.toString()}`;
    },
  };
}

export function createSqliteLedgerWatermark(sqlite: Database.Database): LedgerWatermark {
  return createLedgerWatermark(sqliteDb(sqlite));
}
