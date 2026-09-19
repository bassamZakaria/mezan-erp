import type Database from "better-sqlite3";
import { Money, type CashForecastAlertRecord, type CashForecastStore, type CashForecastThresholdRecord } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

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

interface AlertRow {
  readonly id: string;
  readonly crossing_date: string;
  readonly threshold_scaled: string;
  readonly lowest_date: string;
  readonly lowest_balance_scaled: string;
  readonly detected_at: string;
  readonly cleared_at: string | null;
  readonly notified_count: number;
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
    notifiedCount: row.notified_count,
  };
}

class SqliteCashForecastStore implements CashForecastStore {
  private readonly selectThreshold: Database.Statement;
  private readonly upsertThreshold: Database.Statement;
  private readonly selectOpen: Database.Statement;
  private readonly insertAlert: Database.Statement;
  private readonly updateNotified: Database.Statement;
  private readonly clear: Database.Statement;
  private readonly selectAlerts: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.selectThreshold = sqlite.prepare(`SELECT amount_scaled, updated_at, updated_by FROM cash_forecast_threshold WHERE id = ?`);
    this.upsertThreshold = sqlite.prepare(
      `INSERT INTO cash_forecast_threshold (id, amount_scaled, updated_at, updated_by) VALUES (@id, @amount, @updatedAt, @updatedBy)
       ON CONFLICT(id) DO UPDATE SET amount_scaled = @amount, updated_at = @updatedAt, updated_by = @updatedBy`,
    );
    this.selectOpen = sqlite.prepare(`SELECT * FROM cash_forecast_alerts WHERE cleared_at IS NULL LIMIT 1`);
    this.insertAlert = sqlite.prepare(
      `INSERT OR IGNORE INTO cash_forecast_alerts
         (id, crossing_date, threshold_scaled, lowest_date, lowest_balance_scaled, detected_at, cleared_at, notified_count)
       VALUES (@id, @crossingDate, @threshold, @lowestDate, @lowestBalance, @detectedAt, NULL, 0)`,
    );
    this.updateNotified = sqlite.prepare(`UPDATE cash_forecast_alerts SET notified_count = ? WHERE id = ?`);
    this.clear = sqlite.prepare(`UPDATE cash_forecast_alerts SET cleared_at = ? WHERE cleared_at IS NULL`);
    this.selectAlerts = sqlite.prepare(`SELECT * FROM cash_forecast_alerts ORDER BY detected_at DESC LIMIT ?`);
  }

  async getThreshold(): Promise<CashForecastThresholdRecord | null> {
    const row = this.selectThreshold.get(THRESHOLD_ROW) as { amount_scaled: string; updated_at: string; updated_by: string | null } | undefined;
    if (!row) return null;
    return { amount: Money.fromScaled(BigInt(row.amount_scaled)), updatedAt: row.updated_at, updatedBy: row.updated_by };
  }

  async setThreshold(record: CashForecastThresholdRecord): Promise<void> {
    this.upsertThreshold.run({ id: THRESHOLD_ROW, amount: record.amount.scaled.toString(), updatedAt: record.updatedAt, updatedBy: record.updatedBy });
  }

  async openAlert(): Promise<CashForecastAlertRecord | null> {
    const row = this.selectOpen.get() as AlertRow | undefined;
    return row ? alertFromRow(row) : null;
  }

  async openCrossing(alert: CashForecastAlertRecord): Promise<boolean> {
    const result = this.insertAlert.run({
      id: alert.id,
      crossingDate: alert.crossingDate,
      threshold: alert.threshold.scaled.toString(),
      lowestDate: alert.lowestDate,
      lowestBalance: alert.lowestBalance.scaled.toString(),
      detectedAt: alert.detectedAt,
    });
    return result.changes === 1;
  }

  async markNotified(id: string, count: number): Promise<void> {
    this.updateNotified.run(count, id);
  }

  async clearOpen(clearedAt: string): Promise<void> {
    this.clear.run(clearedAt);
  }

  async listAlerts(limit: number): Promise<readonly CashForecastAlertRecord[]> {
    return (this.selectAlerts.all(limit) as AlertRow[]).map(alertFromRow);
  }
}

export interface SqliteCashForecastStoreHandle extends CashForecastStore {
  close(): void;
}

export function createSqliteCashForecastStore(path: SqliteConnectionInput = ":memory:"): SqliteCashForecastStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(SCHEMA);
  const store = new SqliteCashForecastStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteCashForecastStoreHandle;
}
