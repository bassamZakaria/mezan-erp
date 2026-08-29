import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  EventCode,
  NotificationChannel,
  NotificationCondition,
  NotificationPriority,
  NotificationRecipientType,
  NotificationRule,
  NotificationRuleListFilter,
  NotificationRuleRepository,
} from "@mezan/domain";

/**
 * SQLite-backed {@link NotificationRuleRepository} (docs/archive/catalog/09
 * §قواعد الإشعارات). Single-table store, raw better-sqlite3 (the dominant
 * pattern in this package — see `price-list-store.ts`/`audit-sink.ts`), not
 * Drizzle. `condition` and `channels` are stored as JSON text.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS notification_rule (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  event_code       TEXT NOT NULL,
  condition_json   TEXT,
  recipient_type   TEXT NOT NULL,
  recipient_value  TEXT NOT NULL,
  priority         TEXT NOT NULL,
  channels_json    TEXT NOT NULL,
  title_ar         TEXT,
  body_ar          TEXT,
  active           INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_rule_event ON notification_rule(event_code);
`;

interface NotificationRuleRow {
  id: string;
  name: string;
  event_code: string;
  condition_json: string | null;
  recipient_type: string;
  recipient_value: string;
  priority: string;
  channels_json: string;
  title_ar: string | null;
  body_ar: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function toRow(rule: NotificationRule) {
  return {
    id: rule.id,
    name: rule.name,
    event_code: rule.eventCode,
    condition_json: rule.condition ? JSON.stringify(rule.condition) : null,
    recipient_type: rule.recipientType,
    recipient_value: rule.recipientValue,
    priority: rule.priority,
    channels_json: JSON.stringify(rule.channels),
    title_ar: rule.titleAr,
    body_ar: rule.bodyAr,
    active: rule.active ? 1 : 0,
    created_at: rule.createdAt,
    updated_at: rule.updatedAt,
  };
}

function fromRow(row: NotificationRuleRow): NotificationRule {
  return {
    id: row.id,
    name: row.name,
    eventCode: row.event_code as EventCode,
    condition: row.condition_json ? (JSON.parse(row.condition_json) as NotificationCondition) : null,
    recipientType: row.recipient_type as NotificationRecipientType,
    recipientValue: row.recipient_value,
    priority: row.priority as NotificationPriority,
    channels: JSON.parse(row.channels_json) as NotificationChannel[],
    titleAr: row.title_ar,
    bodyAr: row.body_ar,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqliteNotificationRuleRepository implements NotificationRuleRepository {
  private readonly insertStmt: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly selectByIdStmt: Database.Statement;
  private readonly deleteStmt: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insertStmt = sqlite.prepare(`
      INSERT INTO notification_rule
        (id, name, event_code, condition_json, recipient_type, recipient_value, priority, channels_json, title_ar, body_ar, active, created_at, updated_at)
      VALUES
        (@id, @name, @event_code, @condition_json, @recipient_type, @recipient_value, @priority, @channels_json, @title_ar, @body_ar, @active, @created_at, @updated_at)
    `);
    this.updateStmt = sqlite.prepare(`
      UPDATE notification_rule SET
        name = @name, event_code = @event_code, condition_json = @condition_json,
        recipient_type = @recipient_type, recipient_value = @recipient_value,
        priority = @priority, channels_json = @channels_json,
        title_ar = @title_ar, body_ar = @body_ar, active = @active, updated_at = @updated_at
      WHERE id = @id
    `);
    this.selectByIdStmt = sqlite.prepare(`SELECT * FROM notification_rule WHERE id = ?`);
    this.deleteStmt = sqlite.prepare(`DELETE FROM notification_rule WHERE id = ?`);
  }

  async save(rule: NotificationRule): Promise<void> {
    this.insertStmt.run(toRow(rule));
  }

  async update(rule: NotificationRule): Promise<void> {
    this.updateStmt.run(toRow(rule));
  }

  async findById(id: string): Promise<NotificationRule | null> {
    const row = this.selectByIdStmt.get(id) as NotificationRuleRow | undefined;
    return row ? fromRow(row) : null;
  }

  async list(filter: NotificationRuleListFilter = {}): Promise<readonly NotificationRule[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.active !== undefined) {
      clauses.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    if (filter.eventCode !== undefined) {
      clauses.push("event_code = ?");
      params.push(filter.eventCode);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM notification_rule ${where} ORDER BY created_at`)
      .all(...params) as NotificationRuleRow[];
    return rows.map(fromRow);
  }

  async listActiveByEventCode(eventCode: string): Promise<readonly NotificationRule[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM notification_rule WHERE active = 1 AND event_code = ? ORDER BY created_at`)
      .all(eventCode) as NotificationRuleRow[];
    return rows.map(fromRow);
  }

  async delete(id: string): Promise<void> {
    this.deleteStmt.run(id);
  }
}

export interface SqliteNotificationRuleStoreHandle extends NotificationRuleRepository {
  close(): void;
}

/** Open a SQLite-backed NotificationRuleRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteNotificationRuleStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteNotificationRuleStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  const repo = new SqliteNotificationRuleRepository(sqlite);
  return Object.assign(repo, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteNotificationRuleStoreHandle;
}
