import { emailDomain, normalizeEmail } from "../users/save-user.js";
import { isReservedTenantCode, isValidSlug, RESERVED_TENANT_CODE_MESSAGE } from "./slug.js";
import { CompanyNameProblem, companyNameProblem, companyNameProblemAr } from "./company-name.js";
import { isoTimestamp } from "./validation.js";
import type { BillingCycle } from "./subscription.js";
import type { PlanRepository } from "./plan.js";
import { TenantStatusCode, type TenantRepository } from "./tenant.js";
import {
  InvalidSignupError,
  PlanNotFoundError,
  SignupActivationIncompleteError,
  SignupAlreadyActivatedError,
  SignupTokenExpiredError,
  SignupTokenInvalidError,
  TenantCodeTakenError,
} from "./errors.js";

/**
 * A short, deliberately non-exhaustive blocklist of free disposable-inbox
 * domains — the "cheap" half of the anti-abuse ask (no paid lookup service,
 * no CAPTCHA). It catches the handful of providers that show up in real
 * signup-abuse logs; a determined abuser with their own domain sails through,
 * same as everywhere else this kind of list is used.
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "yopmail.com",
  "trashmail.com",
  "throwawaymail.com",
  "getnada.com",
  "dispostable.com",
  "fakeinbox.com",
  "maildrop.cc",
  "mintemail.com",
  "discard.email",
  "moakt.com",
  "mailnesia.com",
  "mailcatch.com",
  "spamgourmet.com",
  "burnermail.io",
  "emailondeck.com",
  "mohmal.com",
  "mytemp.email",
  "tempinbox.com",
  "throwam.com",
  "fakemailgenerator.com",
  "inboxkitten.com",
]);

export function isDisposableEmailDomain(email: string): boolean {
  return DISPOSABLE_EMAIL_DOMAINS.has(emailDomain(email));
}

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

export enum SignupMode {
  Open = "open",
  Approval = "approval",
  Closed = "closed",
}

export const DEFAULT_SIGNUP_MODE = SignupMode.Approval;

export function signupModeOf(stored: string | null): SignupMode {
  return Object.values(SignupMode).find((m) => m === stored) ?? DEFAULT_SIGNUP_MODE;
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

export interface StartSignupCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly ownerEmail: string;
  readonly ownerNameAr: string;
  readonly planId: string;
  readonly intendedPlanId?: string | null;
  readonly billingCycle: BillingCycle;
  readonly tokenHash: string;
  readonly now: string;
  readonly expiresInMs: number;
}

function validate(cmd: StartSignupCommand): string[] {
  const reasons: string[] = [];
  if (cmd.id.trim() === "") reasons.push("المعرّف مطلوب");
  if (!isValidSlug(cmd.code)) reasons.push("رمز المنشأة يجب أن يكون من 3 إلى 32 حرفًا إنجليزيًا صغيرًا أو رقمًا أو شرطة داخلية");
  else if (isReservedTenantCode(cmd.code)) reasons.push(RESERVED_TENANT_CODE_MESSAGE);
  const nameProblem = companyNameProblem(cmd.nameAr);
  if (nameProblem === CompanyNameProblem.Empty) reasons.push("اسم المنشأة بالعربية مطلوب");
  else if (nameProblem) reasons.push(companyNameProblemAr(nameProblem));
  if (cmd.ownerNameAr.trim() === "") reasons.push("اسم المالك مطلوب");
  if (normalizeEmail(cmd.ownerEmail) === "") reasons.push("البريد الإلكتروني مطلوب");
  if (cmd.tokenHash.trim() === "") reasons.push("رمز التفعيل مطلوب");
  if (!Number.isInteger(cmd.expiresInMs) || cmd.expiresInMs <= 0) reasons.push("مدة صلاحية الرابط غير صالحة");
  return reasons;
}

/**
 * Records the signup and hands back the pending request. Provisioning the
 * tenant itself is deliberately NOT done here — `apps/server/src/provision-tenant.ts`
 * only ever runs once {@link verifySignup} confirms the email address, so an
 * unverified inbox can never end up owning a live tenant.
 */
