import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import type {
  ExchangeRate,
  ExchangeRateRepository,
  ExchangeRateSource,
  ExchangeRateStatus,
  ExchangeRateType,
} from "@mezan/domain";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS exchange_rate (
  id             TEXT PRIMARY KEY,
  currency       TEXT NOT NULL,
  rate           TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  rate_type      TEXT NOT NULL,
  source         TEXT NOT NULL,
  status         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exchange_rate_lookup ON exchange_rate(currency, effective_date);
`;

const UPSERT = `
  INSERT INTO exchange_rate (id, currency, rate, effective_date, rate_type, source, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    currency = excluded.currency,
    rate = excluded.rate,
    effective_date = excluded.effective_date,
    rate_type = excluded.rate_type,
    source = excluded.source,
    status = excluded.status`;

interface Row {
  id: string;
  currency: string;
  rate: string;
  effective_date: string;
  rate_type: string;
  source: string;
  status: string;
}

function toRate(row: Row): ExchangeRate {
  return {
    id: row.id,
    currency: row.currency,
    rate: row.rate,
    effectiveDate: row.effective_date,
    rateType: row.rate_type as ExchangeRateType,
    source: row.source as ExchangeRateSource,
    status: row.status as ExchangeRateStatus,
  };
}

function params(rate: ExchangeRate): SqlValue[] {
  return [rate.id, rate.currency, rate.rate, rate.effectiveDate, rate.rateType, rate.source, rate.status];
}

class SqlExchangeRateRepository implements ExchangeRateRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<ExchangeRate | null> {
    const row = await this.db.get<Row>(`SELECT * FROM exchange_rate WHERE id = ?`, [id]);
    return row ? toRate(row) : null;
  }

  async list(): Promise<ExchangeRate[]> {
    return (await this.db.all<Row>(`SELECT * FROM exchange_rate ORDER BY currency, effective_date DESC`)).map(toRate);
  }

  async findRate(currency: string, asOfDate: string): Promise<ExchangeRate | null> {
    const row = await this.db.get<Row>(
      `SELECT * FROM exchange_rate
        WHERE currency = ? AND effective_date <= ? AND status IN ('approved', 'locked')
        ORDER BY effective_date DESC, id DESC
        LIMIT 1`,
      [currency, asOfDate],
    );
    return row ? toRate(row) : null;
  }

  async create(rate: ExchangeRate): Promise<void> {
    await insertNew(this.db, rate.id, UPSERT, params(rate));
  }

  async update(rate: ExchangeRate): Promise<void> {
    await this.db.run(UPSERT, params(rate));
  }
}

export interface SqliteExchangeRateRepositoryHandle extends ExchangeRateRepository {
  close(): void;
}

export async function ensureExchangeRateSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createExchangeRateRepository(db: SqlDb): ExchangeRateRepository {
  return new SqlExchangeRateRepository(db);
}

export function createSqliteExchangeRateRepository(path: SqliteConnectionInput = ":memory:"): SqliteExchangeRateRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createExchangeRateRepository(sqliteDb(sqlite)), { close: () => { if (owned) sqlite.close(); } }) as SqliteExchangeRateRepositoryHandle;
}
