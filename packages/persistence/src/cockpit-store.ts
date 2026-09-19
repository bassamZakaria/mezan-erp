import type Database from "better-sqlite3";

export interface LedgerWatermark {
  read(): string;
}

export function createSqliteLedgerWatermark(sqlite: Database.Database): LedgerWatermark {
  const lines = sqlite.prepare(`SELECT COALESCE(MAX(id), 0) AS n FROM journal_line`).safeIntegers();
  const entries = sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry WHERE status IN ('posted', 'reversed')`).safeIntegers();
  return {
    read() {
      const lastLine = (lines.get() as { n: bigint }).n;
      const effective = (entries.get() as { n: bigint }).n;
      return `${lastLine.toString()}-${effective.toString()}`;
    },
  };
}
