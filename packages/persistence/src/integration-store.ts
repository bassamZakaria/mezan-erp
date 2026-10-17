import { WebhookDeliveryState as WebhookDeliveryStatusDTO, isApiKeyScope, type ApiKeyRecord, type ApiKeyScope as ApiKeyScopeDTO, type WebhookDeliveryRecord, type WebhookRecord } from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  active: number;
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
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_status_code: number | null;
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
    active: row.active === 1,
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
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastAttemptAt: row.last_attempt_at,
    lastStatusCode: row.last_status_code,
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

export interface SqliteIntegrationStore {
  readonly apiKeys: {
    insert(key: ApiKeyRecord): void;
    list(): ApiKeyRecord[];
    findById(id: string): ApiKeyRecord | null;
    findByLookup(lookup: string): ApiKeyRecord | null;
    revoke(id: string, at: string, by: string): boolean;
    touch(id: string, at: string): void;
    countUnrevoked(nowIso: string): number;
  };
  readonly webhooks: {
    insert(webhook: WebhookRecord): void;
    list(): WebhookRecord[];
    findById(id: string): WebhookRecord | null;
    save(webhook: WebhookRecord): void;
    subscribedTo(eventCode: string): WebhookRecord[];
    signingSecretOf(webhook: WebhookRecord): string;
    stats(): ReadonlyMap<string, WebhookDeliveryStats>;
  };
  readonly deliveries: {
    insert(delivery: WebhookDeliveryRecord): void;
    list(filter: WebhookDeliveryFilter): WebhookDeliveryRecord[];
    findById(id: string): WebhookDeliveryRecord | null;
    due(nowIso: string, limit: number): WebhookDeliveryRecord[];
    lease(id: string, expectedNextAttemptAt: string | null, leasedUntil: string): boolean;
    delivered(id: string, at: string, statusCode: number): void;
    failed(id: string, failure: WebhookAttemptFailure): void;
    skipped(id: string, at: string, reason: string): void;
  };
  close(): void;
}

const signingSecretContext = (webhookId: string): string => `integration_webhook:${webhookId}:signing_secret`;

