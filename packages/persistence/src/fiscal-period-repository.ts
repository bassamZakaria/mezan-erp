import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { FiscalPeriod, FiscalPeriodRepository, FiscalPeriodStatus } from "@mezan/domain";
import { calendarDay } from "@mezan/domain";

/** SQLite-backed FiscalPeriodRepository (docs/archive/catalog/04 "الفترات المالية"). Standalone, mirroring `createSqliteAccountRepository`. */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS fiscal_period (
  id             TEXT PRIMARY KEY,
  year           INTEGER NOT NULL,
  period_number  INTEGER NOT NULL,
  start_date     TEXT NOT NULL,
  end_date       TEXT NOT NULL,
  status         TEXT NOT NULL,
  UNIQUE(year, period_number)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_period_year ON fiscal_period(year);
`;

interface FiscalPeriodRow {
  id: string;
  year: number;
  period_number: number;
  start_date: string;
  end_date: string;
  status: string;
}

function toFiscalPeriod(row: FiscalPeriodRow): FiscalPeriod {
  return {
    id: row.id,
    year: row.year,
    periodNumber: row.period_number,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as FiscalPeriodStatus,
  };
}

class SqliteFiscalPeriodRepository implements FiscalPeriodRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByDate: Database.Statement;
  private readonly selectByYearAndNumber: Database.Statement;
  private readonly selectByYear: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO fiscal_period (id, year, period_number, start_date, end_date, status)
      VALUES (@id, @year, @period_number, @start_date, @end_date, @status)
      ON CONFLICT(id) DO UPDATE SET
        year = excluded.year,
        period_number = excluded.period_number,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM fiscal_period WHERE id = ?`);
    this.selectByDate = sqlite.prepare(`SELECT * FROM fiscal_period WHERE ? BETWEEN start_date AND end_date`);
    this.selectByYearAndNumber = sqlite.prepare(`SELECT * FROM fiscal_period WHERE year = ? AND period_number = ?`);
    this.selectByYear = sqlite.prepare(`SELECT * FROM fiscal_period WHERE year = ? ORDER BY period_number`);
    this.selectAll = sqlite.prepare(`SELECT * FROM fiscal_period ORDER BY year, period_number`);
  }

  async findById(id: string): Promise<FiscalPeriod | null> {
    const row = this.selectById.get(id) as FiscalPeriodRow | undefined;
    return row ? toFiscalPeriod(row) : null;
  }

  async findByDate(date: string): Promise<FiscalPeriod | null> {
    // `start_date`/`end_date` are DAYS and callers pass an INSTANT — a
    // document's `occurredAt`. String order puts "2026-08-31T03:10:33.016Z"
    // after "2026-08-31", so `BETWEEN` matched nothing on the last day of every
    // month and every GL posting that day failed for want of a period. On the
    // one day a shop posts most. See `calendarDay`.
    const row = this.selectByDate.get(calendarDay(date)) as FiscalPeriodRow | undefined;
    return row ? toFiscalPeriod(row) : null;
  }

  async findByYearAndNumber(year: number, periodNumber: number): Promise<FiscalPeriod | null> {
    const row = this.selectByYearAndNumber.get(year, periodNumber) as FiscalPeriodRow | undefined;
    return row ? toFiscalPeriod(row) : null;
  }

  async listByYear(year: number): Promise<FiscalPeriod[]> {
    const rows = this.selectByYear.all(year) as FiscalPeriodRow[];
    return rows.map(toFiscalPeriod);
  }

  async list(): Promise<FiscalPeriod[]> {
    const rows = this.selectAll.all() as FiscalPeriodRow[];
    return rows.map(toFiscalPeriod);
  }

  async create(period: FiscalPeriod): Promise<void> {
    this.write(period);
  }

  async update(period: FiscalPeriod): Promise<void> {
    this.write(period);
  }

  private write(period: FiscalPeriod): void {
    this.upsert.run({
      id: period.id,
      year: period.year,
      period_number: period.periodNumber,
      start_date: period.startDate,
      end_date: period.endDate,
      status: period.status,
    });
  }
}

export interface SqliteFiscalPeriodRepositoryHandle extends FiscalPeriodRepository {
  close(): void;
}

/** Open a SQLite-backed FiscalPeriodRepository. ":memory:" for tests, a path for real. */
export function createSqliteFiscalPeriodRepository(path: SqliteConnectionInput = ":memory:"): SqliteFiscalPeriodRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteFiscalPeriodRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteFiscalPeriodRepositoryHandle;
}
