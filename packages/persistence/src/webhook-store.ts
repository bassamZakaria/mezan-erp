import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { Webhook, WebhookRepository, WebhookDeliveryAttempt, WebhookDeliveryRepository } from "@mezan/domain";

/**
 * SQLite-backed WebhookRepository + WebhookDeliveryRepository. `secret` is
 * stored in the clear (see `webhooks/webhook.ts` doc comment — a real
 * dispatcher needs it to HMAC-sign every delivery); the API layer is what
 * withholds it from every response after creation, not this store.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS webhook (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  target_url  TEXT NOT NULL,
  events      TEXT NOT NULL,
  secret      TEXT NOT NULL,
  active      INTEGER NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_delivery (
  id            TEXT PRIMARY KEY,
  webhook_id    TEXT NOT NULL REFERENCES webhook(id),
  event_code    TEXT NOT NULL,
  attempted_at  TEXT NOT NULL,
  status_code   INTEGER,
  success       INTEGER NOT NULL,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_webhook ON webhook_delivery(webhook_id, attempted_at DESC);
`;

interface WebhookRow {
  id: string;
  name: string;
  target_url: string;
  events: string;
  secret: string;
  active: number;
  created_by: string;
  created_at: string;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event_code: string;
  attempted_at: string;
  status_code: number | null;
  success: number;
  error_message: string | null;
}

function toWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    name: row.name,
    targetUrl: row.target_url,
    events: JSON.parse(row.events) as string[],
    secret: row.secret,
    active: row.active === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toDelivery(row: DeliveryRow): WebhookDeliveryAttempt {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    eventCode: row.event_code,
    attemptedAt: row.attempted_at,
    statusCode: row.status_code,
    success: row.success === 1,
    errorMessage: row.error_message,
  };
}

class SqliteWebhookStore implements WebhookRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO webhook (id, name, target_url, events, secret, active, created_by, created_at)
       VALUES (@id, @name, @targetUrl, @events, @secret, @active, @createdBy, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, target_url = @targetUrl, events = @events, secret = @secret,
         active = @active, created_by = @createdBy, created_at = @createdAt`,
    );
    this.selectAll = sqlite.prepare(`SELECT * FROM webhook ORDER BY created_at DESC`);
    this.selectById = sqlite.prepare(`SELECT * FROM webhook WHERE id = ?`);
  }

  async list(): Promise<Webhook[]> {
    return (this.selectAll.all() as WebhookRow[]).map(toWebhook);
  }

  async findById(id: string): Promise<Webhook | null> {
    const row = this.selectById.get(id) as WebhookRow | undefined;
    return row ? toWebhook(row) : null;
  }

  async save(webhook: Webhook): Promise<void> {
    this.upsert.run({
      id: webhook.id,
      name: webhook.name,
      targetUrl: webhook.targetUrl,
      events: JSON.stringify(webhook.events),
      secret: webhook.secret,
      active: webhook.active ? 1 : 0,
      createdBy: webhook.createdBy,
      createdAt: webhook.createdAt,
    });
  }
}

class SqliteWebhookDeliveryStore implements WebhookDeliveryRepository {
  private readonly insert: Database.Statement;
  private readonly selectForWebhook: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insert = sqlite.prepare(
      `INSERT INTO webhook_delivery (id, webhook_id, event_code, attempted_at, status_code, success, error_message)
       VALUES (@id, @webhookId, @eventCode, @attemptedAt, @statusCode, @success, @errorMessage)`,
    );
    this.selectForWebhook = sqlite.prepare(
      `SELECT * FROM webhook_delivery WHERE webhook_id = ? ORDER BY attempted_at DESC LIMIT ?`,
    );
  }

  async listForWebhook(webhookId: string, limit = 50): Promise<WebhookDeliveryAttempt[]> {
    return (this.selectForWebhook.all(webhookId, limit) as DeliveryRow[]).map(toDelivery);
  }

  async record(attempt: WebhookDeliveryAttempt): Promise<void> {
    this.insert.run({
      id: attempt.id,
      webhookId: attempt.webhookId,
      eventCode: attempt.eventCode,
      attemptedAt: attempt.attemptedAt,
      statusCode: attempt.statusCode,
      success: attempt.success ? 1 : 0,
      errorMessage: attempt.errorMessage,
    });
  }
}

export interface SqliteWebhookStoresHandle {
  readonly webhooks: WebhookRepository;
  readonly deliveries: WebhookDeliveryRepository;
  close(): void;
}

/** Open SQLite-backed WebhookRepository + WebhookDeliveryRepository sharing one connection. ":memory:" for tests, a path for real. */
export function createSqliteWebhookStores(path: SqliteConnectionInput = ":memory:"): SqliteWebhookStoresHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return {
    webhooks: new SqliteWebhookStore(sqlite),
    deliveries: new SqliteWebhookDeliveryStore(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
