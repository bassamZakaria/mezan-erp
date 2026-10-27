import { randomUUID } from "node:crypto";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { MAX_BOUND_PARAMS } from "./list-query.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  CustomerMessageStatus,
  DunningChannel,
  DunningReminderStatus,
  DunningVoidReason,
  Money,
  type CollectionActivity,
  type CollectionActivityKind,
  type CollectionActivityRepository,
  type CollectionHold,
  type CollectionHoldRepository,
  type CustomerMessage,
  type CustomerMessageOutbox,
  type DunningPolicy,
  type DunningPolicyRepository,
  type DunningReminder,
  type DunningReminderListFilter,
  type DunningReminderRepository,
  type DunningStep,
  type PromiseToPay,
  type PromiseToPayRepository,
} from "@mezan/domain";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS dunning_policy (
  id                  TEXT PRIMARY KEY,
  steps_json          TEXT NOT NULL,
  auto_send_enabled   INTEGER NOT NULL,
  minimum_overdue     TEXT NOT NULL,
  pause_on_promise    INTEGER NOT NULL,
  last_scheduled_run  TEXT,
  updated_at          TEXT,
  updated_by          TEXT
);

CREATE TABLE IF NOT EXISTS dunning_reminder (
  id              TEXT PRIMARY KEY,
  item_key        TEXT NOT NULL,
  step_id         TEXT NOT NULL,
  step_level      INTEGER NOT NULL,
  customer_id     TEXT NOT NULL,
  document_id     TEXT,
  reference       TEXT,
  channel         TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  amount          TEXT NOT NULL,
  days_overdue    INTEGER NOT NULL,
  due_date        TEXT NOT NULL,
  status          TEXT NOT NULL,
  void_reason     TEXT,
  failure_reason  TEXT,
  message_id      TEXT,
  prepared_on     TEXT NOT NULL,
  prepared_at     TEXT NOT NULL,
  prepared_by     TEXT NOT NULL,
  sent_at         TEXT,
  sent_by         TEXT,
  outcome         TEXT,
  UNIQUE(item_key, step_id)
);
CREATE INDEX IF NOT EXISTS idx_dunning_reminder_customer ON dunning_reminder(customer_id);
CREATE INDEX IF NOT EXISTS idx_dunning_reminder_status ON dunning_reminder(status);

