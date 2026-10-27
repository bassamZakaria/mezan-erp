import { WebhookDeliveryState as WebhookDeliveryStatusDTO, isApiKeyScope, type ApiKeyRecord, type ApiKeyScope as ApiKeyScopeDTO, type WebhookDeliveryRecord, type WebhookRecord } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import { isSealedSecret, SecretUnsealError, type SecretBox } from "./secret-box.js";

// DEC-17 drops `api_key`, `webhook` and `webhook_delivery` on every open (create-backend.ts):
// these tables must never take those names.
const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS integration_api_key (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  lookup        TEXT NOT NULL UNIQUE,
  token_hash    TEXT NOT NULL,
  scopes        TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT,
  last_used_at  TEXT,
  revoked_at    TEXT,
  revoked_by    TEXT
);

CREATE TABLE IF NOT EXISTS integration_webhook (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  url                TEXT NOT NULL,
  events             TEXT NOT NULL,
  active             INTEGER NOT NULL,
  signing_secret     TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  secret_rotated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_webhook_delivery (
  id                TEXT PRIMARY KEY,
  webhook_id        TEXT NOT NULL,
  event_code        TEXT NOT NULL,
  payload           TEXT NOT NULL,
  branch_ids        TEXT NOT NULL,
  status            TEXT NOT NULL,
  attempts          INTEGER NOT NULL,
  next_attempt_at   TEXT,
  last_attempt_at   TEXT,
  last_status_code  INTEGER,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  delivered_at      TEXT,
  redelivery_of     TEXT
);
CREATE INDEX IF NOT EXISTS idx_integration_delivery_due ON integration_webhook_delivery(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_integration_delivery_webhook ON integration_webhook_delivery(webhook_id, created_at);
`;

interface ApiKeyRow {
  id: string;
  name: string;
  lookup: string;
  token_hash: string;
  scopes: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string;
  active: bigint;
  signing_secret: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  secret_rotated_at: string;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event_code: string;
  payload: string;
  branch_ids: string;
  status: string;
  attempts: bigint;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_status_code: bigint | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  redelivery_of: string | null;
}

function stringArray(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

function apiKeyOf(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    lookup: row.lookup,
    tokenHash: row.token_hash,
    scopes: stringArray(row.scopes).filter(isApiKeyScope) as ApiKeyScopeDTO[],
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

function webhookOf(row: WebhookRow): WebhookRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: stringArray(row.events),
    active: Number(row.active) === 1,
    signingSecret: row.signing_secret,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretRotatedAt: row.secret_rotated_at,
  };
}

const DELIVERY_STATUSES: ReadonlySet<string> = new Set(Object.values(WebhookDeliveryStatusDTO));

function deliveryOf(row: DeliveryRow): WebhookDeliveryRecord {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    eventCode: row.event_code,
    payload: row.payload,
    branchIds: stringArray(row.branch_ids),
    status: DELIVERY_STATUSES.has(row.status) ? (row.status as WebhookDeliveryStatusDTO) : WebhookDeliveryStatusDTO.DeadLetter,
    attempts: Number(row.attempts),
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    lastStatusCode: row.last_status_code === null ? null : Number(row.last_status_code),
    lastError: row.last_error,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    redeliveryOf: row.redelivery_of,
  };
}

export interface WebhookDeliveryStats {
  readonly pending: number;
  readonly deadLetters: number;
  readonly lastDeliveredAt: string | null;
}

export interface WebhookDeliveryFilter {
  readonly webhookId?: string;
  readonly status?: WebhookDeliveryStatusDTO;
  readonly limit: number;
}

export interface WebhookAttemptFailure {
  readonly at: string;
  readonly statusCode: number | null;
  readonly error: string;
  readonly status: WebhookDeliveryStatusDTO;
  readonly nextAttemptAt: string | null;
}

export interface IntegrationStore {
  readonly apiKeys: {
    insert(key: ApiKeyRecord): Promise<void>;
    list(): Promise<ApiKeyRecord[]>;
    findById(id: string): Promise<ApiKeyRecord | null>;
    findByLookup(lookup: string): Promise<ApiKeyRecord | null>;
    revoke(id: string, at: string, by: string): Promise<boolean>;
    touch(id: string, at: string): Promise<void>;
    countUnrevoked(nowIso: string): Promise<number>;
  };
  readonly webhooks: {
    insert(webhook: WebhookRecord): Promise<void>;
    list(): Promise<WebhookRecord[]>;
    findById(id: string): Promise<WebhookRecord | null>;
    save(webhook: WebhookRecord): Promise<void>;
    subscribedTo(eventCode: string): Promise<WebhookRecord[]>;
    signingSecretOf(webhook: WebhookRecord): string;
    stats(): Promise<ReadonlyMap<string, WebhookDeliveryStats>>;
  };
  readonly deliveries: {
    insert(delivery: WebhookDeliveryRecord): Promise<void>;
    list(filter: WebhookDeliveryFilter): Promise<WebhookDeliveryRecord[]>;
    findById(id: string): Promise<WebhookDeliveryRecord | null>;
    due(nowIso: string, limit: number): Promise<WebhookDeliveryRecord[]>;
    lease(id: string, expectedNextAttemptAt: string | null, leasedUntil: string): Promise<boolean>;
    delivered(id: string, at: string, statusCode: number): Promise<void>;
    failed(id: string, failure: WebhookAttemptFailure): Promise<void>;
    skipped(id: string, at: string, reason: string): Promise<void>;
  };
}

export interface SqliteIntegrationStore extends IntegrationStore {
  close(): void;
}

const signingSecretContext = (webhookId: string): string => `integration_webhook:${webhookId}:signing_secret`;

export async function ensureIntegrationSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

enum ApiKeyLookupColumn {
  Id = "id",
  Lookup = "lookup",
}

const DELIVERY_COLUMNS = "id, webhook_id, event_code, payload, branch_ids, status, attempts, next_attempt_at, last_attempt_at, last_status_code, last_error, created_at, delivered_at, redelivery_of";

// SECURITY: with a platform key the signing secret is sealed at rest and a record carries only the
// sealed text; `signingSecretOf` is the one place it is opened, at signing time. Without one (the
// desktop and unit tests) the column stays as it always was.
export function createIntegrationStore(db: SqlDb, secrets?: SecretBox): IntegrationStore {
  const sealSigningSecret = (webhookId: string, value: string): string =>
    secrets && !isSealedSecret(value) ? secrets.seal(value, signingSecretContext(webhookId)) : value;
  const apiKey = async (column: ApiKeyLookupColumn, value: string): Promise<ApiKeyRecord | null> => {
    const row = await db.get<ApiKeyRow>(`SELECT * FROM integration_api_key WHERE ${column} = ?`, [value]);
    return row ? apiKeyOf(row) : null;
  };

  return {
    apiKeys: {
      async insert(key) {
        await db.run(
          `INSERT INTO integration_api_key (id, name, lookup, token_hash, scopes, created_by, created_at, expires_at, last_used_at, revoked_at, revoked_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
          [key.id, key.name, key.lookup, key.tokenHash, JSON.stringify(key.scopes), key.createdBy, key.createdAt, key.expiresAt],
        );
      },
      list: async () => (await db.all<ApiKeyRow>(`SELECT * FROM integration_api_key ORDER BY created_at DESC, id`)).map(apiKeyOf),
      findById: (id) => apiKey(ApiKeyLookupColumn.Id, id),
      findByLookup: (lookup) => apiKey(ApiKeyLookupColumn.Lookup, lookup),
      revoke: async (id, at, by) => (await db.run(`UPDATE integration_api_key SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL`, [at, by, id])).changes === 1,
      async touch(id, at) {
        await db.run(`UPDATE integration_api_key SET last_used_at = ? WHERE id = ?`, [at, id]);
      },
      countUnrevoked: async (nowIso) =>
        Number(
          (await db.get<{ n: bigint }>(`SELECT COUNT(*) AS n FROM integration_api_key WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`, [nowIso]))!.n,
        ),
    },
    webhooks: {
      async insert(webhook) {
        await db.run(
          `INSERT INTO integration_webhook (id, name, url, events, active, signing_secret, created_by, created_at, updated_at, secret_rotated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            webhook.id,
            webhook.name,
            webhook.url,
            JSON.stringify(webhook.events),
            webhook.active ? 1 : 0,
            sealSigningSecret(webhook.id, webhook.signingSecret),
            webhook.createdBy,
            webhook.createdAt,
            webhook.updatedAt,
            webhook.secretRotatedAt,
          ],
        );
      },
      list: async () => (await db.all<WebhookRow>(`SELECT * FROM integration_webhook ORDER BY created_at, id`)).map(webhookOf),
      async findById(id) {
        const row = await db.get<WebhookRow>(`SELECT * FROM integration_webhook WHERE id = ?`, [id]);
        return row ? webhookOf(row) : null;
      },
      async save(webhook) {
        await db.run(
          `UPDATE integration_webhook SET name = ?, url = ?, events = ?, active = ?, signing_secret = ?,
             updated_at = ?, secret_rotated_at = ? WHERE id = ?`,
          [
            webhook.name,
            webhook.url,
            JSON.stringify(webhook.events),
            webhook.active ? 1 : 0,
            sealSigningSecret(webhook.id, webhook.signingSecret),
            webhook.updatedAt,
            webhook.secretRotatedAt,
            webhook.id,
          ],
        );
      },
      signingSecretOf(webhook) {
        if (!isSealedSecret(webhook.signingSecret)) return webhook.signingSecret;
        if (!secrets) throw new SecretUnsealError();
        return secrets.open(webhook.signingSecret, signingSecretContext(webhook.id));
      },
      subscribedTo: async (eventCode) =>
        (await db.all<WebhookRow>(`SELECT * FROM integration_webhook WHERE active = 1`)).map(webhookOf).filter((w) => w.events.includes(eventCode)),
      async stats() {
        const rows = await db.all<{ webhook_id: string; pending: bigint | null; dead: bigint | null; last_delivered_at: string | null }>(
          `SELECT webhook_id,
                  SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS pending,
                  SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS dead,
                  MAX(delivered_at) AS last_delivered_at
             FROM integration_webhook_delivery GROUP BY webhook_id`,
          [WebhookDeliveryStatusDTO.Pending, WebhookDeliveryStatusDTO.DeadLetter],
        );
        return new Map(rows.map((r) => [r.webhook_id, { pending: Number(r.pending ?? 0), deadLetters: Number(r.dead ?? 0), lastDeliveredAt: r.last_delivered_at }]));
      },
    },
    deliveries: {
      async insert(delivery) {
        await db.run(`INSERT INTO integration_webhook_delivery (${DELIVERY_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          delivery.id,
          delivery.webhookId,
          delivery.eventCode,
          delivery.payload,
          JSON.stringify(delivery.branchIds),
          delivery.status,
          delivery.attempts,
          delivery.nextAttemptAt,
          delivery.lastAttemptAt,
          delivery.lastStatusCode,
          delivery.lastError,
          delivery.createdAt,
          delivery.deliveredAt,
          delivery.redeliveryOf,
        ]);
      },
      async list(filter) {
        const where: string[] = [];
        const params: SqlValue[] = [];
        if (filter.webhookId) {
          where.push("webhook_id = ?");
          params.push(filter.webhookId);
        }
        if (filter.status) {
          where.push("status = ?");
          params.push(filter.status);
        }
        const sql = `SELECT ${DELIVERY_COLUMNS} FROM integration_webhook_delivery ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
        return (await db.all<DeliveryRow>(sql, [...params, filter.limit])).map(deliveryOf);
      },
      async findById(id) {
        const row = await db.get<DeliveryRow>(`SELECT ${DELIVERY_COLUMNS} FROM integration_webhook_delivery WHERE id = ?`, [id]);
        return row ? deliveryOf(row) : null;
      },
      due: async (nowIso, limit) =>
        (
          await db.all<DeliveryRow>(
            `SELECT d.* FROM integration_webhook_delivery d JOIN integration_webhook w ON w.id = d.webhook_id
              WHERE d.status = ? AND d.next_attempt_at <= ? AND w.active = 1
              ORDER BY d.next_attempt_at, d.id LIMIT ?`,
            [WebhookDeliveryStatusDTO.Pending, nowIso, limit],
          )
        ).map(deliveryOf),
      lease: async (id, expected, leasedUntil) =>
        (
          await db.run(
            `UPDATE integration_webhook_delivery SET next_attempt_at = ?
              WHERE id = ? AND status = ? AND next_attempt_at IS NOT DISTINCT FROM ?`,
            [leasedUntil, id, WebhookDeliveryStatusDTO.Pending, expected],
          )
        ).changes === 1,
      async delivered(id, at, statusCode) {
        await db.run(
          `UPDATE integration_webhook_delivery SET status = ?, attempts = attempts + 1, last_attempt_at = ?, delivered_at = ?,
             last_status_code = ?, last_error = NULL, next_attempt_at = NULL WHERE id = ?`,
          [WebhookDeliveryStatusDTO.Delivered, at, at, statusCode, id],
        );
      },
      async failed(id, failure) {
        await db.run(
          `UPDATE integration_webhook_delivery SET status = ?, attempts = attempts + 1, last_attempt_at = ?,
             last_status_code = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
          [failure.status, failure.at, failure.statusCode, failure.error, failure.nextAttemptAt, id],
        );
      },
      async skipped(id, at, reason) {
        await db.run(
          `UPDATE integration_webhook_delivery SET status = ?, last_attempt_at = ?, last_error = ?, next_attempt_at = NULL WHERE id = ?`,
          [WebhookDeliveryStatusDTO.Skipped, at, reason, id],
        );
      },
    },
  };
}

export function createSqliteIntegrationStore(input: SqliteConnectionInput, secrets?: SecretBox): SqliteIntegrationStore {
  const { sqlite, owned } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLES);
  if (secrets) {
    const plain = (sqlite.prepare(`SELECT id, signing_secret FROM integration_webhook`).all() as { id: string; signing_secret: string }[]).filter((row) => !isSealedSecret(row.signing_secret));
    const reseal = sqlite.prepare(`UPDATE integration_webhook SET signing_secret = ? WHERE id = ? AND signing_secret = ?`);
    sqlite.transaction(() => {
      for (const row of plain) reseal.run(secrets.seal(row.signing_secret, signingSecretContext(row.id)), row.id, row.signing_secret);
    })();
  }
  return Object.assign(createIntegrationStore(sqliteDb(sqlite), secrets), {
    close() {
      if (owned) sqlite.close();
    },
  });
}
