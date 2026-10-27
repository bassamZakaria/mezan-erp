import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { FiscalPeriod, FiscalPeriodRepository, FiscalPeriodStatus } from "@mezan/domain";
import { calendarDay } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

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

const UPSERT = `
  INSERT INTO fiscal_period (id, year, period_number, start_date, end_date, status)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    year = excluded.year,
    period_number = excluded.period_number,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    status = excluded.status`;

interface FiscalPeriodRow {
  id: string;
  year: bigint;
  period_number: bigint;
  start_date: string;
  end_date: string;
  status: string;
}

function toFiscalPeriod(row: FiscalPeriodRow): FiscalPeriod {
  return {
    id: row.id,
    year: Number(row.year),
    periodNumber: Number(row.period_number),
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status as FiscalPeriodStatus,
  };
}

function params(period: FiscalPeriod): SqlValue[] {
  return [period.id, period.year, period.periodNumber, period.startDate, period.endDate, period.status];
}

class SqlFiscalPeriodRepository implements FiscalPeriodRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<FiscalPeriod | null> {
    const row = await this.db.get<FiscalPeriodRow>(`SELECT * FROM fiscal_period WHERE id = ?`, [id]);
    return row ? toFiscalPeriod(row) : null;
  }

  async findByDate(date: string): Promise<FiscalPeriod | null> {
    // `start_date`/`end_date` are DAYS and callers pass an INSTANT: cut it to
    // its calendar day, or BETWEEN misses every posting on a month's last day.
    const row = await this.db.get<FiscalPeriodRow>(`SELECT * FROM fiscal_period WHERE ? BETWEEN start_date AND end_date`, [calendarDay(date)]);
    return row ? toFiscalPeriod(row) : null;
  }

  async findByYearAndNumber(year: number, periodNumber: number): Promise<FiscalPeriod | null> {
    const row = await this.db.get<FiscalPeriodRow>(`SELECT * FROM fiscal_period WHERE year = ? AND period_number = ?`, [year, periodNumber]);
    return row ? toFiscalPeriod(row) : null;
  }

  async listByYear(year: number): Promise<FiscalPeriod[]> {
    return (await this.db.all<FiscalPeriodRow>(`SELECT * FROM fiscal_period WHERE year = ? ORDER BY period_number`, [year])).map(toFiscalPeriod);
  }

  async list(): Promise<FiscalPeriod[]> {
    return (await this.db.all<FiscalPeriodRow>(`SELECT * FROM fiscal_period ORDER BY year, period_number`)).map(toFiscalPeriod);
  }

  async create(period: FiscalPeriod): Promise<void> {
    await insertNew(this.db, period.id, UPSERT, params(period));
  }

  async update(period: FiscalPeriod): Promise<void> {
    await this.db.run(UPSERT, params(period));
  }
}

export interface SqliteFiscalPeriodRepositoryHandle extends FiscalPeriodRepository {
  close(): void;
}

export async function ensureFiscalPeriodSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createFiscalPeriodRepository(db: SqlDb): FiscalPeriodRepository {
  return new SqlFiscalPeriodRepository(db);
}

export function createSqliteFiscalPeriodRepository(path: SqliteConnectionInput = ":memory:"): SqliteFiscalPeriodRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createFiscalPeriodRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteFiscalPeriodRepositoryHandle;
}