CREATE TABLE IF NOT EXISTS promise_to_pay (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL,
  promised_date  TEXT NOT NULL,
  amount         TEXT NOT NULL,
  invoice_ids    TEXT NOT NULL,
  note           TEXT,
  created_on     TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  created_by     TEXT NOT NULL,
  cancelled_at   TEXT,
  cancelled_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_promise_to_pay_customer ON promise_to_pay(customer_id);

CREATE TABLE IF NOT EXISTS collection_activity (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  text         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_activity_customer ON collection_activity(customer_id);

CREATE TABLE IF NOT EXISTS collection_hold (
  customer_id  TEXT PRIMARY KEY,
  reason       TEXT NOT NULL,
  until        TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_message (
  id              TEXT PRIMARY KEY,
  customer_id     TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL,
  failure_reason  TEXT,
  created_at      TEXT NOT NULL,
  sent_at         TEXT,
  claim_token     TEXT,
  claimed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_message_status ON customer_message(status);
`;

const DEFAULT_POLICY_ID = "default";
const ACTIVITY_DEFAULT_LIMIT = 200;
const REMINDER_DEFAULT_LIMIT = 500;

interface PolicyRow {
  steps_json: string;
  auto_send_enabled: bigint;
  minimum_overdue: string;
  pause_on_promise: bigint;
  last_scheduled_run: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

class SqlPolicyRepository implements DunningPolicyRepository {
  constructor(private readonly db: SqlDb) {}

  async get(): Promise<DunningPolicy | null> {
    const row = await this.db.get<PolicyRow>(`SELECT * FROM dunning_policy WHERE id = ?`, [DEFAULT_POLICY_ID]);
    if (!row) return null;
    return {
      steps: JSON.parse(row.steps_json) as DunningStep[],
      autoSendEnabled: Number(row.auto_send_enabled) === 1,
      minimumOverdueAmount: Money.fromMajor(row.minimum_overdue),
      pauseWhilePromisePending: Number(row.pause_on_promise) === 1,
      lastScheduledRunDate: row.last_scheduled_run,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  async save(policy: DunningPolicy): Promise<void> {
    await this.db.run(
      `INSERT INTO dunning_policy (id, steps_json, auto_send_enabled, minimum_overdue, pause_on_promise, last_scheduled_run, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         steps_json = excluded.steps_json,
         auto_send_enabled = excluded.auto_send_enabled,
         minimum_overdue = excluded.minimum_overdue,
         pause_on_promise = excluded.pause_on_promise,
         last_scheduled_run = excluded.last_scheduled_run,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
      [
        DEFAULT_POLICY_ID,
        JSON.stringify(policy.steps),
        policy.autoSendEnabled ? 1 : 0,
        policy.minimumOverdueAmount.toString(),
        policy.pauseWhilePromisePending ? 1 : 0,
        policy.lastScheduledRunDate,
        policy.updatedAt,
        policy.updatedBy,
      ],
    );
  }
}

interface ReminderRow {
  id: string;
  item_key: string;
  step_id: string;
  step_level: bigint;
  customer_id: string;
  document_id: string | null;
  reference: string | null;
  channel: string;
  subject: string;
  body: string;
  amount: string;
  days_overdue: bigint;
  due_date: string;
  status: string;
  void_reason: string | null;
  failure_reason: string | null;
  message_id: string | null;
  prepared_on: string;
  prepared_at: string;
  prepared_by: string;
  sent_at: string | null;
  sent_by: string | null;
  outcome: string | null;
}

function toReminder(row: ReminderRow): DunningReminder {
  return {
    id: row.id,
    itemKey: row.item_key,
    stepId: row.step_id,
    stepLevel: Number(row.step_level),
    customerId: row.customer_id,
    documentId: row.document_id,
    reference: row.reference,
    channel: row.channel as DunningChannel,
    subject: row.subject,
    body: row.body,
    amount: Money.fromMajor(row.amount),
    daysOverdue: Number(row.days_overdue),
    dueDate: row.due_date,
    status: row.status as DunningReminderStatus,
    voidReason: row.void_reason as DunningVoidReason | null,
    failureReason: row.failure_reason,
    messageId: row.message_id,
    preparedOn: row.prepared_on,
    preparedAt: row.prepared_at,
    preparedBy: row.prepared_by,
    sentAt: row.sent_at,
    sentBy: row.sent_by,
    outcome: row.outcome,
  };
}

const REMINDER_COLUMNS =
  "id, item_key, step_id, step_level, customer_id, document_id, reference, channel, subject, body, amount, days_overdue, due_date, status, void_reason, failure_reason, message_id, prepared_on, prepared_at, prepared_by, sent_at, sent_by, outcome";

function reminderParams(r: DunningReminder): SqlValue[] {
  return [
    r.id,
    r.itemKey,
    r.stepId,
    r.stepLevel,
    r.customerId,
    r.documentId,
    r.reference,
    r.channel,
    r.subject,
    r.body,
    r.amount.toString(),
    r.daysOverdue,
    r.dueDate,
    r.status,
    r.voidReason,
    r.failureReason,
    r.messageId,
    r.preparedOn,
    r.preparedAt,
    r.preparedBy,
    r.sentAt,
    r.sentBy,
    r.outcome,
  ];
}

class SqlReminderRepository implements DunningReminderRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<DunningReminder | null> {
    const row = await this.db.get<ReminderRow>(`SELECT * FROM dunning_reminder WHERE id = ?`, [id]);
    return row ? toReminder(row) : null;
  }

  async list(filter: DunningReminderListFilter = {}): Promise<readonly DunningReminder[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.customerId !== undefined) {
      clauses.push("customer_id = ?");
      params.push(filter.customerId);
    }
    if (filter.statuses !== undefined) {
      if (filter.statuses.length === 0) return [];
      clauses.push(`status IN (${placeholders(filter.statuses.length)})`);
      params.push(...filter.statuses);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.db.all<ReminderRow>(
      `SELECT * FROM dunning_reminder ${where} ORDER BY prepared_at DESC, step_level DESC LIMIT ?`,
      [...params, filter.limit ?? REMINDER_DEFAULT_LIMIT],
    );
    return rows.map(toReminder);
  }

  async insertIfAbsent(reminder: DunningReminder): Promise<boolean> {
    const result = await this.db.run(
      `INSERT INTO dunning_reminder (${REMINDER_COLUMNS}) VALUES (${placeholders(23)})
       ON CONFLICT(item_key, step_id) DO NOTHING`,
      reminderParams(reminder),
    );
    return result.changes === 1;
  }

  async update(reminder: DunningReminder): Promise<void> {
    await this.db.run(
      `UPDATE dunning_reminder SET
         status = ?, void_reason = ?, failure_reason = ?, message_id = ?,
         sent_at = ?, sent_by = ?, outcome = ?
       WHERE id = ?`,
      [
        reminder.status,
        reminder.voidReason,
        reminder.failureReason,
        reminder.messageId,
        reminder.sentAt,
        reminder.sentBy,
        reminder.outcome,
        reminder.id,
      ],
    );
  }
}

interface PromiseRow {
  id: string;
  customer_id: string;
  promised_date: string;
  amount: string;
  invoice_ids: string;
  note: string | null;
  created_on: string;
  created_at: string;
  created_by: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

function toPromise(row: PromiseRow): PromiseToPay {
  return {
    id: row.id,
    customerId: row.customer_id,
    promisedDate: row.promised_date,
    amount: Money.fromMajor(row.amount),
    invoiceIds: JSON.parse(row.invoice_ids) as string[],
    note: row.note,
    createdOn: row.created_on,
    createdAt: row.created_at,
    createdBy: row.created_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
  };
}

class SqlPromiseRepository implements PromiseToPayRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<PromiseToPay | null> {
    const row = await this.db.get<PromiseRow>(`SELECT * FROM promise_to_pay WHERE id = ?`, [id]);
    return row ? toPromise(row) : null;
  }

  async list(filter: { readonly customerId?: string } = {}): Promise<readonly PromiseToPay[]> {
    const rows =
      filter.customerId !== undefined
        ? await this.db.all<PromiseRow>(`SELECT * FROM promise_to_pay WHERE customer_id = ? ORDER BY created_at DESC`, [filter.customerId])
        : await this.db.all<PromiseRow>(`SELECT * FROM promise_to_pay ORDER BY created_at DESC`);
    return rows.map(toPromise);
  }

  async save(promise: PromiseToPay): Promise<void> {
    await this.db.run(
      `INSERT INTO promise_to_pay (id, customer_id, promised_date, amount, invoice_ids, note, created_on, created_at, created_by, cancelled_at, cancelled_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET cancelled_at = excluded.cancelled_at, cancelled_by = excluded.cancelled_by`,
      [
        promise.id,
        promise.customerId,
        promise.promisedDate,
        promise.amount.toString(),
        JSON.stringify(promise.invoiceIds),
        promise.note,
        promise.createdOn,
        promise.createdAt,
        promise.createdBy,
        promise.cancelledAt,
        promise.cancelledBy,
      ],
    );
  }
}

interface ActivityRow {
  id: string;
  customer_id: string;
  kind: string;
  text: string;
  created_at: string;
  created_by: string;
}

class SqlActivityRepository implements CollectionActivityRepository {
  constructor(private readonly db: SqlDb) {}

  async list(filter: { readonly customerId?: string; readonly limit?: number } = {}): Promise<readonly CollectionActivity[]> {
    const limit = filter.limit ?? ACTIVITY_DEFAULT_LIMIT;
    const rows =
      filter.customerId !== undefined
        ? await this.db.all<ActivityRow>(`SELECT * FROM collection_activity WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?`, [filter.customerId, limit])
        : await this.db.all<ActivityRow>(`SELECT * FROM collection_activity ORDER BY created_at DESC LIMIT ?`, [limit]);
    return rows.map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      kind: row.kind as CollectionActivityKind,
      text: row.text,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }));
  }

  async save(activity: CollectionActivity): Promise<void> {
    await this.db.run(
      `INSERT INTO collection_activity (id, customer_id, kind, text, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [activity.id, activity.customerId, activity.kind, activity.text, activity.createdAt, activity.createdBy],
    );
  }
}

interface HoldRow {
  customer_id: string;
  reason: string;
  until: string | null;
  created_at: string;
  created_by: string;
}

const toHold = (row: HoldRow): CollectionHold => ({
  customerId: row.customer_id,
  reason: row.reason,
  until: row.until,
  createdAt: row.created_at,
  createdBy: row.created_by,
});

class SqlHoldRepository implements CollectionHoldRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<readonly CollectionHold[]> {
    return (await this.db.all<HoldRow>(`SELECT * FROM collection_hold ORDER BY created_at DESC`)).map(toHold);
  }

  async find(customerId: string): Promise<CollectionHold | null> {
    const row = await this.db.get<HoldRow>(`SELECT * FROM collection_hold WHERE customer_id = ?`, [customerId]);
    return row ? toHold(row) : null;
  }

  async save(hold: CollectionHold): Promise<void> {
    await this.db.run(
      `INSERT INTO collection_hold (customer_id, reason, until, created_at, created_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(customer_id) DO UPDATE SET reason = excluded.reason, until = excluded.until, created_at = excluded.created_at, created_by = excluded.created_by`,
      [hold.customerId, hold.reason, hold.until, hold.createdAt, hold.createdBy],
    );
  }

  async remove(customerId: string): Promise<void> {
    await this.db.run(`DELETE FROM collection_hold WHERE customer_id = ?`, [customerId]);
  }
}

interface MessageRow {
  id: string;
  customer_id: string;
  subject: string;
  body: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
  sent_at: string | null;
}

const toMessage = (row: MessageRow): CustomerMessage => ({
  id: row.id,
  customerId: row.customer_id,
  subject: row.subject,
  body: row.body,
  status: row.status as CustomerMessageStatus,
  failureReason: row.failure_reason,
  createdAt: row.created_at,
  sentAt: row.sent_at,
});

class SqlCustomerMessageOutbox implements CustomerMessageOutbox {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<CustomerMessage | null> {
    const row = await this.db.get<MessageRow>(`SELECT * FROM customer_message WHERE id = ?`, [id]);
    return row ? toMessage(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<ReadonlyMap<string, CustomerMessage>> {
    const found = new Map<string, CustomerMessage>();
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += MAX_BOUND_PARAMS) {
      const chunk = unique.slice(start, start + MAX_BOUND_PARAMS);
      const rows = await this.db.all<MessageRow>(`SELECT * FROM customer_message WHERE id IN (${placeholders(chunk.length)})`, chunk);
      for (const row of rows) found.set(row.id, toMessage(row));
    }
    return found;
  }

  async listQueued(limit: number): Promise<readonly CustomerMessage[]> {
    const rows = await this.db.all<MessageRow>(`SELECT * FROM customer_message WHERE status = ? ORDER BY created_at ASC LIMIT ?`, [
      CustomerMessageStatus.Queued,
      limit,
    ]);
    return rows.map(toMessage);
  }

  async enqueue(message: CustomerMessage): Promise<void> {
    await this.db.run(
      `INSERT INTO customer_message (id, customer_id, subject, body, status, failure_reason, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [message.id, message.customerId, message.subject, message.body, message.status, message.failureReason, message.createdAt, message.sentAt],
    );
  }

  async claim(id: string, at: string): Promise<string | null> {
    const token = randomUUID();
    const { changes } = await this.db.run(
      `UPDATE customer_message SET status = ?, claim_token = ?, claimed_at = ? WHERE id = ? AND status = ?`,
      [CustomerMessageStatus.Sending, token, at, id, CustomerMessageStatus.Queued],
    );
    return changes === 1 ? token : null;
  }

  async settle(
    id: string,
    status: CustomerMessageStatus,
    claim: string,
    outcome: { readonly sentAt: string | null; readonly failureReason: string | null },
  ): Promise<boolean> {
    const { changes } = await this.db.run(
      `UPDATE customer_message SET status = ?, sent_at = ?, failure_reason = ?, claim_token = NULL, claimed_at = NULL
       WHERE id = ? AND status = ? AND claim_token = ?`,
      [status, outcome.sentAt, outcome.failureReason, id, CustomerMessageStatus.Sending, claim],
    );
    return changes === 1;
  }

  async requeueStaleSending(before: string): Promise<number> {
    const { changes } = await this.db.run(
      `UPDATE customer_message SET status = ?, claim_token = NULL, claimed_at = NULL WHERE status = ? AND (claimed_at IS NULL OR claimed_at < ?)`,
      [CustomerMessageStatus.Queued, CustomerMessageStatus.Sending, before],
    );
    return changes;
  }
}

export interface CollectionsStoreHandle {
  readonly policy: DunningPolicyRepository;
  readonly reminders: DunningReminderRepository;
  readonly promises: PromiseToPayRepository;
  readonly activities: CollectionActivityRepository;
  readonly holds: CollectionHoldRepository;
  readonly outbox: CustomerMessageOutbox;
}

export interface SqliteCollectionsStoreHandle extends CollectionsStoreHandle {
  close(): void;
}

export async function ensureCollectionsSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createCollectionsStore(db: SqlDb): CollectionsStoreHandle {
  return {
    policy: new SqlPolicyRepository(db),
    reminders: new SqlReminderRepository(db),
    promises: new SqlPromiseRepository(db),
    activities: new SqlActivityRepository(db),
    holds: new SqlHoldRepository(db),
    outbox: new SqlCustomerMessageOutbox(db),
  };
}

export function createSqliteCollectionsStore(path: SqliteConnectionInput = ":memory:"): SqliteCollectionsStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return {
    ...createCollectionsStore(sqliteDb(sqlite)),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
