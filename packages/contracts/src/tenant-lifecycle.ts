import { z } from "zod";

export const STEP_UP_REASON_MIN_LENGTH = 10;

const typedReason = z.string().trim().min(STEP_UP_REASON_MIN_LENGTH).max(500);
const currentPassword = z.string().min(1).max(256);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export enum TenantAnchorState {
  Anchoring = "anchoring",
  UpToDate = "up_to_date",
  NoChain = "no_chain",
  Refused = "refused",
  Disabled = "disabled",
}

export enum TenantAnchorRefusal {
  HeadInconsistent = "HEAD_INCONSISTENT",
  NewestAnchorForged = "NEWEST_ANCHOR_FORGED",
  RolledBack = "ROLLED_BACK",
  Rewritten = "REWRITTEN",
}

export const tenantAuditAnchorSchema = z.object({
  state: z.nativeEnum(TenantAnchorState),
  refusal: z.nativeEnum(TenantAnchorRefusal).nullable(),
  latestAnchoredSeq: z.number().int().nullable(),
  latestAnchoredAt: z.string().nullable(),
  liveHeadSeq: z.number().int().nullable(),
  lastRebase: z
    .object({ anchoredAt: z.string(), acceptedBy: z.string(), reason: z.string(), supersededSeq: z.number().int() })
    .nullable(),
  canAcceptRestore: z.boolean(),
});

export const acceptAuditRestoreRequestSchema = z.object({
  reason: typedReason,
  password: currentPassword,
});

export enum AuditRestoreRefusal {
  ReasonTooShort = "REASON_TOO_SHORT",
  NoChain = "NO_CHAIN",
  NothingAnchored = "NOTHING_ANCHORED",
  NothingToAccept = "NOTHING_TO_ACCEPT",
  HeadInconsistent = "HEAD_INCONSISTENT",
  NewestAnchorForged = "NEWEST_ANCHOR_FORGED",
  ChainBroken = "CHAIN_BROKEN",
}

export const acceptAuditRestoreResultSchema = z.object({
  seq: z.number().int(),
  headHash: z.string(),
  supersededSeq: z.number().int(),
  supersededHeadHash: z.string(),
  anchoredAt: z.string(),
});

export enum TenantLifecycleRefusal {
  AnchoringDisabled = "AUDIT_ANCHOR_DISABLED",
  RestoreNotAccepted = "AUDIT_RESTORE_NOT_ACCEPTED",
  TenantNotLive = "TENANT_NOT_LIVE",
  PurgeUnavailable = "TENANT_PURGE_UNAVAILABLE",
  NotTerminated = "TENANT_NOT_TERMINATED",
  RetentionNotLater = "TENANT_RETENTION_NOT_LATER",
  ConfirmCodeMismatch = "TENANT_CONFIRM_CODE_MISMATCH",
}

export const tenantRetentionSchema = z.object({
  retentionDays: z.number().int().nonnegative(),
  retention: z
    .object({
      terminatedAt: z.string(),
      deleteAfter: z.string(),
      lastExtension: z.object({ by: z.string(), at: z.string(), reason: z.string() }).nullable(),
    })
    .nullable(),
});

export const extendTenantRetentionRequestSchema = z.object({
  reason: typedReason,
  password: currentPassword,
  deleteAfter: isoDate,
});

export const purgeTenantNowRequestSchema = z.object({
  reason: typedReason,
  password: currentPassword,
  confirmCode: z.string().trim().min(1).max(64),
});

export const tenantPurgeResultSchema = z.object({
  tenantId: z.string(),
  code: z.string(),
  deletedAt: z.string(),
  removed: z.array(z.string()),
});

export type TenantAuditAnchorDTO = z.infer<typeof tenantAuditAnchorSchema>;
export type AcceptAuditRestoreRequestDTO = z.infer<typeof acceptAuditRestoreRequestSchema>;
export type AcceptAuditRestoreResultDTO = z.infer<typeof acceptAuditRestoreResultSchema>;
export type TenantRetentionDTO = z.infer<typeof tenantRetentionSchema>;
export type ExtendTenantRetentionRequestDTO = z.infer<typeof extendTenantRetentionRequestSchema>;
export type PurgeTenantNowRequestDTO = z.infer<typeof purgeTenantNowRequestSchema>;
export type TenantPurgeResultDTO = z.infer<typeof tenantPurgeResultSchema>;
