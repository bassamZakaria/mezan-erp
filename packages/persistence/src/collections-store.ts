import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
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
  auto_send_enabled: number;
  minimum_overdue: string;
  pause_on_promise: number;
  last_scheduled_run: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

class SqlitePolicyRepository implements DunningPolicyRepository {
  constructor(private readonly sqlite: Database.Database) {}

  async get(): Promise<DunningPolicy | null> {
    const row = this.sqlite.prepare(`SELECT * FROM dunning_policy WHERE id = ?`).get(DEFAULT_POLICY_ID) as PolicyRow | undefined;
    if (!row) return null;
    return {
      steps: JSON.parse(row.steps_json) as DunningStep[],
      autoSendEnabled: row.auto_send_enabled === 1,
      minimumOverdueAmount: Money.fromMajor(row.minimum_overdue),
      pauseWhilePromisePending: row.pause_on_promise === 1,
      lastScheduledRunDate: row.last_scheduled_run,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  async save(policy: DunningPolicy): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO dunning_policy (id, steps_json, auto_send_enabled, minimum_overdue, pause_on_promise, last_scheduled_run, updated_at, updated_by)
         VALUES (@id, @steps_json, @auto_send_enabled, @minimum_overdue, @pause_on_promise, @last_scheduled_run, @updated_at, @updated_by)
         ON CONFLICT(id) DO UPDATE SET
           steps_json = excluded.steps_json,
           auto_send_enabled = excluded.auto_send_enabled,
           minimum_overdue = excluded.minimum_overdue,
           pause_on_promise = excluded.pause_on_promise,
           last_scheduled_run = excluded.last_scheduled_run,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
      .run({
        id: DEFAULT_POLICY_ID,
        steps_json: JSON.stringify(policy.steps),
        auto_send_enabled: policy.autoSendEnabled ? 1 : 0,
        minimum_overdue: policy.minimumOverdueAmount.toString(),
        pause_on_promise: policy.pauseWhilePromisePending ? 1 : 0,
        last_scheduled_run: policy.lastScheduledRunDate,
        updated_at: policy.updatedAt,
        updated_by: policy.updatedBy,
      });
  }
}

interface ReminderRow {
  id: string;
  item_key: string;
  step_id: string;
  step_level: number;
  customer_id: string;
  document_id: string | null;
  reference: string | null;
  channel: string;
  subject: string;
  body: string;
  amount: string;
  days_overdue: number;
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
    stepLevel: row.step_level,
    customerId: row.customer_id,
    documentId: row.document_id,
    reference: row.reference,
    channel: row.channel as DunningChannel,
    subject: row.subject,
    body: row.body,
    amount: Money.fromMajor(row.amount),
    daysOverdue: row.days_overdue,
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

function reminderParams(r: DunningReminder) {
  return {
    id: r.id,
    item_key: r.itemKey,
    step_id: r.stepId,
    step_level: r.stepLevel,
    customer_id: r.customerId,
    document_id: r.documentId,
    reference: r.reference,
    channel: r.channel,
    subject: r.subject,
    body: r.body,
    amount: r.amount.toString(),
    days_overdue: r.daysOverdue,
    due_date: r.dueDate,
    status: r.status,
    void_reason: r.voidReason,
    failure_reason: r.failureReason,
    message_id: r.messageId,
    prepared_on: r.preparedOn,
    prepared_at: r.preparedAt,
    prepared_by: r.preparedBy,
    sent_at: r.sentAt,
    sent_by: r.sentBy,
    outcome: r.outcome,
  };
}

class SqliteReminderRepository implements DunningReminderRepository {
  private readonly insert: Database.Statement;
  private readonly update_: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.insert = sqlite.prepare(`
      INSERT INTO dunning_reminder
        (id, item_key, step_id, step_level, customer_id, document_id, reference, channel, subject, body, amount, days_overdue, due_date, status, void_reason, failure_reason, message_id, prepared_on, prepared_at, prepared_by, sent_at, sent_by, outcome)
      VALUES
        (@id, @item_key, @step_id, @step_level, @customer_id, @document_id, @reference, @channel, @subject, @body, @amount, @days_overdue, @due_date, @status, @void_reason, @failure_reason, @message_id, @prepared_on, @prepared_at, @prepared_by, @sent_at, @sent_by, @outcome)
      ON CONFLICT(item_key, step_id) DO NOTHING
    `);
    this.update_ = sqlite.prepare(`
      UPDATE dunning_reminder SET
        status = @status, void_reason = @void_reason, failure_reason = @failure_reason, message_id = @message_id,
        sent_at = @sent_at, sent_by = @sent_by, outcome = @outcome
      WHERE id = @id
    `);
  }

