/**
 * Approval-request orchestration — persists the {@link ApprovalRequest}
 * instances the pure `gate.ts` state machine produces, so الموافقات (the
 * approvals inbox) has something durable to list and act on. Every mutation
 * here calls straight into `startApproval` / `decide` / `resubmit`: this
 * module owns NO approval logic of its own, only load → transition → save.
 */

import {
  ApprovalStatusCode,
  startApproval,
  decide as gateDecide,
  resubmit as gateResubmit,
  type ApprovalRequest,
  type DecisionInput,
  type GateConfig,
} from "./gate.js";

/** The document a request was raised for, as it stood when it was submitted. */
export interface ApprovalSubject {
  readonly documentId: string;
  readonly branchId: string | null;
  readonly fingerprint: string;
}

export interface ApprovalRequestRecord extends ApprovalRequest {
  /** Free-text label for the gated entity (e.g. "فاتورة مبيعات INV-000123"), for the inbox row. */
  readonly entityLabel: string | null;
  /** Null for a request that gates no document. */
  readonly subject?: ApprovalSubject | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port for approval-request instances. The domain depends on this interface only. */
export interface ApprovalRequestRepository {
  list(): Promise<readonly ApprovalRequestRecord[]>;
  findById(id: string): Promise<ApprovalRequestRecord | null>;
  /**
   * SECURITY: the only way a request comes to exist. It throws
   * `DuplicateRecordIdError` on an id already held and leaves that row as it
   * was — a request that could be re-created could be re-created approved.
   */
  insert(record: ApprovalRequestRecord): Promise<void>;
  /** Records a transition of a standing request; creates nothing. */
  save(record: ApprovalRequestRecord): Promise<void>;
  /** Pending requests whose CURRENT step's role is held by the caller (or every pending request for `["*"]`). */
  listPendingForRoles(roles: readonly string[]): Promise<readonly ApprovalRequestRecord[]>;
  listBySubmitter(submittedBy: string): Promise<readonly ApprovalRequestRecord[]>;
}

/**
 * Thrown when a document whose approval request was REJECTED is confirmed
 * again. A rejected request is terminal: re-confirming must not silently open
 * a fresh one and post the document behind the rejecter's back.
 */
export class ApprovalRequestRejectedError extends Error {
  readonly code = "APPROVAL_REQUEST_REJECTED" as const;
  constructor(readonly id: string) {
    super("طلب الموافقة على هذا المستند مرفوض، ولا يمكن تأكيده.");
    this.name = "ApprovalRequestRejectedError";
  }
}

/**
 * Thrown when a document is confirmed on the strength of a request that is not
 * its own approval: one it did not raise, one recorded for another action,
 * branch or content, or one no second person decided.
 */
export class ApprovalRequestUntrustedError extends Error {
  readonly code = "APPROVAL_REQUEST_UNTRUSTED" as const;
  readonly messageEn = "This document's approval request does not match the document as it stands, so it cannot be confirmed on it. Return the document to draft and submit it again.";
  constructor(readonly id: string) {
    super("طلب الموافقة المسجَّل لهذا المستند لا يطابق المستند بحالته الحالية، فلا يُعتمد عليه في التأكيد. أعد المستند إلى مسودة ثم أرسله للموافقة من جديد.");
    this.name = "ApprovalRequestUntrustedError";
  }
}

export const REAPPROVAL_REQUIRED_REASON_AR =
  "اعتُمد هذا المستند أو أُرسل للموافقة قبل تحديث النظام ولم يُرحَّل؛ الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد ليمرّ المستند على سلسلة الاعتماد الحالية.";
export const REAPPROVAL_REQUIRED_REASON_EN =
  "This document was approved, or sent for approval, before the system was updated and was never posted; that approval can no longer post it. Request approval again so it goes through the approval chain in force.";

export class ApprovalRequestReapprovalRequiredError extends Error {
  readonly code = "APPROVAL_REAPPROVAL_REQUIRED" as const;
  readonly messageEn = REAPPROVAL_REQUIRED_REASON_EN;
  constructor(readonly id: string) {
    super(REAPPROVAL_REQUIRED_REASON_AR);
    this.name = "ApprovalRequestReapprovalRequiredError";
  }
}

export class ApprovalRequestNotFoundError extends Error {
  readonly code = "APPROVAL_REQUEST_NOT_FOUND" as const;
  constructor(readonly id: string) {
    super(`Approval request "${id}" not found.`);
    this.name = "ApprovalRequestNotFoundError";
  }
}

export interface SubmitApprovalCommand {
  readonly requestId: string;
  readonly actionType: GateConfig["actionType"];
  readonly submittedBy: string;
  readonly submitterRoles?: readonly string[];
  readonly entityLabel?: string | null;
  readonly subject?: ApprovalSubject | null;
  readonly at?: number;
}

/** Starts (and persists) a new approval request for `config`'s action type. */
export async function submitApproval(
  cmd: SubmitApprovalCommand,
  config: GateConfig,
  repo: ApprovalRequestRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<ApprovalRequestRecord> {
  const { request } = startApproval(config, {
    requestId: cmd.requestId,
    submittedBy: cmd.submittedBy,
    submitterRoles: cmd.submitterRoles,
    at: cmd.at,
  });
  const ts = now();
  const record: ApprovalRequestRecord = { ...request, entityLabel: cmd.entityLabel ?? null, subject: cmd.subject ?? null, createdAt: ts, updatedAt: ts };
  await repo.insert(record);
  return record;
}

/** Records a decision (approve / reject / request_modification) on a pending request and persists the transition. */
export async function decideApproval(
  id: string,
  input: DecisionInput,
  repo: ApprovalRequestRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<ApprovalRequestRecord> {
  const existing = await repo.findById(id);
  if (!existing) throw new ApprovalRequestNotFoundError(id);
  if (existing.status === ApprovalStatusCode.ReapprovalRequired) throw new ApprovalRequestReapprovalRequiredError(id);
  const { request } = gateDecide(existing, input);
  const record: ApprovalRequestRecord = { ...request, entityLabel: existing.entityLabel, subject: existing.subject ?? null, createdAt: existing.createdAt, updatedAt: now() };
  await repo.save(record);
  return record;
}

/** Re-submits a request bounced back as `modification_requested`, restarting the chain from step 0. */
export async function resubmitApproval(
  id: string,
  input: { submittedBy?: string; at?: number; subject?: ApprovalSubject | null } = {},
  repo: ApprovalRequestRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<ApprovalRequestRecord> {
  const existing = await repo.findById(id);
  if (!existing) throw new ApprovalRequestNotFoundError(id);
  const { request } = gateResubmit(existing, input);
  const record: ApprovalRequestRecord = {
    ...request,
    entityLabel: existing.entityLabel,
    subject: input.subject === undefined ? (existing.subject ?? null) : input.subject,
    createdAt: existing.createdAt,
    updatedAt: now(),
  };
  await repo.save(record);
  return record;
}
