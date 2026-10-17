import { z } from "zod";
import { isoDay } from "../iso-date.js";
import { moneyString } from "../money-string.js";

export enum DunningChannelDTO {
  Email = "email",
  WhatsApp = "whatsapp",
  Sms = "sms",
  Call = "call",
}

export enum DunningReminderStatusDTO {
  Prepared = "prepared",
  Queued = "queued",
  Sent = "sent",
  Failed = "failed",
  Dismissed = "dismissed",
  Voided = "voided",
}

export enum PromiseToPayStatusDTO {
  Pending = "pending",
  Kept = "kept",
  Broken = "broken",
  Cancelled = "cancelled",
}

export enum CollectionActivityKindDTO {
  Note = "note",
  Call = "call",
  StatementSent = "statement_sent",
}

export enum CustomerMessageStatusDTO {
  Queued = "queued",
  Sending = "sending",
  Sent = "sent",
  Failed = "failed",
}

export enum StatementChannelDTO {
  Email = "email",
  WhatsApp = "whatsapp",
}

export enum CollectionItemKindDTO {
  Receivable = "receivable",
  Installment = "installment",
  ReceivableOther = "receivable_other",
}

export const dunningChannelSchema = z.nativeEnum(DunningChannelDTO);
export const statementChannelSchema = z.nativeEnum(StatementChannelDTO);

export const dunningStepSchema = z.object({
  stepKey: z.string().trim().min(1).max(40),
  daysOverdue: z.number().int().min(1).max(3650),
  channel: dunningChannelSchema,
  subjectAr: z.string().max(300),
  subjectEn: z.string().max(300).nullable(),
  bodyAr: z.string().max(4000),
  bodyEn: z.string().max(4000).nullable(),
  active: z.boolean(),
});
export type DunningStepInputDTO = z.infer<typeof dunningStepSchema>;

export const updateDunningPolicySchema = z.object({
  steps: z.array(dunningStepSchema).max(8),
  autoSendEnabled: z.boolean(),
  minimumOverdueAmount: moneyString,
  pauseWhilePromisePending: z.boolean(),
});
export type UpdateDunningPolicyDTO = z.infer<typeof updateDunningPolicySchema>;

export const dunningRunSchema = z.object({
  customerIds: z.array(z.string().min(1)).max(500).optional(),
});
export type DunningRunRequestDTO = z.infer<typeof dunningRunSchema>;

export const dismissReminderSchema = z.object({
  note: z.string().trim().max(500).nullish(),
});

export const createPromiseToPaySchema = z.object({
  customerId: z.string().min(1),
  promisedDate: isoDay,
  amount: moneyString,
  invoiceIds: z.array(z.string().min(1)).max(200).optional(),
  note: z.string().trim().max(1000).nullish(),
});
export type CreatePromiseToPayDTO = z.infer<typeof createPromiseToPaySchema>;

export const collectionNoteSchema = z.object({
  kind: z.enum([CollectionActivityKindDTO.Note, CollectionActivityKindDTO.Call]),
  text: z.string().trim().min(1).max(2000),
});
export type CollectionNoteDTO = z.infer<typeof collectionNoteSchema>;

export const collectionHoldSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  until: isoDay.nullable(),
});
export type CollectionHoldInputDTO = z.infer<typeof collectionHoldSchema>;

export const sendStatementSchema = z.object({
  channel: statementChannelSchema,
});
export type SendStatementDTO = z.infer<typeof sendStatementSchema>;

export interface DunningStepDTO {
  readonly stepKey: string;
  readonly level: number;
  readonly daysOverdue: number;
  readonly channel: DunningChannelDTO;
  readonly subjectAr: string;
  readonly subjectEn: string | null;
  readonly bodyAr: string;
  readonly bodyEn: string | null;
  readonly active: boolean;
}

