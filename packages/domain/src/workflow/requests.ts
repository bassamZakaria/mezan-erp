/**
 * Approval-request orchestration — persists the {@link ApprovalRequest}
 * instances the pure `gate.ts` state machine produces, so الموافقات (the
 * approvals inbox) has something durable to list and act on. Every mutation
 * here calls straight into `startApproval` / `decide` / `resubmit`: this
 * module owns NO approval logic of its own, only load → transition → save.
 */

import {
  startApproval,
  decide as gateDecide,
  resubmit as gateResubmit,
  reopenForModification,
  type ApprovalRequest,
  type DecisionInput,
  type GateConfig,
} from "./gate.js";

export interface ApprovalRequestRecord extends ApprovalRequest {
  /** Free-text label for the gated entity (e.g. "فاتورة مبيعات INV-000123"), for the inbox row. */
  readonly entityLabel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Persistence port for approval-request instances. The domain depends on this interface only. */
export interface ApprovalRequestRepository {
  list(): Promise<readonly ApprovalRequestRecord[]>;
  findById(id: string): Promise<ApprovalRequestRecord | null>;
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
  const record: ApprovalRequestRecord = { ...request, entityLabel: cmd.entityLabel ?? null, createdAt: ts, updatedAt: ts };
  await repo.save(record);
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
  const { request } = gateDecide(existing, input);
  const record: ApprovalRequestRecord = { ...request, entityLabel: existing.entityLabel, createdAt: existing.createdAt, updatedAt: now() };
  await repo.save(record);
  return record;
}

/** Re-submits a request bounced back as `modification_requested`, restarting the chain from step 0. */
export async function resubmitApproval(
  id: string,
  input: { submittedBy?: string; at?: number } = {},
  repo: ApprovalRequestRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<ApprovalRequestRecord> {
  const existing = await repo.findById(id);
  if (!existing) throw new ApprovalRequestNotFoundError(id);
  const { request } = gateResubmit(existing, input);
  const record: ApprovalRequestRecord = { ...request, entityLabel: existing.entityLabel, createdAt: existing.createdAt, updatedAt: now() };
  await repo.save(record);
  return record;
}

/** Hands a decided request back for modification; a pending or unknown one is left as it is. */
export async function reopenApprovalForModification(
  id: string,
  repo: ApprovalRequestRepository,
  now: () => string = () => new Date().toISOString(),
): Promise<ApprovalRequestRecord | null> {
  const existing = await repo.findById(id);
  if (!existing) return null;
  const reopened = reopenForModification(existing);
  if (!reopened) return null;
  const record: ApprovalRequestRecord = { ...existing, ...reopened, updatedAt: now() };
  await repo.save(record);
  return record;
}