  async findById(id: string): Promise<DunningReminder | null> {
    const row = this.sqlite.prepare(`SELECT * FROM dunning_reminder WHERE id = ?`).get(id) as ReminderRow | undefined;
    return row ? toReminder(row) : null;
  }

  async list(filter: DunningReminderListFilter = {}): Promise<readonly DunningReminder[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.customerId !== undefined) {
      clauses.push("customer_id = ?");
      params.push(filter.customerId);
    }
    if (filter.statuses !== undefined) {
      if (filter.statuses.length === 0) return [];
      clauses.push(`status IN (SELECT value FROM json_each(?))`);
      params.push(JSON.stringify(filter.statuses));
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.sqlite
      .prepare(`SELECT * FROM dunning_reminder ${where} ORDER BY prepared_at DESC, step_level DESC LIMIT ?`)
      .all(...params, filter.limit ?? REMINDER_DEFAULT_LIMIT) as ReminderRow[];
    return rows.map(toReminder);
  }

  async insertIfAbsent(reminder: DunningReminder): Promise<boolean> {
    return this.insert.run(reminderParams(reminder)).changes === 1;
  }

  async update(reminder: DunningReminder): Promise<void> {
    this.update_.run(reminderParams(reminder));
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

class SqlitePromiseRepository implements PromiseToPayRepository {
  constructor(private readonly sqlite: Database.Database) {}

  async findById(id: string): Promise<PromiseToPay | null> {
    const row = this.sqlite.prepare(`SELECT * FROM promise_to_pay WHERE id = ?`).get(id) as PromiseRow | undefined;
    return row ? toPromise(row) : null;
  }

  async list(filter: { readonly customerId?: string } = {}): Promise<readonly PromiseToPay[]> {
    const rows =
      filter.customerId !== undefined
        ? (this.sqlite.prepare(`SELECT * FROM promise_to_pay WHERE customer_id = ? ORDER BY created_at DESC`).all(filter.customerId) as PromiseRow[])
        : (this.sqlite.prepare(`SELECT * FROM promise_to_pay ORDER BY created_at DESC`).all() as PromiseRow[]);
    return rows.map(toPromise);
  }

  async save(promise: PromiseToPay): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO promise_to_pay (id, customer_id, promised_date, amount, invoice_ids, note, created_on, created_at, created_by, cancelled_at, cancelled_by)
         VALUES (@id, @customer_id, @promised_date, @amount, @invoice_ids, @note, @created_on, @created_at, @created_by, @cancelled_at, @cancelled_by)
         ON CONFLICT(id) DO UPDATE SET cancelled_at = excluded.cancelled_at, cancelled_by = excluded.cancelled_by`,
      )
      .run({
        id: promise.id,
        customer_id: promise.customerId,
        promised_date: promise.promisedDate,
        amount: promise.amount.toString(),
        invoice_ids: JSON.stringify(promise.invoiceIds),
        note: promise.note,
        created_on: promise.createdOn,
        created_at: promise.createdAt,
        created_by: promise.createdBy,
        cancelled_at: promise.cancelledAt,
        cancelled_by: promise.cancelledBy,
      });
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

class SqliteActivityRepository implements CollectionActivityRepository {
  constructor(private readonly sqlite: Database.Database) {}

  async list(filter: { readonly customerId?: string; readonly limit?: number } = {}): Promise<readonly CollectionActivity[]> {
    const limit = filter.limit ?? ACTIVITY_DEFAULT_LIMIT;
    const rows =
      filter.customerId !== undefined
        ? (this.sqlite.prepare(`SELECT * FROM collection_activity WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?`).all(filter.customerId, limit) as ActivityRow[])
        : (this.sqlite.prepare(`SELECT * FROM collection_activity ORDER BY created_at DESC LIMIT ?`).all(limit) as ActivityRow[]);
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
    this.sqlite
      .prepare(`INSERT INTO collection_activity (id, customer_id, kind, text, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(activity.id, activity.customerId, activity.kind, activity.text, activity.createdAt, activity.createdBy);
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

class SqliteHoldRepository implements CollectionHoldRepository {
  constructor(private readonly sqlite: Database.Database) {}

  async list(): Promise<readonly CollectionHold[]> {
    return (this.sqlite.prepare(`SELECT * FROM collection_hold ORDER BY created_at DESC`).all() as HoldRow[]).map(toHold);
  }

  async find(customerId: string): Promise<CollectionHold | null> {
    const row = this.sqlite.prepare(`SELECT * FROM collection_hold WHERE customer_id = ?`).get(customerId) as HoldRow | undefined;
    return row ? toHold(row) : null;
  }

  async save(hold: CollectionHold): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO collection_hold (customer_id, reason, until, created_at, created_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(customer_id) DO UPDATE SET reason = excluded.reason, until = excluded.until, created_at = excluded.created_at, created_by = excluded.created_by`,
      )
      .run(hold.customerId, hold.reason, hold.until, hold.createdAt, hold.createdBy);
  }

  async remove(customerId: string): Promise<void> {
    this.sqlite.prepare(`DELETE FROM collection_hold WHERE customer_id = ?`).run(customerId);
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

class SqliteCustomerMessageOutbox implements CustomerMessageOutbox {
  constructor(private readonly sqlite: Database.Database) {}

  async findById(id: string): Promise<CustomerMessage | null> {
    const row = this.sqlite.prepare(`SELECT * FROM customer_message WHERE id = ?`).get(id) as MessageRow | undefined;
    return row ? toMessage(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<ReadonlyMap<string, CustomerMessage>> {
    if (ids.length === 0) return new Map();
    const rows = this.sqlite.prepare(`SELECT * FROM customer_message WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as MessageRow[];
    return new Map(rows.map((row) => [row.id, toMessage(row)]));
  }

  async listQueued(limit: number): Promise<readonly CustomerMessage[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM customer_message WHERE status = ? ORDER BY created_at ASC LIMIT ?`)
      .all(CustomerMessageStatus.Queued, limit) as MessageRow[];
    return rows.map(toMessage);
  }

  async enqueue(message: CustomerMessage): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO customer_message (id, customer_id, subject, body, status, failure_reason, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(message.id, message.customerId, message.subject, message.body, message.status, message.failureReason, message.createdAt, message.sentAt);
  }

  async claim(id: string, at: string): Promise<string | null> {
    const token = randomUUID();
    const changes = this.sqlite
      .prepare(`UPDATE customer_message SET status = ?, claim_token = ?, claimed_at = ? WHERE id = ? AND status = ?`)
      .run(CustomerMessageStatus.Sending, token, at, id, CustomerMessageStatus.Queued).changes;
    return changes === 1 ? token : null;
  }

  async settle(
    id: string,
    status: CustomerMessageStatus,
    claim: string,
    outcome: { readonly sentAt: string | null; readonly failureReason: string | null },
  ): Promise<boolean> {
    return (
      this.sqlite
        .prepare(
          `UPDATE customer_message SET status = ?, sent_at = ?, failure_reason = ?, claim_token = NULL, claimed_at = NULL
           WHERE id = ? AND status = ? AND claim_token = ?`,
        )
        .run(status, outcome.sentAt, outcome.failureReason, id, CustomerMessageStatus.Sending, claim).changes === 1
    );
  }

  async requeueStaleSending(before: string): Promise<number> {
    return this.sqlite
      .prepare(`UPDATE customer_message SET status = ?, claim_token = NULL, claimed_at = NULL WHERE status = ? AND (claimed_at IS NULL OR claimed_at < ?)`)
      .run(CustomerMessageStatus.Queued, CustomerMessageStatus.Sending, before).changes;
  }
}

export interface SqliteCollectionsStoreHandle {
  readonly policy: DunningPolicyRepository;
  readonly reminders: DunningReminderRepository;
  readonly promises: PromiseToPayRepository;
  readonly activities: CollectionActivityRepository;
  readonly holds: CollectionHoldRepository;
  readonly outbox: CustomerMessageOutbox;
  close(): void;
}

export function createSqliteCollectionsStore(path: SqliteConnectionInput = ":memory:"): SqliteCollectionsStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return {
    policy: new SqlitePolicyRepository(sqlite),
    reminders: new SqliteReminderRepository(sqlite),
    promises: new SqlitePromiseRepository(sqlite),
    activities: new SqliteActivityRepository(sqlite),
    holds: new SqliteHoldRepository(sqlite),
    outbox: new SqliteCustomerMessageOutbox(sqlite),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
