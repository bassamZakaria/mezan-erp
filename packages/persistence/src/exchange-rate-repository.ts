import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  ExchangeRate,
  ExchangeRateRepository,
  ExchangeRateSource,
  ExchangeRateStatus,
  ExchangeRateType,
} from "@mezan/domain";

/** SQLite-backed {@link ExchangeRateRepository} (docs/catalog/04 "أسعار الصرف"). */

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

class SqliteExchangeRateRepository implements ExchangeRateRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectRate: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO exchange_rate (id, currency, rate, effective_date, rate_type, source, status)
      VALUES (@id, @currency, @rate, @effective_date, @rate_type, @source, @status)
      ON CONFLICT(id) DO UPDATE SET
        currency = excluded.currency,
        rate = excluded.rate,
        effective_date = excluded.effective_date,
        rate_type = excluded.rate_type,
        source = excluded.source,
        status = excluded.status
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM exchange_rate WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM exchange_rate ORDER BY currency, effective_date DESC`);
    // Latest usable (approved/locked) rate for a currency on/before a date.
    this.selectRate = sqlite.prepare(`
      SELECT * FROM exchange_rate
       WHERE currency = ? AND effective_date <= ? AND status IN ('approved', 'locked')
       ORDER BY effective_date DESC, id DESC
       LIMIT 1
    `);
  }

  async findById(id: string): Promise<ExchangeRate | null> {
    const row = this.selectById.get(id) as Row | undefined;
    return row ? toRate(row) : null;
  }

  async list(): Promise<ExchangeRate[]> {
    return (this.selectAll.all() as Row[]).map(toRate);
  }

  async findRate(currency: string, asOfDate: string): Promise<ExchangeRate | null> {
    const row = this.selectRate.get(currency, asOfDate) as Row | undefined;
    return row ? toRate(row) : null;
  }

  async create(rate: ExchangeRate): Promise<void> {
    this.write(rate);
  }

  async update(rate: ExchangeRate): Promise<void> {
    this.write(rate);
  }

  private write(rate: ExchangeRate): void {
    this.upsert.run({
      id: rate.id,
      currency: rate.currency,
      rate: rate.rate,
      effective_date: rate.effectiveDate,
      rate_type: rate.rateType,
      source: rate.source,
      status: rate.status,
    });
  }
}

export interface SqliteExchangeRateRepositoryHandle extends ExchangeRateRepository {
  close(): void;
}

/** Open a SQLite-backed ExchangeRateRepository. ":memory:" for tests, a path for real. */
export function createSqliteExchangeRateRepository(path: SqliteConnectionInput = ":memory:"): SqliteExchangeRateRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteExchangeRateRepository(sqlite);
  return Object.assign(repo, { close: () => { if (owned) sqlite.close(); } }) as SqliteExchangeRateRepositoryHandle;
}
