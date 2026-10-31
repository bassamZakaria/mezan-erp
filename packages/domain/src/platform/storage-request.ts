import { isoTimestamp } from "./validation.js";
import { InvalidSubscriptionError } from "./errors.js";

export enum StorageRequestStatus {
  Pending = "pending",
  Approved = "approved",
  Declined = "declined",
}

export enum StorageDecision {
  Approve = "approve",
  Decline = "decline",
}

export enum StorageRequestStepMb {
  OneGb = 1024,
  FiveGb = 5120,
  TenGb = 10240,
}

export const STORAGE_REQUEST_STEPS_MB: readonly StorageRequestStepMb[] = [StorageRequestStepMb.OneGb, StorageRequestStepMb.FiveGb, StorageRequestStepMb.TenGb];
export const MAX_STORAGE_REQUEST_NOTE = 500;

export interface StorageRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly extraMb: number;
  readonly note: string | null;
  readonly status: StorageRequestStatus;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
}

export interface StorageRequestRepository {
  findById(id: string): Promise<StorageRequest | null>;
  listByTenant(tenantId: string): Promise<StorageRequest[]>;
  listPending(): Promise<StorageRequest[]>;
  /** Inserts only when the tenant has no pending request; a partial unique index decides, not a prior read. */
  insertIfNonePending(request: StorageRequest): Promise<boolean>;
  /** Moves `before` to `after` only while it is still pending, then runs `sideEffect` in the same transaction. */
  decide(before: StorageRequest, after: StorageRequest, sideEffect: () => Promise<void>): Promise<boolean>;
}

export enum StorageRequestRefusal {
  AlreadyPending = "STORAGE_REQUEST_PENDING",
  NoStorageLimit = "STORAGE_UNLIMITED",
  AlreadyDecided = "STORAGE_REQUEST_DECIDED",
  NotFound = "STORAGE_REQUEST_NOT_FOUND",
}

export class StorageRequestRefusedError extends Error {
  readonly messageEn: string;
  constructor(readonly code: StorageRequestRefusal, messageAr: string, messageEn: string) {
    super(messageAr);
    this.messageEn = messageEn;
    this.name = "StorageRequestRefusedError";
  }
}

export interface RequestStorageCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly extraMb: number;
  readonly note?: string | null;
  readonly requestedBy: string;
  readonly now: string;
}

export async function requestStorage(cmd: RequestStorageCommand, repo: StorageRequestRepository): Promise<StorageRequest> {
  const now = isoTimestamp(cmd.now);
  const note = cmd.note?.trim() || null;
  const reasons: string[] = [];
  if (!now) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!(STORAGE_REQUEST_STEPS_MB as readonly number[]).includes(cmd.extraMb)) reasons.push("المساحة المطلوبة غير متاحة");
  if (note !== null && note.length > MAX_STORAGE_REQUEST_NOTE) reasons.push(`الملاحظة لا تزيد على ${MAX_STORAGE_REQUEST_NOTE} حرف`);
  if (!now || reasons.length > 0) throw new InvalidSubscriptionError(reasons);
  const request: StorageRequest = {
    id: cmd.id,
    tenantId: cmd.tenantId,
    extraMb: cmd.extraMb,
    note,
    status: StorageRequestStatus.Pending,
    requestedBy: cmd.requestedBy,
    requestedAt: now,
    decidedBy: null,
    decidedAt: null,
  };
  if (!(await repo.insertIfNonePending(request))) {
    throw new StorageRequestRefusedError(
      StorageRequestRefusal.AlreadyPending,
      "لديكم طلب مساحة إضافية قيد المراجعة بالفعل. سيصلكم الرد بعد مراجعته.",
      "You already have a storage request under review.",
    );
  }
  return request;
}

export interface DecideStorageRequestCommand {
  readonly id: string;
  readonly approve: boolean;
  readonly decidedBy: string;
  readonly now: string;
}

/** Decides a pending request. On approval `grant` runs inside the same transaction, so the request and the extra space move together or not at all. */
export async function decideStorageRequest(
  cmd: DecideStorageRequestCommand,
  repo: StorageRequestRepository,
  grant: (request: StorageRequest) => Promise<void>,
): Promise<StorageRequest> {
  const now = isoTimestamp(cmd.now);
  if (!now) throw new InvalidSubscriptionError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  const before = await repo.findById(cmd.id);
  if (!before) throw new StorageRequestRefusedError(StorageRequestRefusal.NotFound, "طلب المساحة غير موجود", "Storage request not found");
  const after: StorageRequest = {
    ...before,
    status: cmd.approve ? StorageRequestStatus.Approved : StorageRequestStatus.Declined,
    decidedBy: cmd.decidedBy,
    decidedAt: now,
  };
  const decided = before.status === StorageRequestStatus.Pending && (await repo.decide(before, after, () => (cmd.approve ? grant(after) : Promise.resolve())));
  if (!decided) throw new StorageRequestRefusedError(StorageRequestRefusal.AlreadyDecided, "تمت مراجعة هذا الطلب من قبل", "This request was already decided");
  return after;
}
