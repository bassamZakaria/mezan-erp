import { OwnerDigestTrigger, type OwnerDigestCadence, type OwnerDigestSettingsInputDTO } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS owner_digest_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json  TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_digest_run (
  id                 TEXT PRIMARY KEY,
  cadence            TEXT NOT NULL,
  period_key         TEXT NOT NULL,
  period_from        TEXT NOT NULL,
  period_to          TEXT NOT NULL,
  recipient_user_id  TEXT NOT NULL,
  trigger            TEXT NOT NULL,
  notification_id    TEXT NOT NULL,
  html               TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_owner_digest_run_scheduled ON owner_digest_run(period_key, recipient_user_id) WHERE trigger = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_owner_digest_run_created ON owner_digest_run(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_owner_digest_run_notification ON owner_digest_run(notification_id);
`;

export interface StoredOwnerDigestSettings {
  readonly settings: OwnerDigestSettingsInputDTO;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface OwnerDigestRunRecord {
  readonly id: string;
  readonly cadence: OwnerDigestCadence;
  readonly periodKey: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly recipientUserId: string;
  readonly trigger: OwnerDigestTrigger;
  readonly notificationId: string;
  readonly createdAt: string;
}

export interface OwnerDigestClaim extends OwnerDigestRunRecord {
  readonly staleBefore: string;
}

interface SettingsRow {
  settings_json: string;
  updated_at: string;
  updated_by: string;
}

interface RunRow {
  id: string;
  cadence: string;
  period_key: string;
  period_from: string;
  period_to: string;
  recipient_user_id: string;
  trigger: string;
  notification_id: string;
  created_at: string;
}

function toRun(row: RunRow): OwnerDigestRunRecord {
  return {
    id: row.id,
    cadence: row.cadence as OwnerDigestCadence,
    periodKey: row.period_key,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    recipientUserId: row.recipient_user_id,
    trigger: row.trigger as OwnerDigestTrigger,
    notificationId: row.notification_id,
    createdAt: row.created_at,
  };
}

export interface OwnerDigestStore {
  getSettings(): Promise<StoredOwnerDigestSettings | null>;
  saveSettings(settings: OwnerDigestSettingsInputDTO, at: string, by: string): Promise<void>;
  /**
   * INVARIANT: a scheduled digest is claimed per (period, recipient) BEFORE it is composed, so two ticks racing
   * for one period cannot both queue it. A claim never completed (empty html) is recoverable after `staleBefore`.
   */
  claim(claim: OwnerDigestClaim): Promise<boolean>;
  complete(id: string, html: string): Promise<void>;
  release(id: string): Promise<void>;
  recent(limit: number): Promise<readonly OwnerDigestRunRecord[]>;
  mailHtml(notificationId: string): Promise<string | null>;
  close(): void;
}

const RUN_INSERT = `INSERT INTO owner_digest_run (id, cadence, period_key, period_from, period_to, recipient_user_id, trigger, notification_id, html, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`;

class SqlOwnerDigestStore implements OwnerDigestStore {
  constructor(
    private readonly db: SqlDb,
    private readonly onClose: () => void = () => undefined,
  ) {}

  async getSettings(): Promise<StoredOwnerDigestSettings | null> {
    const row = await this.db.get<SettingsRow>(`SELECT settings_json, updated_at, updated_by FROM owner_digest_settings WHERE id = 1`);
    return row ? { settings: JSON.parse(row.settings_json) as OwnerDigestSettingsInputDTO, updatedAt: row.updated_at, updatedBy: row.updated_by } : null;
  }

  async saveSettings(settings: OwnerDigestSettingsInputDTO, at: string, by: string): Promise<void> {
    await this.db.run(
      `INSERT INTO owner_digest_settings (id, settings_json, updated_at, updated_by) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [JSON.stringify(settings), at, by],
    );
  }

  async claim(claim: OwnerDigestClaim): Promise<boolean> {
    const params: SqlValue[] = [
      claim.id,
      claim.cadence,
      claim.periodKey,
      claim.periodFrom,
      claim.periodTo,
      claim.recipientUserId,
      claim.trigger,
      claim.notificationId,
      claim.createdAt,
    ];
    if (claim.trigger === OwnerDigestTrigger.Manual) {
      await this.db.run(RUN_INSERT, params);
      return true;
    }
    const claimed = await this.db.run(
      `${RUN_INSERT}
      ON CONFLICT(period_key, recipient_user_id) WHERE trigger = 'scheduled' DO UPDATE SET
        id = excluded.id, notification_id = excluded.notification_id, created_at = excluded.created_at
      WHERE owner_digest_run.html = '' AND owner_digest_run.created_at < ?`,
      [...params, claim.staleBefore],
    );
    return claimed.changes > 0;
  }

  async complete(id: string, html: string): Promise<void> {
    await this.db.run(`UPDATE owner_digest_run SET html = ? WHERE id = ?`, [html, id]);
  }

  async release(id: string): Promise<void> {
    await this.db.run(`DELETE FROM owner_digest_run WHERE id = ? AND html = ''`, [id]);
  }

  async recent(limit: number): Promise<readonly OwnerDigestRunRecord[]> {
    return (
      await this.db.all<RunRow>(
        `SELECT id, cadence, period_key, period_from, period_to, recipient_user_id, trigger, notification_id, created_at FROM owner_digest_run WHERE html <> '' ORDER BY created_at DESC, id DESC LIMIT ?`,
        [limit],
      )
    ).map(toRun);
  }

  async mailHtml(notificationId: string): Promise<string | null> {
    const row = await this.db.get<{ html: string }>(`SELECT html FROM owner_digest_run WHERE notification_id = ? AND html <> ''`, [notificationId]);
    return row?.html ?? null;
  }

  close(): void {
    this.onClose();
  }
}

export async function ensureOwnerDigestSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createOwnerDigestStore(db: SqlDb): OwnerDigestStore {
  return new SqlOwnerDigestStore(db);
}

export function createSqliteOwnerDigestStore(path: SqliteConnectionInput = ":memory:"): OwnerDigestStore {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return new SqlOwnerDigestStore(sqliteDb(sqlite), () => {
    if (owned) sqlite.close();
  });
}
