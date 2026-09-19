import type { Money } from "../money/index.js";
import type { CashForecastSourceKind } from "../cash-forecast/types.js";

export enum DunningChannel {
  Email = "email",
  WhatsApp = "whatsapp",
  Sms = "sms",
  Call = "call",
}

export enum DunningReminderStatus {
  Prepared = "prepared",
  Queued = "queued",
  Sent = "sent",
  Failed = "failed",
  Dismissed = "dismissed",
  Voided = "voided",
}

export enum DunningVoidReason {
  Settled = "settled",
  Superseded = "superseded",
}

export enum PromiseToPayStatus {
  Pending = "pending",
  Kept = "kept",
  Broken = "broken",
  Cancelled = "cancelled",
}

export enum CollectionActivityKind {
  Note = "note",
  Call = "call",
  StatementSent = "statement_sent",
}

export enum CustomerMessageStatus {
  Queued = "queued",
  Sent = "sent",
  Failed = "failed",
}

export enum StatementChannel {
  Email = "email",
  WhatsApp = "whatsapp",
}

export interface DunningStep {
  readonly id: string;
  readonly level: number;
  readonly daysOverdue: number;
  readonly channel: DunningChannel;
  readonly subjectAr: string;
  readonly subjectEn: string | null;
  readonly bodyAr: string;
  readonly bodyEn: string | null;
  readonly active: boolean;
}

export interface DunningPolicy {
  readonly steps: readonly DunningStep[];
  readonly autoSendEnabled: boolean;
  readonly minimumOverdueAmount: Money;
  readonly pauseWhilePromisePending: boolean;
  readonly lastScheduledRunDate: string | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface CollectionWorkItem {
  readonly key: string;
  readonly kind: CashForecastSourceKind;
  readonly customerId: string;
  readonly documentId: string | null;
  readonly reference: string | null;
  readonly detail: string | null;
  readonly dueDate: string;
  readonly daysOverdue: number;
  readonly amount: Money;
}

export interface DunningReminder {
  readonly id: string;
  readonly itemKey: string;
  readonly stepId: string;
  readonly stepLevel: number;
  readonly customerId: string;
  readonly documentId: string | null;
  readonly reference: string | null;
  readonly channel: DunningChannel;
  readonly subject: string;
  readonly body: string;
  readonly amount: Money;
  readonly daysOverdue: number;
  readonly dueDate: string;
  readonly status: DunningReminderStatus;
  readonly voidReason: DunningVoidReason | null;
  readonly failureReason: string | null;
  readonly messageId: string | null;
  readonly preparedOn: string;
  readonly preparedAt: string;
  readonly preparedBy: string;
  readonly sentAt: string | null;
  readonly sentBy: string | null;
  readonly outcome: string | null;
}

export interface PromiseToPay {
  readonly id: string;
  readonly customerId: string;
  readonly promisedDate: string;
  readonly amount: Money;
  readonly invoiceIds: readonly string[];
  readonly note: string | null;
  readonly createdOn: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly cancelledAt: string | null;
  readonly cancelledBy: string | null;
}

export interface EvaluatedPromise extends PromiseToPay {
  readonly status: PromiseToPayStatus;
  readonly collected: Money;
}

export interface CollectionActivity {
  readonly id: string;
  readonly customerId: string;
  readonly kind: CollectionActivityKind;
  readonly text: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CollectionHold {
  readonly customerId: string;
  readonly reason: string;
  readonly until: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CustomerMessage {
  readonly id: string;
  readonly customerId: string;
  readonly subject: string;
  readonly body: string;
  readonly status: CustomerMessageStatus;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
}

export interface DunningPolicyRepository {
  get(): Promise<DunningPolicy | null>;
  save(policy: DunningPolicy): Promise<void>;
}

export interface DunningReminderListFilter {
  readonly customerId?: string;
  readonly statuses?: readonly DunningReminderStatus[];
  readonly limit?: number;
}

export interface DunningReminderRepository {
  findById(id: string): Promise<DunningReminder | null>;
  list(filter?: DunningReminderListFilter): Promise<readonly DunningReminder[]>;
  insertIfAbsent(reminder: DunningReminder): Promise<boolean>;
  update(reminder: DunningReminder): Promise<void>;
}

export interface PromiseToPayRepository {
  findById(id: string): Promise<PromiseToPay | null>;
  list(filter?: { readonly customerId?: string }): Promise<readonly PromiseToPay[]>;
  save(promise: PromiseToPay): Promise<void>;
}

export interface CollectionActivityRepository {
  list(filter?: { readonly customerId?: string; readonly limit?: number }): Promise<readonly CollectionActivity[]>;
  save(activity: CollectionActivity): Promise<void>;
}

export interface CollectionHoldRepository {
  list(): Promise<readonly CollectionHold[]>;
  find(customerId: string): Promise<CollectionHold | null>;
  save(hold: CollectionHold): Promise<void>;
  remove(customerId: string): Promise<void>;
}

export interface CustomerMessageOutbox {
  findById(id: string): Promise<CustomerMessage | null>;
  findByIds(ids: readonly string[]): Promise<ReadonlyMap<string, CustomerMessage>>;
  listQueued(limit: number): Promise<readonly CustomerMessage[]>;
  save(message: CustomerMessage): Promise<void>;
}
