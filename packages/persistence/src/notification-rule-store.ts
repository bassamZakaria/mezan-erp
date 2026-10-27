import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { refuseUnlessInserted } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
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
 * SQL-backed {@link NotificationRuleRepository} (docs/archive/catalog/09
 * §قواعد الإشعارات). Single-table store. `condition` and `channels` are stored
 * as JSON text.
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
  active: bigint;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, name, event_code, condition_json, recipient_type, recipient_value, priority, channels_json, title_ar, body_ar, active, created_at, updated_at";

function mutableValues(rule: NotificationRule): SqlValue[] {
  return [
    rule.name,
    rule.eventCode,
    rule.condition ? JSON.stringify(rule.condition) : null,
    rule.recipientType,
    rule.recipientValue,
    rule.priority,
    JSON.stringify(rule.channels),
    rule.titleAr,
    rule.bodyAr,
    rule.active ? 1 : 0,
  ];
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
    active: Number(row.active) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SqlNotificationRuleRepository implements NotificationRuleRepository {
  constructor(private readonly db: SqlDb) {}

  async save(rule: NotificationRule): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO notification_rule (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      [rule.id, ...mutableValues(rule), rule.createdAt, rule.updatedAt],
    );
    refuseUnlessInserted(rule.id, inserted.changes);
  }

  async update(rule: NotificationRule): Promise<void> {
    await this.db.run(
      `UPDATE notification_rule SET
        name = ?, event_code = ?, condition_json = ?,
        recipient_type = ?, recipient_value = ?,
        priority = ?, channels_json = ?,
        title_ar = ?, body_ar = ?, active = ?, updated_at = ?
      WHERE id = ?`,
      [...mutableValues(rule), rule.updatedAt, rule.id],
    );
  }

  async findById(id: string): Promise<NotificationRule | null> {
    const row = await this.db.get<NotificationRuleRow>(`SELECT ${COLUMNS} FROM notification_rule WHERE id = ?`, [id]);
    return row ? fromRow(row) : null;
  }

  async list(filter: NotificationRuleListFilter = {}): Promise<readonly NotificationRule[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.active !== undefined) {
      clauses.push("active = ?");
      params.push(filter.active ? 1 : 0);
    }
    if (filter.eventCode !== undefined) {
      clauses.push("event_code = ?");
      params.push(filter.eventCode);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<NotificationRuleRow>(`SELECT ${COLUMNS} FROM notification_rule ${where} ORDER BY created_at`, params);
    return rows.map(fromRow);
  }

  async listActiveByEventCode(eventCode: string): Promise<readonly NotificationRule[]> {
    const rows = await this.db.all<NotificationRuleRow>(`SELECT ${COLUMNS} FROM notification_rule WHERE active = 1 AND event_code = ? ORDER BY created_at`, [eventCode]);
    return rows.map(fromRow);
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM notification_rule WHERE id = ?`, [id]);
  }
}

export interface SqliteNotificationRuleStoreHandle extends NotificationRuleRepository {
  close(): void;
}

export async function ensureNotificationRuleSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createNotificationRuleStore(db: SqlDb): NotificationRuleRepository {
  return new SqlNotificationRuleRepository(db);
}

/** Open a SQLite-backed NotificationRuleRepository. ":memory:" for tests, a path (or a shared connection) for real. */
export function createSqliteNotificationRuleStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteNotificationRuleStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return Object.assign(createNotificationRuleStore(sqliteDb(sqlite)), {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteNotificationRuleStoreHandle;
}
