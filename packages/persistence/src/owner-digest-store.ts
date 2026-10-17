import Database from "better-sqlite3";
import { OwnerDigestTrigger, type OwnerDigestCadence, type OwnerDigestSettingsInputDTO } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";

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
  getSettings(): StoredOwnerDigestSettings | null;
  saveSettings(settings: OwnerDigestSettingsInputDTO, at: string, by: string): void;
  /**
   * INVARIANT: a scheduled digest is claimed per (period, recipient) BEFORE it is composed, so two ticks racing
   * for one period cannot both queue it. A claim never completed (empty html) is recoverable after `staleBefore`.
   */
  claim(claim: OwnerDigestClaim): boolean;
  complete(id: string, html: string): void;
  release(id: string): void;
  recent(limit: number): readonly OwnerDigestRunRecord[];
  mailHtml(notificationId: string): string | null;
  close(): void;
}

class SqliteOwnerDigestStore implements OwnerDigestStore {
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  private readonly claimScheduled: Database.Statement;
  private readonly insertManual: Database.Statement;
  private readonly completeRun: Database.Statement;
  private readonly releaseRun: Database.Statement;
  private readonly selectRecent: Database.Statement;
  private readonly selectHtml: Database.Statement;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly owned: boolean,
  ) {
    this.selectSettings = sqlite.prepare(`SELECT settings_json, updated_at, updated_by FROM owner_digest_settings WHERE id = 1`);
    this.upsertSettings = sqlite.prepare(`
      INSERT INTO owner_digest_settings (id, settings_json, updated_at, updated_by) VALUES (1, @settings_json, @updated_at, @updated_by)
      ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `);
    this.claimScheduled = sqlite.prepare(`
      INSERT INTO owner_digest_run (id, cadence, period_key, period_from, period_to, recipient_user_id, trigger, notification_id, html, created_at)
      VALUES (@id, @cadence, @period_key, @period_from, @period_to, @recipient_user_id, @trigger, @notification_id, '', @created_at)
      ON CONFLICT(period_key, recipient_user_id) WHERE trigger = 'scheduled' DO UPDATE SET
        id = excluded.id, notification_id = excluded.notification_id, created_at = excluded.created_at
      WHERE owner_digest_run.html = '' AND owner_digest_run.created_at < @stale_before
    `);
    this.insertManual = sqlite.prepare(`
      INSERT INTO owner_digest_run (id, cadence, period_key, period_from, period_to, recipient_user_id, trigger, notification_id, html, created_at)
      VALUES (@id, @cadence, @period_key, @period_from, @period_to, @recipient_user_id, @trigger, @notification_id, '', @created_at)
    `);
    this.completeRun = sqlite.prepare(`UPDATE owner_digest_run SET html = @html WHERE id = @id`);
    this.releaseRun = sqlite.prepare(`DELETE FROM owner_digest_run WHERE id = ? AND html = ''`);
    this.selectRecent = sqlite.prepare(
      `SELECT id, cadence, period_key, period_from, period_to, recipient_user_id, trigger, notification_id, created_at FROM owner_digest_run WHERE html <> '' ORDER BY created_at DESC, id DESC LIMIT ?`,
    );
    this.selectHtml = sqlite.prepare(`SELECT html FROM owner_digest_run WHERE notification_id = ? AND html <> ''`);
  }

  getSettings(): StoredOwnerDigestSettings | null {
    const row = this.selectSettings.get() as SettingsRow | undefined;
    return row ? { settings: JSON.parse(row.settings_json) as OwnerDigestSettingsInputDTO, updatedAt: row.updated_at, updatedBy: row.updated_by } : null;
  }

  saveSettings(settings: OwnerDigestSettingsInputDTO, at: string, by: string): void {
    this.upsertSettings.run({ settings_json: JSON.stringify(settings), updated_at: at, updated_by: by });
  }

  claim(claim: OwnerDigestClaim): boolean {
    const params = {
      id: claim.id,
      cadence: claim.cadence,
      period_key: claim.periodKey,
      period_from: claim.periodFrom,
      period_to: claim.periodTo,
      recipient_user_id: claim.recipientUserId,
      trigger: claim.trigger,
      notification_id: claim.notificationId,
      created_at: claim.createdAt,
    };
    if (claim.trigger === OwnerDigestTrigger.Manual) {
      this.insertManual.run(params);
      return true;
    }
    return this.claimScheduled.run({ ...params, stale_before: claim.staleBefore }).changes > 0;
  }

  complete(id: string, html: string): void {
    this.completeRun.run({ id, html });
  }

  release(id: string): void {
    this.releaseRun.run(id);
  }

  recent(limit: number): readonly OwnerDigestRunRecord[] {
    return (this.selectRecent.all(limit) as RunRow[]).map(toRun);
  }

  mailHtml(notificationId: string): string | null {
    const row = this.selectHtml.get(notificationId) as { html: string } | undefined;
    return row?.html ?? null;
  }

  close(): void {
    if (this.owned) this.sqlite.close();
  }
}

export function createSqliteOwnerDigestStore(path: SqliteConnectionInput = ":memory:"): OwnerDigestStore {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return new SqliteOwnerDigestStore(sqlite, owned);
}
