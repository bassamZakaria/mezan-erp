import { Money, type CashForecastAlertRecord, type CashForecastStore, type CashForecastThresholdRecord } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const THRESHOLD_ROW = "default";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cash_forecast_threshold (
  id            TEXT PRIMARY KEY CHECK (id = 'default'),
  amount_scaled TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT
);
CREATE TABLE IF NOT EXISTS cash_forecast_alerts (
  id                    TEXT PRIMARY KEY,
  crossing_date         TEXT NOT NULL,
  threshold_scaled      TEXT NOT NULL,
  lowest_date           TEXT NOT NULL,
  lowest_balance_scaled TEXT NOT NULL,
  detected_at           TEXT NOT NULL,
  cleared_at            TEXT,
  notified_count        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_forecast_alerts_one_open
  ON cash_forecast_alerts ((cleared_at IS NULL)) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS cash_forecast_alerts_detected ON cash_forecast_alerts (detected_at);
`;

const ALERT_COLUMNS = "id, crossing_date, threshold_scaled, lowest_date, lowest_balance_scaled, detected_at, cleared_at, notified_count";

interface AlertRow {
  readonly id: string;
  readonly crossing_date: string;
  readonly threshold_scaled: string;
  readonly lowest_date: string;
  readonly lowest_balance_scaled: string;
  readonly detected_at: string;
  readonly cleared_at: string | null;
  readonly notified_count: bigint;
}

function alertFromRow(row: AlertRow): CashForecastAlertRecord {
  return {
    id: row.id,
    crossingDate: row.crossing_date,
    threshold: Money.fromScaled(BigInt(row.threshold_scaled)),
    lowestDate: row.lowest_date,
    lowestBalance: Money.fromScaled(BigInt(row.lowest_balance_scaled)),
    detectedAt: row.detected_at,
    clearedAt: row.cleared_at,
    notifiedCount: Number(row.notified_count),
  };
}

class SqlCashForecastStore implements CashForecastStore {
  constructor(private readonly db: SqlDb) {}

  async getThreshold(): Promise<CashForecastThresholdRecord | null> {
    const row = await this.db.get<{ amount_scaled: string; updated_at: string; updated_by: string | null }>(
      `SELECT amount_scaled, updated_at, updated_by FROM cash_forecast_threshold WHERE id = ?`,
      [THRESHOLD_ROW],
    );
    if (!row) return null;
    return { amount: Money.fromScaled(BigInt(row.amount_scaled)), updatedAt: row.updated_at, updatedBy: row.updated_by };
  }

  async setThreshold(record: CashForecastThresholdRecord): Promise<void> {
    await this.db.run(
      `INSERT INTO cash_forecast_threshold (id, amount_scaled, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET amount_scaled = excluded.amount_scaled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [THRESHOLD_ROW, record.amount.scaled.toString(), record.updatedAt, record.updatedBy],
    );
  }

  async openAlert(): Promise<CashForecastAlertRecord | null> {
    const row = await this.db.get<AlertRow>(`SELECT ${ALERT_COLUMNS} FROM cash_forecast_alerts WHERE cleared_at IS NULL LIMIT 1`);
    return row ? alertFromRow(row) : null;
  }

  // ON CONFLICT with no target: the one-open partial index is the conflict
  // that matters here, not the primary key.
  async openCrossing(alert: CashForecastAlertRecord): Promise<boolean> {
    const result = await this.db.run(
      `INSERT INTO cash_forecast_alerts (${ALERT_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0)
       ON CONFLICT DO NOTHING`,
      [alert.id, alert.crossingDate, alert.threshold.scaled.toString(), alert.lowestDate, alert.lowestBalance.scaled.toString(), alert.detectedAt],
    );
    return result.changes === 1;
  }

  async markNotified(id: string, count: number): Promise<void> {
    await this.db.run(`UPDATE cash_forecast_alerts SET notified_count = ? WHERE id = ?`, [count, id]);
  }

  async clearOpen(clearedAt: string): Promise<void> {
    await this.db.run(`UPDATE cash_forecast_alerts SET cleared_at = ? WHERE cleared_at IS NULL`, [clearedAt]);
  }

  async listAlerts(limit: number): Promise<readonly CashForecastAlertRecord[]> {
    return (await this.db.all<AlertRow>(`SELECT ${ALERT_COLUMNS} FROM cash_forecast_alerts ORDER BY detected_at DESC LIMIT ?`, [limit])).map(alertFromRow);
  }
}

export interface SqliteCashForecastStoreHandle extends CashForecastStore {
  close(): void;
}

export async function ensureCashForecastSchema(db: SqlDb): Promise<void> {
  await db.applySchema(SCHEMA);
}

export function createCashForecastStore(db: SqlDb): CashForecastStore {
  return new SqlCashForecastStore(db);
}

export function createSqliteCashForecastStore(path: SqliteConnectionInput = ":memory:"): SqliteCashForecastStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(SCHEMA);
  return Object.assign(createCashForecastStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteCashForecastStoreHandle;
}
