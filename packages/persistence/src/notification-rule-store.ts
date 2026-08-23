import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  EventCode,
  NotificationChannel,
  NotificationCondition,
  NotificationPriority,
  NotificationRecipientType,
  NotificationRule,
  NotificationRuleRepository,
} from "@mezan/domain";

/** SQLite-backed NotificationRuleRepository (docs/catalog/09 §"قواعد الإشعارات"). */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS notification_rule (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  event_code      TEXT NOT NULL,
  condition_field TEXT,
  condition_op    TEXT,
  condition_value TEXT,
  recipient_type  TEXT NOT NULL,
  recipient_value TEXT NOT NULL,
  priority        TEXT NOT NULL,
  channels        TEXT NOT NULL,
  title_template  TEXT,
  body_template   TEXT,
  enabled         INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_rule_event ON notification_rule(event_code);
`;

interface NotificationRuleRow {
  id: string;
  name: string;
  event_code: string;
  condition_field: string | null;
  condition_op: string | null;
  condition_value: string | null;
  recipient_type: string;
  recipient_value: string;
  priority: string;
  channels: string;
  title_template: string | null;
  body_template: string | null;
  enabled: number;
  created_at: string;
}

function toRule(row: NotificationRuleRow): NotificationRule {
  const condition: NotificationCondition | null =
    row.condition_field && row.condition_op && row.condition_value !== null
      ? {
          field: row.condition_field,
          operator: row.condition_op as NotificationCondition["operator"],
          value: row.condition_value,
        }
      : null;
  return {
    id: row.id,
    name: row.name,
    eventCode: row.event_code as EventCode,
    condition,
    recipientType: row.recipient_type as NotificationRecipientType,
    recipientValue: row.recipient_value,
    priority: row.priority as NotificationPriority,
    channels: row.channels.split(",").filter(Boolean) as NotificationChannel[],
    titleTemplate: row.title_template,
    bodyTemplate: row.body_template,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

class SqliteNotificationRuleStore implements NotificationRuleRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly deleteById: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO notification_rule (
         id, name, event_code, condition_field, condition_op, condition_value,
         recipient_type, recipient_value, priority, channels,
         title_template, body_template, enabled, created_at
       ) VALUES (
         @id, @name, @eventCode, @conditionField, @conditionOp, @conditionValue,
         @recipientType, @recipientValue, @priority, @channels,
         @titleTemplate, @bodyTemplate, @enabled, @createdAt
       )
       ON CONFLICT(id) DO UPDATE SET
         name = @name, event_code = @eventCode,
         condition_field = @conditionField, condition_op = @conditionOp,
         condition_value = @conditionValue, recipient_type = @recipientType,
         recipient_value = @recipientValue, priority = @priority,
         channels = @channels, title_template = @titleTemplate,
         body_template = @bodyTemplate, enabled = @enabled`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM notification_rule ORDER BY created_at ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM notification_rule WHERE id = ?`);
    this.deleteById = sqlite.prepare(`DELETE FROM notification_rule WHERE id = ?`);
  }

  async list(): Promise<NotificationRule[]> {
    return (this.selectAll.all() as NotificationRuleRow[]).map(toRule);
  }

  async findById(id: string): Promise<NotificationRule | null> {
    const row = this.selectById.get(id) as NotificationRuleRow | undefined;
    return row ? toRule(row) : null;
  }

  async save(rule: NotificationRule): Promise<void> {
    this.upsert.run({
      id: rule.id,
      name: rule.name,
      eventCode: rule.eventCode,
      conditionField: rule.condition?.field ?? null,
      conditionOp: rule.condition?.operator ?? null,
      conditionValue: rule.condition?.value ?? null,
      recipientType: rule.recipientType,
      recipientValue: rule.recipientValue,
      priority: rule.priority,
      channels: rule.channels.join(","),
      titleTemplate: rule.titleTemplate,
      bodyTemplate: rule.bodyTemplate,
      enabled: rule.enabled ? 1 : 0,
      createdAt: rule.createdAt,
    });
  }

  async delete(id: string): Promise<void> {
    this.deleteById.run(id);
  }
}

export interface SqliteNotificationRuleStoreHandle extends NotificationRuleRepository {
  close(): void;
}

/** Open a SQLite-backed NotificationRuleRepository. ":memory:" for tests, a path for real. */
export function createSqliteNotificationRuleStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteNotificationRuleStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteNotificationRuleStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteNotificationRuleStoreHandle;
}