export async function startSignup(
  cmd: StartSignupCommand,
  repo: SignupRequestRepository,
  tenants: TenantRepository,
  plans: PlanRepository,
): Promise<SignupRequest> {
  const now = isoTimestamp(cmd.now);
  const reasons = validate(cmd);
  if (!now) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!now || reasons.length > 0) throw new InvalidSignupError(reasons);

  if (await tenants.findByCode(cmd.code)) throw new TenantCodeTakenError(cmd.code);
  if (await repo.findActiveByCode(cmd.code, now)) throw new TenantCodeTakenError(cmd.code);

  const plan = await plans.findById(cmd.planId);
  if (!plan || !plan.isPublic || plan.status !== "active") throw new PlanNotFoundError(cmd.planId);
  const intended = cmd.intendedPlanId ? await plans.findById(cmd.intendedPlanId) : null;
  if (intended?.soldOut) throw new InvalidSignupError(["الباقة المختارة نفدت حاليًا، اختر باقة أخرى"]);
  const intendedPlanId = intended && intended.isPublic && intended.status === "active" ? intended.id : null;

  const request: SignupRequest = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr.trim(),
    nameEn: cmd.nameEn?.trim() || null,
    ownerEmail: normalizeEmail(cmd.ownerEmail),
    ownerNameAr: cmd.ownerNameAr.trim(),
    planId: plan.id,
    intendedPlanId,
    billingCycle: cmd.billingCycle,
    tokenHash: cmd.tokenHash,
    status: SignupRequestStatus.Pending,
    expiresAt: new Date(new Date(now).getTime() + cmd.expiresInMs).toISOString(),
    createdAt: now,
    verifiedAt: null,
  };
  await repo.save(request);
  return request;
}

export const VERIFIED_LINK_VALID_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Consumes a verification token.
 *
 * Idempotent on an ALREADY-VERIFIED request — it returns it unchanged rather
 * than throwing — because the link is a plain `GET`-shaped URL and mail
 * scanners (Outlook Safe Links, corporate proxies) are known to prefetch it
 * before a person ever clicks. Throwing on the second hit would tell the
 * REAL click "this link is broken" for a request that actually succeeded.
 * Expiry is therefore only ever checked against a still-`Pending` request.
 *
 * The Pending → Verified transition itself goes through
 * {@link SignupRequestRepository.tryMarkVerified}'s conditional `UPDATE`, not
 * a read-then-`save()` — two concurrent calls on the same token (a scanner's
 * prefetch racing the real click, or two tabs on a slow connection) must
 * provision the tenant exactly once, and only a SQL-level compare-and-swap
 * closes that window; checking `request.status` in application code first
 * and writing after leaves the exact gap `card-checkout.ts`'s `settlePaid`
 * was built to avoid.
 */
export async function verifySignup(
  tokenHash: string,
  repo: SignupRequestRepository,
  now: string,
  tenants: Pick<TenantRepository, "findByCode">,
): Promise<SignupRequest> {
  const nowIso = isoTimestamp(now);
  if (!nowIso) throw new SignupTokenInvalidError();
  const request = await repo.findByTokenHash(tokenHash);
  if (!request || request.status === SignupRequestStatus.Released) throw new SignupTokenInvalidError();
  if (request.status === SignupRequestStatus.Verified) {
    const usedAt = new Date(request.verifiedAt ?? request.expiresAt).getTime();
    if (new Date(nowIso).getTime() - usedAt > VERIFIED_LINK_VALID_MS) {
      if (request.decision !== SignupDecision.Approved && !(await tenants.findByCode(request.code))) throw new SignupTokenExpiredError();
      const tenant = await tenants.findByCode(request.code);
      if (tenant?.status === TenantStatusCode.Provisioning) throw new SignupActivationIncompleteError();
      throw new SignupAlreadyActivatedError();
    }
    return request;
  }
  if (new Date(request.expiresAt).getTime() < new Date(nowIso).getTime()) throw new SignupTokenExpiredError();

  const won = await repo.tryMarkVerified(tokenHash, nowIso);
  if (won) return won;

  // Lost the race: another call already flipped this token between the read
  // above and the attempted update. That caller's write is the one that
  // provisions the tenant; this one just reports the same outcome.
  const after = await repo.findByTokenHash(tokenHash);
  if (after && after.status === SignupRequestStatus.Verified) return after;
  throw new SignupTokenInvalidError();
}
