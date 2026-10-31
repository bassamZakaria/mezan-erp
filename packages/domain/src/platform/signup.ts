import type { BillingCycle } from "./subscription.js";

/**
 * A signup request lives from the moment the form is submitted until its
 * verification link is followed (or it expires unread). `Pending` and
 * `Verified` are the only two states — there is no "rejected", because a
 * request that fails validation is never saved at all.
 */
export enum SignupRequestStatus {
  Pending = "pending",
  Verified = "verified",
  Released = "released",
}

export enum SignupDecision {
  Approved = "approved",
  Rejected = "rejected",
}

export interface SignupRequest {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly ownerEmail: string;
  readonly ownerNameAr: string;
  readonly planId: string;
  /** The public plan the visitor picked on the form, kept as the suggested plan once the reverse trial ends. */
  readonly intendedPlanId?: string | null;
  readonly billingCycle: BillingCycle;
  /** sha256 hex of the raw token — the raw value is never stored, mirroring `@mezan/api`'s session tokens. */
  readonly tokenHash: string;
  readonly status: SignupRequestStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
  readonly decision?: SignupDecision | null;
  readonly decidedAt?: string | null;
  readonly decidedBy?: string | null;
}

export interface SignupRequestRepository {
  findByTokenHash(tokenHash: string): Promise<SignupRequest | null>;
  findById(id: string): Promise<SignupRequest | null>;
  /** Verified requests nobody has decided, still within their hold, whose code is not another company (a half-made one of their own still counts as waiting), oldest first. */
  listAwaitingDecision(nowIso: string): Promise<SignupRequest[]>;
  /** Compare-and-set: records the decision only on a verified, undecided row; false when another decision won. */
  tryDecide(id: string, decision: SignupDecision, decidedBy: string, nowIso: string): Promise<boolean>;
  /** A still-pending unexpired request, or a verified one awaiting a decision, already holding this code — so two people can't queue for the same code at once. */
  findActiveByCode(code: string, nowIso: string): Promise<SignupRequest | null>;
  save(request: SignupRequest): Promise<void>;
  /**
   * Atomically flips a still-`Pending` row to `Verified` — `WHERE status =
   * 'pending'` at the SQL layer, not a read-then-write in application code.
   * Returns the verified row on success, `null` when another caller already
   * won this exact transition (two concurrent `POST /verify` hits on the same
   * token racing to provision the same tenant). Never call `save()` for this
   * transition; only this method's WHERE clause makes it safe to run twice.
   */
  tryMarkVerified(tokenHash: string, nowIso: string): Promise<SignupRequest | null>;
  // CONTRACT: a claim taken before `staleBeforeIso` must be taken over; its holder died mid-provision and will never release it.
  tryClaimProvisioning(tokenHash: string, claimId: string, nowIso: string, staleBeforeIso: string): Promise<boolean>;
  // CONTRACT: false once another caller has taken the claim over; the holder must stop before it hands out a PIN.
  renewProvisioning(tokenHash: string, claimId: string, nowIso: string): Promise<boolean>;
  provisioningClaimedAt(tokenHash: string): Promise<string | null>;
  /** INVARIANT: higher than every claim taken before it, on any token. Null once the claim is no longer this caller's. */
  provisioningFence(tokenHash: string, claimId: string): Promise<number | null>;
  /** INVARIANT: higher than every fence taken before it, by a signup claim or by the console. */
  takeProvisionFence(nowIso: string): Promise<number>;
  releaseProvisioning(tokenHash: string, claimId: string): Promise<void>;
  followOwnerEmail(code: string, before: string, after: string): Promise<void>;
  // CONTRACT: retires every request for the code AND drops any provisioning claim held on them, so a holder mid-provision loses its turn.
  releaseByCode(code: string): Promise<void>;
}

export const VERIFIED_LINK_VALID_MS = 30 * 24 * 60 * 60 * 1000;
