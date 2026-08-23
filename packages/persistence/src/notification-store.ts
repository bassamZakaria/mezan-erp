import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type {
  EventCode,
  Notification,
  NotificationChannel,
  NotificationListFilter,
  NotificationPriority,
  NotificationRepository,
} from "@mezan/domain";

/**
 * SQLite-backed NotificationRepository — the per-user read model behind the
 * shell's notifications bell. Read/unread is a per-row `read_at`, so two
 * recipients of the same rule read it independently.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS notification (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  rule_id    TEXT,
  event_code TEXT NOT NULL,
  channel    TEXT NOT NULL,
  priority   TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  reference  TEXT,
  created_at TEXT NOT NULL,
  read_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notification_user ON notification(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_unread ON notification(user_id, read_at);
`;

interface NotificationRow {
  id: string;
  user_id: string;
  rule_id: string | null;
  event_code: string;
  channel: string;
  priority: string;
  title: string;
  body: string;
  reference: string | null;
  created_at: string;
  read_at: string | null;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    ruleId: row.rule_id,
    eventCode: row.event_code as EventCode,
    channel: row.channel as NotificationChannel,
    priority: row.priority as NotificationPriority,
    title: row.title,
    body: row.body,
    reference: row.reference,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

const DEFAULT_LIMIT = 50;

class SqliteNotificationStore implements NotificationRepository {
  private readonly upsert: Database.Statement;
  private readonly selectForUser: Database.Statement;
  private readonly selectUnreadForUser: Database.Statement;
  private readonly countUnreadForUser: Database.Statement;
  private readonly selectOne: Database.Statement;
  private readonly markOneRead: Database.Statement;
  private readonly markAllReadForUser: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO notification (
         id, user_id, rule_id, event_code, channel, priority,
         title, body, reference, created_at, read_at
       ) VALUES (
         @id, @userId, @ruleId, @eventCode, @channel, @priority,
         @title, @body, @reference, @createdAt, @readAt
       )
       ON CONFLICT(id) DO UPDATE SET read_at = @readAt`,
    );
    this.selectForUser = sqlite.prepare(
      `SELECT * FROM notification WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    );
    this.selectUnreadForUser = sqlite.prepare(
      `SELECT * FROM notification WHERE user_id = ? AND read_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    );
    this.countUnreadForUser = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND read_at IS NULL`,
    );
    this.selectOne = sqlite.prepare(`SELECT * FROM notification WHERE id = ? AND user_id = ?`);
    this.markOneRead = sqlite.prepare(
      `UPDATE notification SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    );
    this.markAllReadForUser = sqlite.prepare(
      `UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
    );
  }

  async listForUser(userId: string, filter?: NotificationListFilter): Promise<Notification[]> {
    const limit = filter?.limit ?? DEFAULT_LIMIT;
    const statement = filter?.unreadOnly ? this.selectUnreadForUser : this.selectForUser;
    return (statement.all(userId, limit) as NotificationRow[]).map(toNotification);
  }

  async countUnread(userId: string): Promise<number> {
    const row = this.countUnreadForUser.get(userId) as { n: number };
    return row.n;
  }

  async save(notification: Notification): Promise<void> {
    this.upsert.run({
      id: notification.id,
      userId: notification.userId,
      ruleId: notification.ruleId,
      eventCode: notification.eventCode,
      channel: notification.channel,
      priority: notification.priority,
      title: notification.title,
      body: notification.body,
      reference: notification.reference,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    });
  }

  async markRead(
    userId: string,
    notificationId: string,
    readAt: string,
  ): Promise<Notification | null> {
    this.markOneRead.run(readAt, notificationId, userId);
    const row = this.selectOne.get(notificationId, userId) as NotificationRow | undefined;
    return row ? toNotification(row) : null;
  }

  async markAllRead(userId: string, readAt: string): Promise<number> {
    return this.markAllReadForUser.run(readAt, userId).changes;
  }
}

export interface SqliteNotificationStoreHandle extends NotificationRepository {
  close(): void;
}

/** Open a SQLite-backed NotificationRepository. ":memory:" for tests, a path for real. */
export function createSqliteNotificationStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteNotificationStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteNotificationStore(sqlite);
  return Object.assign(store, {
    close: () => {
      if (owned) sqlite.close();
    },
  }) as SqliteNotificationStoreHandle;
}