// SECURITY: with a platform key the signing secret is sealed at rest and a record carries only the
// sealed text; `signingSecretOf` is the one place it is opened, at signing time. Without one (the
// desktop and unit tests) the column stays as it always was.
export function createSqliteIntegrationStore(input: SqliteConnectionInput, secrets?: SecretBox): SqliteIntegrationStore {
  const { sqlite, owned } = openSqliteConnection(input);
  sqlite.exec(CREATE_TABLES);
  const sealSigningSecret = (webhookId: string, value: string): string =>
    secrets && !isSealedSecret(value) ? secrets.seal(value, signingSecretContext(webhookId)) : value;
  if (secrets) {
    const plain = (sqlite.prepare(`SELECT id, signing_secret FROM integration_webhook`).all() as { id: string; signing_secret: string }[]).filter((row) => !isSealedSecret(row.signing_secret));
    const reseal = sqlite.prepare(`UPDATE integration_webhook SET signing_secret = ? WHERE id = ? AND signing_secret = ?`);
    sqlite.transaction(() => {
      for (const row of plain) reseal.run(sealSigningSecret(row.id, row.signing_secret), row.id, row.signing_secret);
    })();
  }

  const insertKey = sqlite.prepare(
    `INSERT INTO integration_api_key (id, name, lookup, token_hash, scopes, created_by, created_at, expires_at, last_used_at, revoked_at, revoked_by)
     VALUES (@id, @name, @lookup, @tokenHash, @scopes, @createdBy, @createdAt, @expiresAt, NULL, NULL, NULL)`,
  );
  const listKeys = sqlite.prepare(`SELECT * FROM integration_api_key ORDER BY created_at DESC, id`);
  const keyById = sqlite.prepare(`SELECT * FROM integration_api_key WHERE id = ?`);
  const keyByLookup = sqlite.prepare(`SELECT * FROM integration_api_key WHERE lookup = ?`);
  const revokeKey = sqlite.prepare(`UPDATE integration_api_key SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL`);
  const touchKey = sqlite.prepare(`UPDATE integration_api_key SET last_used_at = ? WHERE id = ?`);
  const countKeys = sqlite.prepare(
    `SELECT COUNT(*) AS n FROM integration_api_key WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
  );

  const insertWebhook = sqlite.prepare(
    `INSERT INTO integration_webhook (id, name, url, events, active, signing_secret, created_by, created_at, updated_at, secret_rotated_at)
     VALUES (@id, @name, @url, @events, @active, @signingSecret, @createdBy, @createdAt, @updatedAt, @secretRotatedAt)`,
  );
  const saveWebhook = sqlite.prepare(
    `UPDATE integration_webhook SET name = @name, url = @url, events = @events, active = @active, signing_secret = @signingSecret,
       updated_at = @updatedAt, secret_rotated_at = @secretRotatedAt WHERE id = @id`,
  );
  const listWebhooks = sqlite.prepare(`SELECT * FROM integration_webhook ORDER BY created_at, id`);
  const webhookById = sqlite.prepare(`SELECT * FROM integration_webhook WHERE id = ?`);
  const activeWebhooks = sqlite.prepare(`SELECT * FROM integration_webhook WHERE active = 1`);
  const webhookStats = sqlite.prepare(
    `SELECT webhook_id,
            SUM(CASE WHEN status = @pending THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = @dead THEN 1 ELSE 0 END) AS dead,
            MAX(delivered_at) AS last_delivered_at
       FROM integration_webhook_delivery GROUP BY webhook_id`,
  );

  const insertDelivery = sqlite.prepare(
    `INSERT INTO integration_webhook_delivery
       (id, webhook_id, event_code, payload, branch_ids, status, attempts, next_attempt_at, last_attempt_at, last_status_code, last_error, created_at, delivered_at, redelivery_of)
     VALUES (@id, @webhookId, @eventCode, @payload, @branchIds, @status, @attempts, @nextAttemptAt, @lastAttemptAt, @lastStatusCode, @lastError, @createdAt, @deliveredAt, @redeliveryOf)`,
  );
  const deliveryById = sqlite.prepare(`SELECT * FROM integration_webhook_delivery WHERE id = ?`);
  const dueDeliveries = sqlite.prepare(
    `SELECT d.* FROM integration_webhook_delivery d JOIN integration_webhook w ON w.id = d.webhook_id
      WHERE d.status = ? AND d.next_attempt_at <= ? AND w.active = 1
      ORDER BY d.next_attempt_at, d.id LIMIT ?`,
  );
  const leaseDelivery = sqlite.prepare(
    `UPDATE integration_webhook_delivery SET next_attempt_at = @leasedUntil
      WHERE id = @id AND status = @pending AND next_attempt_at IS @expected`,
  );
  const markDelivered = sqlite.prepare(
    `UPDATE integration_webhook_delivery SET status = @status, attempts = attempts + 1, last_attempt_at = @at, delivered_at = @at,
       last_status_code = @statusCode, last_error = NULL, next_attempt_at = NULL WHERE id = @id`,
  );
  const markFailed = sqlite.prepare(
    `UPDATE integration_webhook_delivery SET status = @status, attempts = attempts + 1, last_attempt_at = @at,
       last_status_code = @statusCode, last_error = @error, next_attempt_at = @nextAttemptAt WHERE id = @id`,
  );
  const markSkipped = sqlite.prepare(
    `UPDATE integration_webhook_delivery SET status = @status, last_attempt_at = @at, last_error = @error, next_attempt_at = NULL WHERE id = @id`,
  );

  return {
    apiKeys: {
      insert(key) {
        insertKey.run({
          id: key.id,
          name: key.name,
          lookup: key.lookup,
          tokenHash: key.tokenHash,
          scopes: JSON.stringify(key.scopes),
          createdBy: key.createdBy,
          createdAt: key.createdAt,
          expiresAt: key.expiresAt,
        });
      },
      list: () => (listKeys.all() as ApiKeyRow[]).map(apiKeyOf),
      findById(id) {
        const row = keyById.get(id) as ApiKeyRow | undefined;
        return row ? apiKeyOf(row) : null;
      },
      findByLookup(lookup) {
        const row = keyByLookup.get(lookup) as ApiKeyRow | undefined;
        return row ? apiKeyOf(row) : null;
      },
      revoke: (id, at, by) => revokeKey.run(at, by, id).changes === 1,
      touch(id, at) {
        touchKey.run(at, id);
      },
      countUnrevoked: (nowIso) => (countKeys.get(nowIso) as { n: number }).n,
    },
    webhooks: {
      insert(webhook) {
        insertWebhook.run({ ...webhook, signingSecret: sealSigningSecret(webhook.id, webhook.signingSecret), events: JSON.stringify(webhook.events), active: webhook.active ? 1 : 0 });
      },
      list: () => (listWebhooks.all() as WebhookRow[]).map(webhookOf),
      findById(id) {
        const row = webhookById.get(id) as WebhookRow | undefined;
        return row ? webhookOf(row) : null;
      },
      save(webhook) {
        saveWebhook.run({
          id: webhook.id,
          name: webhook.name,
          url: webhook.url,
          events: JSON.stringify(webhook.events),
          active: webhook.active ? 1 : 0,
          signingSecret: sealSigningSecret(webhook.id, webhook.signingSecret),
          updatedAt: webhook.updatedAt,
          secretRotatedAt: webhook.secretRotatedAt,
        });
      },
      signingSecretOf(webhook) {
        if (!isSealedSecret(webhook.signingSecret)) return webhook.signingSecret;
        if (!secrets) throw new SecretUnsealError();
        return secrets.open(webhook.signingSecret, signingSecretContext(webhook.id));
      },
      subscribedTo: (eventCode) => (activeWebhooks.all() as WebhookRow[]).map(webhookOf).filter((w) => w.events.includes(eventCode)),
      stats() {
        const rows = webhookStats.all({ pending: WebhookDeliveryStatusDTO.Pending, dead: WebhookDeliveryStatusDTO.DeadLetter }) as {
          webhook_id: string;
          pending: number | null;
          dead: number | null;
          last_delivered_at: string | null;
        }[];
        return new Map(rows.map((r) => [r.webhook_id, { pending: r.pending ?? 0, deadLetters: r.dead ?? 0, lastDeliveredAt: r.last_delivered_at }]));
      },
    },
    deliveries: {
      insert(delivery) {
        insertDelivery.run({ ...delivery, branchIds: JSON.stringify(delivery.branchIds) });
      },
      list(filter) {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.webhookId) {
          where.push("webhook_id = ?");
          params.push(filter.webhookId);
        }
        if (filter.status) {
          where.push("status = ?");
          params.push(filter.status);
        }
        const sql = `SELECT * FROM integration_webhook_delivery ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
        return (sqlite.prepare(sql).all(...params, filter.limit) as DeliveryRow[]).map(deliveryOf);
      },
      findById(id) {
        const row = deliveryById.get(id) as DeliveryRow | undefined;
        return row ? deliveryOf(row) : null;
      },
      due: (nowIso, limit) => (dueDeliveries.all(WebhookDeliveryStatusDTO.Pending, nowIso, limit) as DeliveryRow[]).map(deliveryOf),
      lease: (id, expected, leasedUntil) =>
        leaseDelivery.run({ id, expected, leasedUntil, pending: WebhookDeliveryStatusDTO.Pending }).changes === 1,
      delivered(id, at, statusCode) {
        markDelivered.run({ id, at, statusCode, status: WebhookDeliveryStatusDTO.Delivered });
      },
      failed(id, failure) {
        markFailed.run({ id, at: failure.at, statusCode: failure.statusCode, error: failure.error, status: failure.status, nextAttemptAt: failure.nextAttemptAt });
      },
      skipped(id, at, reason) {
        markSkipped.run({ id, at, error: reason, status: WebhookDeliveryStatusDTO.Skipped });
      },
    },
    close() {
      if (owned) sqlite.close();
    },
  };
}