export interface DunningPolicyDTO {
  readonly steps: readonly DunningStepDTO[];
  readonly autoSendEnabled: boolean;
  readonly minimumOverdueAmount: string;
  readonly pauseWhilePromisePending: boolean;
  readonly lastScheduledRunDate: string | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
  readonly smsAvailable: boolean;
  readonly placeholders: readonly string[];
  readonly isDefault: boolean;
}

export interface DunningReminderDTO {
  readonly id: string;
  readonly itemKey: string;
  readonly stepLevel: number;
  readonly customerId: string;
  readonly customerName: string;
  readonly documentId: string | null;
  readonly reference: string | null;
  readonly channel: DunningChannelDTO;
  readonly subject: string;
  readonly body: string;
  readonly amount: string;
  readonly daysOverdue: number;
  readonly dueDate: string;
  readonly status: DunningReminderStatusDTO;
  readonly failureReason: string | null;
  readonly preparedOn: string;
  readonly sentAt: string | null;
  readonly sentBy: string | null;
  readonly outcome: string | null;
  readonly whatsappLink: string | null;
}

export interface EvaluatedPromiseDTO {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly promisedDate: string;
  readonly amount: string;
  readonly collected: string;
  readonly invoiceIds: readonly string[];
  readonly note: string | null;
  readonly status: PromiseToPayStatusDTO;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CollectionActivityDTO {
  readonly id: string;
  readonly kind: CollectionActivityKindDTO;
  readonly text: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CollectionHoldDTO {
  readonly customerId: string;
  readonly reason: string;
  readonly until: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CollectionWorkItemDTO {
  readonly key: string;
  readonly kind: CollectionItemKindDTO;
  readonly documentId: string | null;
  readonly reference: string | null;
  readonly detail: string | null;
  readonly dueDate: string;
  readonly daysOverdue: number;
  readonly amount: string;
  readonly nextStepLevel: number | null;
  readonly lastReminderStatus: DunningReminderStatusDTO | null;
}

export interface CollectionCustomerRowDTO {
  readonly customerId: string;
  readonly customerName: string;
  readonly customerNameEn: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly overdue: string;
  readonly notYetDue: string;
  readonly oldestDaysOverdue: number;
  readonly onHold: CollectionHoldDTO | null;
  readonly pendingPromise: EvaluatedPromiseDTO | null;
  readonly items: readonly CollectionWorkItemDTO[];
}

export interface CollectionsWorklistDTO {
  readonly asOfDate: string;
  readonly totalOverdue: string;
  readonly customerCount: number;
  readonly rows: readonly CollectionCustomerRowDTO[];
}

export interface DunningRunResultDTO {
  readonly asOfDate: string;
  readonly prepared: number;
  readonly voided: number;
  readonly skippedHeld: number;
  readonly skippedPromised: number;
  readonly skippedBelowMinimum: number;
}

export interface ScheduledDunningRunResultDTO {
  readonly alreadyRan: boolean;
  readonly run: DunningRunResultDTO | null;
  readonly queued: number;
}

export interface SendReminderResultDTO {
  readonly reminder: DunningReminderDTO;
  readonly whatsappLink: string | null;
}

export interface SendStatementResultDTO {
  readonly channel: StatementChannelDTO;
  readonly subject: string;
  readonly body: string;
  readonly whatsappLink: string | null;
  readonly queuedMessageId: string | null;
}

export interface CollectionsOutboxDTO {
  readonly queued: number;
  readonly mailConfigured: boolean;
}

export interface CollectionsDrainResultDTO {
  readonly attempted: number;
  readonly sent: number;
  readonly stillQueued: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface CustomerCollectionsDTO {
  readonly asOfDate: string;
  readonly customerId: string;
  readonly row: CollectionCustomerRowDTO | null;
  readonly hold: CollectionHoldDTO | null;
  readonly reminders: readonly DunningReminderDTO[];
  readonly promises: readonly EvaluatedPromiseDTO[];
  readonly activities: readonly CollectionActivityDTO[];
}
