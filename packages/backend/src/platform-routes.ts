import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  Money,
  createPlan,
  updatePlan,
  retirePlan,
  startSubscription,
  changePlan,
  cancelSubscription,
  suspendSubscription,
  resumeSubscription,
  suspendTenant,
  resumeTenant,
  archiveTenant,
  billingAnchorDayOf,
  setBillingAnchorDay,
  setSubscriptionExtras,
  recordPayment,
  createPlatformUser,
  deactivatePlatformUser,
  deriveEntitlements,
  subscriptionLicenseState,
  recordSecurityEvent,
  recordSecurityEventOrFallback,
  type AuditSeverity,
  type Subscription,
  InvalidTenantError,
  TenantNotFoundError,
  TenantCodeTakenError,
  InvalidTenantTransitionError,
  InvalidPlanError,
  PlanNotFoundError,
  PlanKind,
  PlanCodeTakenError,
  PlanRetiredError,
  PlanInUseError,
  FreePlanRequiredError,
  InvalidSubscriptionError,
  SubscriptionNotFoundError,
  TenantAlreadySubscribedError,
  InvalidSubscriptionTransitionError,
  InvalidPaymentError,
  PaymentIdempotencyConflictError,
  PaymentReferenceAlreadyRecordedError,
  InvalidPlatformUserError,
  PlatformUserEmailTakenError,
  PlatformUserNotFoundError,
  TenantStatusCode,
  tenantDbFileRefusalOf,
  type Tenant,
  type Plan,
  type Payment,
  type PlatformUser,
  CardCheckoutStatus,
  type CardCheckoutResolution,
  type SecretHasher,
  type CardCheckout,
  CardCheckoutUnavailableError,
  CardPaymentNotApplicableError,
  isReservedTenantCode,
  RESERVED_TENANT_CODE_MESSAGE,
  AuditSeverityCode,
  PlatformSettingKey,
  SignupDecision,
  SignupRequestStatus,
  signupModeOf,
  type SignupRequest,
} from "@mezan/domain";
import {
  createTenantRequestSchema,
  provisionRetryRequestSchema,
  assignOwnerRequestSchema,
  confirmTenantBooksRequestSchema,
  unbindTenantBooksRequestSchema,
  unlockTenantAccountRequestSchema,
  exportTenantBackupRequestSchema,
  tenantBackupDrillRequestSchema,
  TenantBackupDrillOutcome,
  TenantBackupRefusal,
  type TenantBackupDrillResultDTO,
  type TenantBackupListDTO,
  type TenantExportOfferDTO,
  setBillingAnchorDayRequestSchema,
  setSubscriptionExtrasRequestSchema,
  startSubscriptionRequestSchema,
  changePlanRequestSchema,
  subscriptionSuspendRequestSchema,
  subscriptionResumeRequestSchema,
  recordPaymentRequestSchema,
  applyCardCheckoutRequestSchema,
  resolveCardCheckoutRequestSchema,
  planCreateRequestSchema,
  subscriptionStatusOf,
  tenantDTOOf,
  licenseStateNameSchema,
  planUpdateRequestSchema,
  createPlatformUserRequestSchema,
  type CreateTenantRequestDTO,
  type ProvisionRetryRequestDTO,
  type ProvisionResultDTO,
  type OwnerPinResetResultDTO,
  type OwnerCandidateDTO,
  PlatformRefusalCode,
  REFUSED_TENANT_BOOKS,
  type TenantBooksDTO,
  type TenantBooksStanding,
  type TenantSummaryDTO,
  type TenantDTO,
  type PlanDTO,
  type PlanKindDTO,
  type PaymentDTO,
  type PlatformUserDTO,
  type CardCheckoutDTO,
  type CardCheckoutSweepResultDTO,
  type PlatformCardCheckoutsDTO,
  type PlatformOperationsDTO,
  acceptAuditRestoreRequestSchema,
  AuditRestoreRefusal,
  TenantAnchorState,
  TenantLifecycleRefusal,
  type AcceptAuditRestoreResultDTO,
  type TenantAuditAnchorDTO,
  extendTenantRetentionRequestSchema,
  purgeTenantNowRequestSchema,
  type TenantPurgeResultDTO,
  type TenantRetentionDTO,
  approveSignupRequestSchema,
  setSignupModeRequestSchema,
  signupModeSchema,
  type SignupRequestDTO,
  type SignupStatusDTO,
} from "@mezan/contracts";
import { connectionTurn, createLogger } from "@mezan/api";
import { OwnerPinResetOutcome } from "./owner-pin-reset-outcome.js";
import type { PlatformHandle } from "./create-platform.js";
import type { PlatformAuth } from "./platform-auth.js";

const platformLog = createLogger("platform");

export enum PlatformCardCheckoutRefusal {
  NotConfigured = "CARD_CHECKOUT_NOT_CONFIGURED",
  SweepRunning = "CARD_CHECKOUT_SWEEP_RUNNING",
}

export enum PlatformCardCheckoutAuditAction {
  SweepRun = "CARD_CHECKOUT_SWEEP_RUN",
}

export interface PlatformCardCheckoutPort {
  readonly testMode: boolean;
  open(input: { readonly tenantId: string; readonly actorId: string; readonly request: Request }): Promise<CardCheckout>;
  list(tenantId: string): Promise<CardCheckout[]>;
  sweep(): Promise<CardCheckoutSweepResultDTO | null>;
  applyUnapplied(input: {
    readonly tenantId: string;
    readonly checkoutId: string;
    readonly amount?: Money;
    readonly overrideAmount: boolean;
    readonly reason: string;
    readonly actorId: string;
  }): Promise<CardCheckout>;
  resolveFlagged(input: {
    readonly tenantId: string;
    readonly checkoutId: string;
    readonly resolution: CardCheckoutResolution;
    readonly reason: string;
    readonly actorId: string;
    readonly providerRef?: string;
    readonly amount?: Money;
    readonly overrideAmount: boolean;
  }): Promise<CardCheckout>;
}

export enum PlatformAuditAction {
  CardCheckoutRequested = "CARD_CHECKOUT_REQUESTED",
  PaymentRecorded = "PAYMENT_RECORDED",
  PlanCreated = "PLAN_CREATED",
  PlanRetired = "PLAN_RETIRED",
  PlanUpdated = "PLAN_UPDATED",
  PlatformUserCreated = "PLATFORM_USER_CREATED",
  PlatformUserDeactivated = "PLATFORM_USER_DEACTIVATED",
  SubscriptionAnchorDaySet = "SUBSCRIPTION_ANCHOR_DAY_SET",
  SubscriptionCancelled = "SUBSCRIPTION_CANCELLED",
  SubscriptionExtrasSet = "SUBSCRIPTION_EXTRAS_SET",
  SignupApproved = "SIGNUP_APPROVED",
  SignupRejected = "SIGNUP_REJECTED",
  SignupModeSet = "SIGNUP_MODE_SET",
  SubscriptionPlanChanged = "SUBSCRIPTION_PLAN_CHANGED",
  SubscriptionResumed = "SUBSCRIPTION_RESUMED",
  SubscriptionStarted = "SUBSCRIPTION_STARTED",
  SubscriptionSuspended = "SUBSCRIPTION_SUSPENDED",
  TenantArchived = "TENANT_ARCHIVED",
  TenantAccountUnlockRequested = "TENANT_ACCOUNT_UNLOCK_REQUESTED",
  TenantAccountUnlocked = "TENANT_ACCOUNT_UNLOCKED",
  TenantAccountUnlockRefused = "TENANT_ACCOUNT_UNLOCK_REFUSED",
  TenantBackupDrill = "TENANT_BACKUP_DRILL",
  TenantBackupExportRequested = "TENANT_BACKUP_EXPORT_REQUESTED",
  TenantBackupExported = "TENANT_BACKUP_EXPORTED",
  TenantBackupExportFailed = "TENANT_BACKUP_EXPORT_FAILED",
  TenantBackupExportDownloaded = "TENANT_BACKUP_EXPORT_DOWNLOADED",
  TenantBackupExportRefused = "TENANT_BACKUP_EXPORT_REFUSED",
  TenantOwnerPinReset = "TENANT_OWNER_PIN_RESET",
  TenantOwnerPinResetRefused = "TENANT_OWNER_PIN_RESET_REFUSED",
  TenantOwnerPinResetRequested = "TENANT_OWNER_PIN_RESET_REQUESTED",
  TenantProvisioned = "TENANT_PROVISIONED",
  TenantProvisionRetried = "TENANT_PROVISION_RETRIED",
  TenantResumed = "TENANT_RESUMED",
  TenantSuspended = "TENANT_SUSPENDED",
  TenantAuditRestoreAcceptRequested = "TENANT_AUDIT_RESTORE_ACCEPT_REQUESTED",
  TenantAuditRestoreAccepted = "TENANT_AUDIT_RESTORE_ACCEPTED",
  TenantAuditRestoreRefused = "TENANT_AUDIT_RESTORE_REFUSED",
  TenantRetentionExtended = "TENANT_RETENTION_EXTENDED",
  TenantPurgeRequested = "TENANT_PURGE_REQUESTED",
}

export interface PlatformTenantBooksPort {
  // CONTRACT: neither opens a tenant's database for use. The list asks
  // `lastStandingOf` for every tenant, so it must not read books it has read
  // before; `standingOf` reads them again when their file has changed.
  lastStandingOf(tenant: Tenant): Promise<TenantBooksStanding | null>;
  standingOf(tenant: Tenant): Promise<TenantBooksStanding | null>;
  read(tenant: Tenant): Promise<TenantBooksDTO>;
  // REQUIRED ORDERING: as for the owner routes, each of these writes its own
  // CRITICAL audit row in the same step as the change.
  confirm(input: { tenant: Tenant; userId: string; companyName: string | null; actorId: string }): Promise<Tenant>;
  disown(input: { tenant: Tenant; actorId: string }): Promise<Tenant>;
  unbind(input: { tenant: Tenant; actorId: string }): Promise<Tenant>;
}

export class TenantBackupRefusalError extends Error {
  constructor(
    readonly code: TenantBackupRefusal,
    message: string,
    readonly messageEn: string,
    readonly status: 404 | 409 | 422 | 503,
  ) {
    super(message);
    this.name = "TenantBackupRefusalError";
  }
}

export interface PlatformTenantBackupsPort {
  list(tenant: Tenant): Promise<TenantBackupListDTO["backups"]>;
  // CONTRACT: reads a scratch copy of a stored backup and never touches the tenant's live database.
  drill(input: { tenant: Tenant; file?: string }): Promise<TenantBackupDrillResultDTO>;
  // CONTRACT: the passphrase is used once and kept nowhere; the offer's path carries a single-use token.
  exportTenant(input: { tenant: Tenant; passphrase: string }): Promise<TenantExportOfferDTO>;
  // CONTRACT: single use. Null for any token that is unknown, spent, expired, or issued for another tenant.
  takeExport(input: { tenant: Tenant; token: string }): Promise<{ readonly body: ReadableStream<Uint8Array>; readonly fileName: string; readonly bytes: number } | null>;
}

export type PlatformAcceptRestoreResult =
  | { readonly accepted: true; readonly result: AcceptAuditRestoreResultDTO }
  | { readonly accepted: false; readonly refusal: AuditRestoreRefusal; readonly reason: string };

export interface PlatformAuditAnchorPort {
  // CONTRACT: reads only; never signs or writes an anchor.
  status(tenant: Tenant): Promise<TenantAuditAnchorDTO>;
  acceptRestore(input: { readonly tenant: Tenant; readonly reason: string; readonly actorId: string }): Promise<PlatformAcceptRestoreResult>;
}

export interface PlatformTenantRetentionPort {
  view(tenant: Tenant): TenantRetentionDTO;
  // REQUIRED ORDERING: called inside the archive's own write, so an archived tenant always has its deletion date.
  scheduleOnArchive(tenant: Tenant, at: string): void;
  // CONTRACT: false when `deleteAfter` is not later than the date already set.
  extend(input: { readonly tenant: Tenant; readonly deleteAfter: string; readonly reason: string; readonly actorId: string; readonly at: string }): boolean;
  // CONTRACT: refuses anything but an archived tenant; writes its own CRITICAL audit row with the deletion.
  purgeNow(input: { readonly tenant: Tenant; readonly reason: string; readonly actorId: string }): Promise<TenantPurgeResultDTO>;
}

const AUDIT_RESTORE_REFUSAL_COPY: Readonly<Record<AuditRestoreRefusal, { readonly message: string; readonly messageEn: string }>> = {
  [AuditRestoreRefusal.ReasonTooShort]: { message: "اكتب سبب الاستعادة بعشرة أحرف على الأقل.", messageEn: "Give the reason for the restore in at least ten characters." },
  [AuditRestoreRefusal.NoChain]: { message: "لا يوجد سجل تدقيق مسلسل لهذه المنشأة بعد.", messageEn: "This tenant has no chained audit trail yet." },
  [AuditRestoreRefusal.NothingAnchored]: { message: "لم يُختم سجل هذه المنشأة خارج الخادم بعد، فلا استعادة لاعتمادها.", messageEn: "Nothing has been anchored for this tenant yet, so there is no restore to accept." },
  [AuditRestoreRefusal.NothingToAccept]: { message: "سجل التدقيق يكمل آخر ختم مسجّل؛ لا توجد استعادة لاعتمادها.", messageEn: "The audit trail extends its newest anchor; there is no restore to accept." },
  [AuditRestoreRefusal.HeadInconsistent]: { message: "رأس سجل التدقيق لا يطابق صفّه؛ هذا ليس استعادة سليمة ولا يُعتمد.", messageEn: "The audit trail's head does not match its row; this is not a clean restore and cannot be accepted." },
  [AuditRestoreRefusal.NewestAnchorForged]: { message: "آخر ختم مسجّل لا يحمل توقيعًا صحيحًا؛ لا يُعتمد شيء فوقه. افحص مخزن الأختام.", messageEn: "The newest anchor on record is not validly signed; nothing is accepted over it. Inspect the anchor store." },
  [AuditRestoreRefusal.ChainBroken]: { message: "سلسلة سجل التدقيق المستعادة لا تتحقق بنفسها؛ لا تُعتمد.", messageEn: "The restored audit chain does not verify on its own; it cannot be accepted." },
};

export interface OwnerPinResetAccount {
  readonly userId: string;
  readonly signInEmail: string;
  readonly adminEmail: string;
}

export interface CreatePlatformRoutesOptions {
  readonly platform: PlatformHandle;
  readonly auth: PlatformAuth;
  readonly now: () => Date;
  readonly provisionTenant: (cmd: CreateTenantRequestDTO & { actorId: string }, activation: RecordedActivation) => Promise<ProvisionResultDTO>;
  /** Re-runs a failed provisioning (seed, admin, subscription) idempotently for a tenant stuck in `provisioning`. Optional only so a rig that never exercises this route still typechecks without supplying it. */
  readonly provisionRetry?: (input: { tenantId: string; actorId: string } & ProvisionRetryRequestDTO, activation: RecordedActivation) => Promise<ProvisionResultDTO>;
  readonly resetOwnerPin?: (input: { tenant: Tenant; actorId: string; recordIntent: (account: OwnerPinResetAccount) => Promise<void> }) => Promise<OwnerPinResetResultDTO>;
  readonly releaseTenant?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly lockedAccounts?: (tenant: Tenant) => Promise<readonly string[]>;
  // CONTRACT: false when the account is not locked. The tenant's own audit row
  // is the dependency's to write, in the step that clears the lock.
  readonly unlockAccount?: (input: { tenant: Tenant; account: string; actorId: string }) => Promise<boolean>;
  readonly ownerCandidates?: (tenant: Tenant) => Promise<OwnerCandidateDTO[]>;
  readonly assignOwner?: (input: { tenant: Tenant; userId: string; actorId: string }) => Promise<Tenant>;
  readonly confirmPendingOwner?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly declinePendingOwner?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly resendPendingOwner?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly tenantBooks?: PlatformTenantBooksPort;
  readonly tenantBackups?: PlatformTenantBackupsPort;
  readonly handOverMailConfigured?: boolean;
  // CONTRACT: must not throw; it runs in front of a read.
  readonly reconcileOwner?: (tenant: Tenant) => Promise<void>;
  // CONTRACT: only tenants whose backend is already open. The list must not open every tenant's database to draw itself.
  readonly reconcileOpenOwners?: () => Promise<void>;
  readonly operations?: () => PlatformOperationsDTO;
  readonly invalidateEntitlements: (code: string) => void;
  readonly idOf?: () => string;
  /** Absent when card checkout is not configured on this deployment; the routes then answer 503. */
  readonly cardCheckout?: PlatformCardCheckoutPort;
  /** Absent when audit anchoring is off on this deployment. */
  readonly auditAnchors?: PlatformAuditAnchorPort;
  /** Absent where tenant data is never purged (a rig, the desktop edition). */
  readonly tenantRetention?: PlatformTenantRetentionPort;
}

const serializeTenant = (t: Tenant): TenantDTO => tenantDTOOf(t);

/** The wire enum is a zod literal (`@mezan/contracts` may not import the domain); this is the one place it becomes `PlanKind`. */
function planKindOf(kind: PlanKindDTO | undefined): PlanKind | undefined {
  return kind === undefined ? undefined : kind === "free" ? PlanKind.Free : PlanKind.Paid;
}

function serializePlan(p: Plan): PlanDTO {
  return {
    id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn, modules: [...p.modules],
    features: { ...p.features }, seatsIncluded: p.seatsIncluded, branchesIncluded: p.branchesIncluded,
    warehousesIncluded: p.warehousesIncluded, kind: p.kind, quotas: { ...p.quotas },
    priceMonthly: p.priceMonthly.toString(), priceYearly: p.priceYearly.toString(),
    trialDays: p.trialDays, isPublic: p.isPublic, sortOrder: p.sortOrder, status: p.status, createdAt: p.createdAt,
  };
}

function serializePayment(p: Payment): PaymentDTO {
  return {
    id: p.id, tenantId: p.tenantId, subscriptionId: p.subscriptionId, amount: p.amount.toString(),
    currency: p.currency, reference: p.reference, paidAt: p.paidAt, recordedBy: p.recordedBy,
    note: p.note, createdAt: p.createdAt,
  };
}

export function serializeCardCheckout(c: CardCheckout): CardCheckoutDTO {
  return {
    id: c.id, tenantId: c.tenantId, subscriptionId: c.subscriptionId, provider: c.provider,
    testMode: c.provider === "paymob-test", amount: c.amount.toString(), currency: c.currency, status: c.status,
    checkoutUrl: c.status === CardCheckoutStatus.Pending ? c.checkoutUrl : null, providerRef: c.providerRef, paymentId: c.paymentId,
    failureReason: c.failureReason, capturedAmount: c.capturedAmount?.toString() ?? null, requestedBy: c.requestedBy,
    attentionCause: c.attentionCause, resolution: c.resolution, resolvedAt: c.resolvedAt, resolvedBy: c.resolvedBy,
    resolutionReason: c.resolutionReason, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

export function serializeCardCheckoutForTenant(c: CardCheckout): CardCheckoutDTO {
  return { ...serializeCardCheckout(c), resolvedBy: null, resolutionReason: null };
}

function serializePlatformUser(u: PlatformUser): PlatformUserDTO {
  return { id: u.id, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt };
}

async function tenantSummary(platform: PlatformHandle, tenant: Tenant, nowIso: string, onConsole: Pick<TenantSummaryDTO, "books" | "handOverMailConfigured">): Promise<TenantSummaryDTO> {
  const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
  const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
  const licenseState = subscriptionLicenseState(tenant, subscription, nowIso);
  const entitlements = plan && subscription ? deriveEntitlements(plan, subscription) : null;
  const payments = await platform.stores.payments.listByTenant(tenant.id);
  return {
    tenant: serializeTenant(tenant),
    subscription: subscription
      ? {
          id: subscription.id, tenantId: subscription.tenantId, planId: subscription.planId, status: subscriptionStatusOf(subscription.status),
          billingCycle: subscription.billingCycle, addOnModules: [...subscription.addOnModules],
          extraSeats: subscription.extraSeats, extraBranches: subscription.extraBranches, extraWarehouses: subscription.extraWarehouses,
          currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd,
          billingAnchorDay: billingAnchorDayOf(subscription), billingAnchorNeedsReview: subscription.billingAnchorNeedsReview === true,
          trialEndsAt: subscription.trialEndsAt, graceDays: subscription.graceDays, cancelledAt: subscription.cancelledAt,
          createdAt: subscription.createdAt, updatedAt: subscription.updatedAt,
        }
      : null,
    plan: plan ? serializePlan(plan) : null,
    licenseState: { ...licenseState, state: licenseStateNameSchema.parse(licenseState.state) },
    entitlements: entitlements
      ? {
          plan: entitlements.plan,
          activeModules: [...entitlements.activeModules],
          features: { ...entitlements.features },
          seats: entitlements.seats,
          expiresAt: entitlements.expiresAt,
          ...(entitlements.limits ? { limits: entitlements.limits } : {}),
        }
      : null,
    payments: payments.map(serializePayment),
    ...onConsole,
  };
}

/** Codes for the `apps/server`-only error classes (`provision-tenant.ts`'s `TenantProvisioningError` and `PlanRequiredError`) that map to 422 here. `@mezan/backend` cannot import an `apps/*` class, so each is recognised by shape (`.code` plus, for a provisioning failure, the tenant id it left in `provisioning`) instead of `instanceof`. */
const SERVER_DOMAIN_ERROR_CODES = new Set(["TENANT_PROVISIONING_FAILED", "PLAN_REQUIRED"]);
const SERVER_OWNER_CONFLICT_CODES: ReadonlySet<string> = new Set([
  PlatformRefusalCode.OwnerCandidateNotFound,
  PlatformRefusalCode.NoPendingOwner,
  PlatformRefusalCode.PendingOwnerExpired,
  PlatformRefusalCode.BooksBound,
  PlatformRefusalCode.BooksNotBound,
  PlatformRefusalCode.BooksChanged,
  PlatformRefusalCode.MailNotConfigured,
]);
const DB_FILE_RETRY_AFTER_SECONDS = 5;
const SERVER_OWNER_RETRY_CODE = "TENANT_OWNER_RECORD_DUE";
const OWNER_RETRY_AFTER_SECONDS = 5;

function asServerDomainFailure(err: unknown): { readonly code: string; readonly message: string; readonly tenantId?: string } | null {
  if (!(err instanceof Error)) return null;
  const shape = err as unknown as Record<string, unknown>;
  if (typeof shape.code !== "string" || !SERVER_DOMAIN_ERROR_CODES.has(shape.code)) return null;
  return { code: shape.code, message: err.message, ...(typeof shape.tenantId === "string" ? { tenantId: shape.tenantId } : {}) };
}

export class TenantOwnerAccountNotFoundError extends Error {
  readonly code = "TENANT_OWNER_ACCOUNT_NOT_FOUND";

  constructor(readonly outcome?: OwnerPinResetOutcome) {
    super("لا يوجد في المنشأة حساب مدير نشط ببريد مالكها.");
    this.name = "TenantOwnerAccountNotFoundError";
  }
}

export class PlatformAuditUnavailableError extends Error {
  readonly code = "AUDIT_UNAVAILABLE";
  constructor(cause: unknown) {
    super("تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.", { cause });
    this.name = "PlatformAuditUnavailableError";
  }
  readonly messageEn = "The audit log could not record this action, so nothing was saved. Try again.";
}

// EXTERNAL CONTRACT: a provisioner refuses a second call for a code it is
// already provisioning with an error carrying this code, `message` (Arabic)
// and `messageEn`. The console answers it 409.
export const TENANT_CODE_PROVISIONING = "TENANT_CODE_PROVISIONING";

function asCodeProvisioning(err: unknown): { readonly message: string; readonly messageEn: string } | null {
  if (!(err instanceof Error) || (err as { code?: unknown }).code !== TENANT_CODE_PROVISIONING) return null;
  const messageEn = (err as { messageEn?: unknown }).messageEn;
  return { message: err.message, messageEn: typeof messageEn === "string" ? messageEn : "This tenant code is being provisioned by another request right now." };
}

function serializeSignupRequest(r: SignupRequest): SignupRequestDTO {
  return {
    id: r.id, code: r.code, nameAr: r.nameAr, nameEn: r.nameEn, ownerEmail: r.ownerEmail, ownerNameAr: r.ownerNameAr,
    intendedPlanId: r.intendedPlanId ?? null, billingCycle: r.billingCycle, createdAt: r.createdAt, verifiedAt: r.verifiedAt,
  };
}

const SIGNUP_ALREADY_DECIDED = { error: "SIGNUP_ALREADY_DECIDED", message: "سبق البتّ في هذا الطلب" } as const;

class SignupAlreadyDecidedError extends Error {
  constructor() {
    super(SIGNUP_ALREADY_DECIDED.message);
  }
}

function extrasOf(s: Pick<Subscription, "addOnModules" | "extraSeats" | "extraBranches" | "extraWarehouses" | "graceDays">) {
  return { addOnModules: [...s.addOnModules], extraSeats: s.extraSeats, extraBranches: s.extraBranches, extraWarehouses: s.extraWarehouses, graceDays: s.graceDays };
}

function domainErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof TenantBackupRefusalError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, err.status);
  }
  if (err instanceof PlatformAuditUnavailableError) {
    platformLog.error({ err: err.cause }, "the platform audit trail is unavailable");
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 503);
  }
  const dbFileRefusal = tenantDbFileRefusalOf(err) ?? tenantDbFileRefusalOf(err instanceof Error ? err.cause : undefined);
  if (dbFileRefusal) {
    platformLog.error({ err }, "a tenant database file was refused");
    if (dbFileRefusal.retryable) c.header("Retry-After", String(DB_FILE_RETRY_AFTER_SECONDS));
    return c.json({ error: dbFileRefusal.error, message: dbFileRefusal.message, messageEn: dbFileRefusal.messageEn }, 503);
  }
  const inFlight = asCodeProvisioning(err);
  if (inFlight) return c.json({ error: TENANT_CODE_PROVISIONING, ...inFlight }, 409);
  const serverFailure = asServerDomainFailure(err);
  if (serverFailure) {
    return c.json({ error: serverFailure.code, message: serverFailure.message, ...(serverFailure.tenantId ? { tenantId: serverFailure.tenantId } : {}) }, 422);
  }
  if (err instanceof Error && (err as { code?: unknown }).code === SERVER_OWNER_RETRY_CODE) {
    platformLog.error({ err }, "the server owner was busy; the caller was asked to retry");
    c.header("Retry-After", String(OWNER_RETRY_AFTER_SECONDS));
    return c.json({ error: SERVER_OWNER_RETRY_CODE, message: err.message }, 503);
  }
  if (err instanceof Error && SERVER_OWNER_CONFLICT_CODES.has(String((err as { code?: unknown }).code))) {
    const messageEn = (err as { messageEn?: unknown }).messageEn;
    return c.json({ error: (err as unknown as { code: string }).code, message: err.message, ...(typeof messageEn === "string" ? { messageEn } : {}) }, 409);
  }
  if (err instanceof Error && (err as { code?: unknown }).code === "PAYMENT_PROVIDER_ERROR") {
    platformLog.error({ err }, "the payment provider could not be reached");
    return c.json({ error: "PAYMENT_PROVIDER_ERROR", message: "تعذّر الاتصال بمزوّد الدفع، حاول مرة أخرى", messageEn: "The payment provider could not be reached; try again" }, 502);
  }
  if (err instanceof CardCheckoutUnavailableError || err instanceof CardPaymentNotApplicableError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (
    err instanceof TenantNotFoundError ||
    err instanceof PlanNotFoundError ||
    err instanceof SubscriptionNotFoundError ||
    err instanceof PlatformUserNotFoundError
  ) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (
    err instanceof InvalidTenantError ||
    err instanceof InvalidPlanError ||
    err instanceof InvalidSubscriptionError ||
    err instanceof InvalidPaymentError ||
    err instanceof InvalidPlatformUserError
  ) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 422);
  }
  if (err instanceof PaymentReferenceAlreadyRecordedError) {
    return c.json(
      {
        error: err.code,
        message: err.message,
        messageEn: err.messageEn,
        details: { reference: err.reference, paymentId: err.recorded.id, amount: err.recorded.amount, paidAt: err.recorded.paidAt, recordedAt: err.recorded.recordedAt },
      },
      409,
    );
  }
  if (err instanceof PaymentIdempotencyConflictError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (
    err instanceof InvalidTenantTransitionError ||
    err instanceof InvalidSubscriptionTransitionError ||
    err instanceof TenantCodeTakenError ||
    err instanceof PlanCodeTakenError ||
    err instanceof PlatformUserEmailTakenError ||
    err instanceof TenantAlreadySubscribedError ||
    err instanceof PlanRetiredError ||
    err instanceof PlanInUseError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof FreePlanRequiredError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  throw err;
}

// REQUIRED ORDERING: a provisioner runs its last platform writes — the
// subscription and the tenant's activation — INSIDE this, so they commit with
// the event that records them or not at all.
export type RecordedActivation = (activate: () => Promise<Tenant>) => Promise<Tenant>;

export function createPlatformRoutes(options: CreatePlatformRoutesOptions): Hono {
  const { platform, auth, now, provisionTenant, provisionRetry, resetOwnerPin, releaseTenant, lockedAccounts, unlockAccount, tenantBackups, ownerCandidates, assignOwner, confirmPendingOwner, declinePendingOwner, resendPendingOwner, tenantBooks, reconcileOwner, reconcileOpenOwners, invalidateEntitlements, idOf = randomUUID } = options;
  const nowIso = () => now().toISOString();

  const booksReadAgain = async (tenant: Tenant): Promise<TenantBooksStanding | null> => (tenantBooks ? tenantBooks.standingOf(tenant) : null);

  // CONTRACT: with no standing handed in, the last one read is shown and no books are read again.
  async function summaryOf(tenant: Tenant, books?: TenantBooksStanding | null): Promise<TenantSummaryDTO> {
    return tenantSummary(platform, tenant, nowIso(), {
      books: books !== undefined ? books : tenantBooks ? await tenantBooks.lastStandingOf(tenant) : null,
      handOverMailConfigured: options.handOverMailConfigured === true,
    });
  }

  async function requireTenant(id: string): Promise<Tenant> {
    const tenant = await platform.stores.tenants.findById(id);
    if (!tenant) throw new TenantNotFoundError(id);
    return tenant;
  }

  /** Invalidates every tenant currently subscribed to this plan — a plan edit changes what they are entitled to. */
  async function invalidateTenantsOnPlan(planId: string): Promise<void> {
    const subscriptions = await platform.stores.subscriptions.listByPlan(planId);
    const codes = new Set<string>();
    for (const subscription of subscriptions) {
      const tenant = await platform.stores.tenants.findById(subscription.tenantId);
      if (tenant) codes.add(tenant.code);
    }
    for (const code of codes) invalidateEntitlements(code);
  }

  function noted(
    c: Context,
    action: string,
    entityId: string | null,
    details: Record<string, unknown>,
    severity: AuditSeverity = AuditSeverityCode.Info,
    actorId?: string,
  ): Promise<void> {
    return recordSecurityEventOrFallback(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId,
      action,
      actor: actorId ?? c.get("platformUser")?.id ?? "unknown",
      severity,
      timestamp: nowIso(),
      details: { ...details, origin: auth.sourceOf(c) ?? "host" },
    });
  }

  interface RecordedWrite<T> {
    readonly value: T;
    readonly action: string;
    readonly entityId: string | null;
    readonly details: Record<string, unknown>;
    readonly severity?: AuditSeverity;
  }

  function recordedWith<T>(c: Context, write: () => Promise<RecordedWrite<T>>): Promise<T> {
    const platformUser = c.get("platformUser");
    const together = async (): Promise<T> => {
      const { value, action, entityId, details, severity } = await write();
      await recordSecurityEvent(platform.audit, {
        module: "platform",
        entityType: "PLATFORM",
        entityId,
        action,
        actor: platformUser?.id ?? "unknown",
        severity: severity ?? AuditSeverityCode.Info,
        timestamp: nowIso(),
        details: { ...details, origin: auth.sourceOf(c) ?? "host" },
      }).catch((cause: unknown) => {
        throw new PlatformAuditUnavailableError(cause);
      });
      return value;
    };
    return platform.audit.atomic ? platform.audit.atomic(together) : together();
  }

  const activationRecordedAs = (c: Context, action: string): RecordedActivation => (activate) =>
    recordedWith(c, async () => {
      const tenant = await activate();
      return { value: tenant, action, entityId: tenant.id, details: { code: tenant.code } };
    });

  const requireAny = auth.requirePlatform();
  const requireOwner = auth.requirePlatform("owner");

  const app = new Hono();
  app.use("*", connectionTurn(platform.audit));
  app.route("/auth", auth.app);

  app.get("/tenants", requireAny, async (c) => {
    await reconcileOpenOwners?.();
    const tenants = await platform.stores.tenants.list();
    const summaries = await Promise.all(tenants.map((t) => summaryOf(t)));
    return c.json(summaries);
  });

  app.get("/tenants/:id", requireAny, async (c) => {
    try {
      const read = await requireTenant(c.req.param("id"));
      // REQUIRED ORDERING: the books are read first. Reconciling the owner opens
      // them for use, and refused books are not opened to draw a page.
      const books = await booksReadAgain(read);
      const refused = books !== null && REFUSED_TENANT_BOOKS.includes(books);
      if (reconcileOwner && !refused && (read.status === TenantStatusCode.Active || read.status === TenantStatusCode.Suspended)) await reconcileOwner(read);
      const tenant = await requireTenant(read.id);
      return c.json(await summaryOf(tenant, books));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants", requireOwner, async (c) => {
    const parsed = createTenantRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    if (isReservedTenantCode(parsed.data.code)) return c.json({ error: "TENANT_CODE_RESERVED", message: RESERVED_TENANT_CODE_MESSAGE }, 422);
    const platformUser = c.get("platformUser")!;
    try {
      const result = await provisionTenant({ ...parsed.data, actorId: platformUser.id }, activationRecordedAs(c, "TENANT_PROVISIONED"));
      invalidateEntitlements(result.tenant.code);
      return c.json(result, 201);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  const signupRequests = platform.stores.signupRequests;

  async function awaitingRequest(id: string): Promise<SignupRequest | null> {
    const request = await signupRequests.findById(id);
    return request && request.status === SignupRequestStatus.Verified && !request.decision ? request : null;
  }

  app.get("/signup-requests", requireAny, async (c) => c.json((await signupRequests.listAwaitingDecision()).map(serializeSignupRequest)));

  app.post("/signup-requests/:id/approve", requireOwner, async (c) => {
    const parsed = approveSignupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const request = await awaitingRequest(c.req.param("id"));
    if (!request) return c.json(SIGNUP_ALREADY_DECIDED, 409);
    const platformUser = c.get("platformUser")!;
    try {
      // The decision is written in the same audited transaction that activates the company, so an approval never exists without its company.
      const result = await provisionTenant(
        { code: request.code, nameAr: request.nameAr, nameEn: request.nameEn, ownerEmail: request.ownerEmail, ownerNameAr: request.ownerNameAr, ...parsed.data, actorId: platformUser.id },
        (activate) =>
          recordedWith(c, async () => {
            const tenant = await activate();
            if (!(await signupRequests.tryDecide(request.id, SignupDecision.Approved, platformUser.id, nowIso()))) throw new SignupAlreadyDecidedError();
            return { value: tenant, action: PlatformAuditAction.SignupApproved, entityId: tenant.id, details: { code: tenant.code, requestId: request.id, ...parsed.data } };
          }),
      );
      invalidateEntitlements(result.tenant.code);
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof SignupAlreadyDecidedError) return c.json(SIGNUP_ALREADY_DECIDED, 409);
      return domainErrorResponse(c, err);
    }
  });

  app.post("/signup-requests/:id/reject", requireOwner, async (c) => {
    const request = await awaitingRequest(c.req.param("id"));
    if (!request) return c.json(SIGNUP_ALREADY_DECIDED, 409);
    const platformUser = c.get("platformUser")!;
    try {
      await recordedWith(c, async () => {
        if (!(await signupRequests.tryDecide(request.id, SignupDecision.Rejected, platformUser.id, nowIso()))) throw new SignupAlreadyDecidedError();
        await signupRequests.releaseByCode(request.code);
        return { value: null, action: PlatformAuditAction.SignupRejected, entityId: request.id, details: { code: request.code, ownerEmail: request.ownerEmail } };
      });
      return c.json({ rejected: true });
    } catch (err) {
      if (err instanceof SignupAlreadyDecidedError) return c.json(SIGNUP_ALREADY_DECIDED, 409);
      return domainErrorResponse(c, err);
    }
  });

  const signupMode = async () => signupModeOf(await platform.stores.settings.get(PlatformSettingKey.SignupMode));

  app.get("/settings/signup-mode", requireAny, async (c) => {
    const body: SignupStatusDTO = { mode: signupModeSchema.parse(await signupMode()) };
    return c.json(body);
  });

  app.put("/settings/signup-mode", requireOwner, async (c) => {
    const parsed = setSignupModeRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      await recordedWith(c, async () => {
        const before = await signupMode();
        await platform.stores.settings.set(PlatformSettingKey.SignupMode, parsed.data.mode, nowIso());
        return { value: null, action: PlatformAuditAction.SignupModeSet, entityId: PlatformSettingKey.SignupMode, details: { before, after: parsed.data.mode }, severity: AuditSeverityCode.Warning };
      });
      const body: SignupStatusDTO = { mode: parsed.data.mode };
      return c.json(body);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/provision", requireOwner, async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = provisionRetryRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (tenant.status !== TenantStatusCode.Provisioning) {
        return c.json({ error: "TENANT_NOT_PROVISIONING", message: "المنشأة ليست قيد التجهيز" }, 409);
      }
      if (!provisionRetry) throw new Error("provisionRetry dependency is not configured");
      const result = await provisionRetry({ tenantId: tenant.id, actorId: c.get("platformUser")!.id, ...parsed.data }, activationRecordedAs(c, "TENANT_PROVISION_RETRIED"));
      invalidateEntitlements(result.tenant.code);
      return c.json(result, 200);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/release", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (tenant.status !== TenantStatusCode.Provisioning) {
        return c.json({ error: "TENANT_NOT_PROVISIONING", message: "المنشأة ليست قيد التجهيز" }, 409);
      }
      if (!releaseTenant) throw new Error("releaseTenant dependency is not configured");
      const released = await releaseTenant({ tenant, actorId: c.get("platformUser")!.id });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(released));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  const isLive = (tenant: Tenant): boolean => tenant.status === TenantStatusCode.Active || tenant.status === TenantStatusCode.Suspended;
  const TENANT_NOT_LIVE_FOR_OWNER = { error: PlatformRefusalCode.TenantNotLive, message: "لا يُعيَّن مالك إلا لمنشأة نشطة أو موقوفة" } as const;

  app.get("/tenants/:id/owner/candidates", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!isLive(tenant)) return c.json(TENANT_NOT_LIVE_FOR_OWNER, 409);
      if (!ownerCandidates) throw new Error("ownerCandidates dependency is not configured");
      return c.json(await ownerCandidates(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  // REQUIRED ORDERING: the CRITICAL audit rows, on the platform and inside the tenant, are written
  // by the dependency in the same step as the change: a route-level row could
  // be recorded for an assignment that then failed.
  app.post("/tenants/:id/owner", requireOwner, async (c) => {
    const parsed = assignOwnerRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!isLive(tenant)) return c.json(TENANT_NOT_LIVE_FOR_OWNER, 409);
      if (!assignOwner) throw new Error("assignOwner dependency is not configured");
      const assigned = await assignOwner({ tenant, userId: parsed.data.userId, actorId: c.get("platformUser")!.id });
      return c.json(await summaryOf(assigned));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/owner/confirm", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!isLive(tenant)) return c.json(TENANT_NOT_LIVE_FOR_OWNER, 409);
      if (!confirmPendingOwner) throw new Error("confirmPendingOwner dependency is not configured");
      const confirmed = await confirmPendingOwner({ tenant, actorId: c.get("platformUser")!.id });
      return c.json(await summaryOf(confirmed));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/owner/decline", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!isLive(tenant)) return c.json(TENANT_NOT_LIVE_FOR_OWNER, 409);
      if (!declinePendingOwner) throw new Error("declinePendingOwner dependency is not configured");
      const declined = await declinePendingOwner({ tenant, actorId: c.get("platformUser")!.id });
      return c.json(await summaryOf(declined));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/owner/resend", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!isLive(tenant)) return c.json(TENANT_NOT_LIVE_FOR_OWNER, 409);
      if (!resendPendingOwner) throw new Error("resendPendingOwner dependency is not configured");
      const resent = await resendPendingOwner({ tenant, actorId: c.get("platformUser")!.id });
      return c.json(await summaryOf(resent));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  const TENANT_NOT_LIVE_FOR_BOOKS = { error: PlatformRefusalCode.TenantNotLive, message: "لا تُراجَع إلا دفاتر منشأة نشطة أو موقوفة", messageEn: "Only an active or suspended company's books are reviewed" } as const;

  async function onLiveTenantBooks(c: Context, act: (books: PlatformTenantBooksPort, tenant: Tenant) => Promise<Response>): Promise<Response> {
    try {
      const tenant = await requireTenant(c.req.param("id") ?? "");
      if (!isLive(tenant)) return c.json(TENANT_NOT_LIVE_FOR_BOOKS, 409);
      if (!tenantBooks) throw new Error("tenantBooks dependency is not configured");
      return await act(tenantBooks, tenant);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  }

  app.get("/tenants/:id/books", requireOwner, (c) => onLiveTenantBooks(c, async (books, tenant) => c.json(await books.read(tenant))));

  app.post("/tenants/:id/books/confirm", requireOwner, async (c) => {
    const parsed = confirmTenantBooksRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    return onLiveTenantBooks(c, async (books, tenant) => {
      const confirmed = await books.confirm({ tenant, userId: parsed.data.userId, companyName: parsed.data.companyName, actorId: c.get("platformUser")!.id });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(confirmed, await booksReadAgain(confirmed)));
    });
  });

  app.post("/tenants/:id/books/disown", requireOwner, (c) =>
    onLiveTenantBooks(c, async (books, tenant) => {
      const disowned = await books.disown({ tenant, actorId: c.get("platformUser")!.id });
      return c.json(await summaryOf(disowned, await booksReadAgain(disowned)));
    }),
  );

  // SECURITY: the company's code is typed, as for a deletion: unbinding stops
  // the company being served until somebody confirms books for it again.
  app.post("/tenants/:id/books/unbind", requireOwner, async (c) => {
    const parsed = unbindTenantBooksRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    return onLiveTenantBooks(c, async (books, tenant) => {
      if (parsed.data.code !== tenant.code) {
        return c.json({ error: PlatformRefusalCode.TenantCodeMismatch, message: "الرمز المكتوب لا يطابق رمز هذه المنشأة", messageEn: "The typed code is not this company's code" }, 422);
      }
      const unbound = await books.unbind({ tenant, actorId: c.get("platformUser")!.id });
      return c.json(await summaryOf(unbound, await booksReadAgain(unbound)));
    });
  });

  app.get("/tenants/:id/locked-accounts", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const accounts = isLive(tenant) && lockedAccounts ? await lockedAccounts(tenant) : [];
      return c.json({ accounts: [...accounts] });
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  // REQUIRED ORDERING: the request is recorded, or refused with 503, BEFORE the
  // tenant's lock is touched. The lock lives in the tenant's own database and
  // cannot share a transaction with this row, so the row that says it was
  // asked for is the one that must not be missing.
  app.post("/tenants/:id/unlock-account", requireOwner, async (c) => {
    const parsed = unlockTenantAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const { account } = parsed.data;
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!isLive(tenant)) return c.json({ error: PlatformRefusalCode.TenantNotLive, message: "لا يُفكّ قفل حساب إلا في منشأة نشطة أو موقوفة", messageEn: "An account can be unlocked only in an active or suspended tenant." }, 409);
      if (!unlockAccount || !lockedAccounts) throw new Error("unlockAccount dependency is not configured");
      const details = { code: tenant.code, account };
      await recordedWith(c, async () => ({
        value: null,
        action: PlatformAuditAction.TenantAccountUnlockRequested,
        entityId: tenant.id,
        details,
        severity: AuditSeverityCode.Critical,
      }));
      const unlocked = await unlockAccount({ tenant, account, actorId: c.get("platformUser")!.id });
      await noted(c, unlocked ? PlatformAuditAction.TenantAccountUnlocked : PlatformAuditAction.TenantAccountUnlockRefused, tenant.id, details, AuditSeverityCode.Critical);
      if (!unlocked) return c.json({ error: "ACCOUNT_NOT_LOCKED", message: "هذا الحساب غير مقفل في هذه المنشأة.", messageEn: "This account is not locked in this tenant." }, 409);
      return c.json({ accounts: [...(await lockedAccounts(tenant))] });
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  const BACKUPS_UNAVAILABLE = new TenantBackupRefusalError(TenantBackupRefusal.Unavailable, "النسخ الاحتياطي للمنشآت غير مفعّل في هذا النشر", "Tenant backups are not enabled on this deployment", 503);
  const backupsPortOf = (): PlatformTenantBackupsPort => {
    if (!tenantBackups) throw BACKUPS_UNAVAILABLE;
    return tenantBackups;
  };
  const requireLiveForBackups = async (id: string): Promise<Tenant> => {
    const tenant = await requireTenant(id);
    if (!isLive(tenant)) {
      throw new TenantBackupRefusalError(TenantBackupRefusal.NotLive, "النسخ والتصدير لمنشأة نشطة أو موقوفة فقط", "Backups and exports are for an active or suspended tenant only", 409);
    }
    return tenant;
  };

  app.get("/tenants/:id/backups", requireOwner, async (c) => {
    try {
      const port = backupsPortOf();
      const tenant = await requireLiveForBackups(c.req.param("id"));
      return c.json({ backups: await platform.outsideTheTurn(() => port.list(tenant)) });
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/backups/drill", requireOwner, async (c) => {
    const parsed = tenantBackupDrillRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const port = backupsPortOf();
      const tenant = await requireLiveForBackups(c.req.param("id"));
      const result = await platform.outsideTheTurn(() => port.drill({ tenant, ...(parsed.data.file ? { file: parsed.data.file } : {}) }));
      const passed = result.outcome === TenantBackupDrillOutcome.Pass;
      await noted(
        c,
        PlatformAuditAction.TenantBackupDrill,
        tenant.id,
        { code: tenant.code, file: result.file, outcome: result.outcome, report: result.report, tableCount: result.tableCount, totalRows: result.totalRows },
        passed ? AuditSeverityCode.Info : AuditSeverityCode.Warning,
      );
      return c.json(result);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  // REQUIRED ORDERING: the snapshot, the integrity check and the encryption all run
  // outside the platform connection's turn, or every other operator waits behind them.
  // The request, with its reason, is recorded as CRITICAL (or
  // refused with 503) BEFORE the tenant's books are read. SECURITY: neither the
  // passphrase nor the download token reaches an audit row or a log line.
  app.post("/tenants/:id/export", requireOwner, async (c) => {
    const parsed = exportTenantBackupRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const { reason, passphrase } = parsed.data;
    let tenant: Tenant | null = null;
    try {
      const port = backupsPortOf();
      tenant = await requireLiveForBackups(c.req.param("id"));
      const details = { code: tenant.code, reason };
      await recordedWith(c, async () => ({ value: null, action: PlatformAuditAction.TenantBackupExportRequested, entityId: tenant!.id, details, severity: AuditSeverityCode.Critical }));
      const offer = await platform.outsideTheTurn(() => port.exportTenant({ tenant: tenant!, passphrase }));
      await noted(c, PlatformAuditAction.TenantBackupExported, tenant.id, { ...details, fileName: offer.fileName, bytes: offer.bytes, tableCount: offer.tableCount, totalRows: offer.totalRows, expiresAt: offer.expiresAt }, AuditSeverityCode.Critical);
      c.header("Cache-Control", "no-store");
      return c.json(offer);
    } catch (err) {
      if (tenant && err instanceof TenantBackupRefusalError) {
        await noted(c, PlatformAuditAction.TenantBackupExportFailed, tenant.id, { code: tenant.code, reason, refusal: err.code }, AuditSeverityCode.Warning);
      }
      return domainErrorResponse(c, err);
    }
  });

  app.get("/tenants/:id/export/:token", requireOwner, async (c) => {
    try {
      const port = backupsPortOf();
      const tenant = await requireLiveForBackups(c.req.param("id"));
      const taken = await platform.outsideTheTurn(() => port.takeExport({ tenant, token: c.req.param("token") }));
      if (!taken) {
        await noted(c, PlatformAuditAction.TenantBackupExportRefused, tenant.id, { code: tenant.code }, AuditSeverityCode.Warning);
        throw new TenantBackupRefusalError(TenantBackupRefusal.ExportGone, "رابط التنزيل غير صالح أو استُخدم أو انتهت مدته. أنشئ تصديرًا جديدًا.", "The download link is invalid, already used, or expired. Create a new export.", 404);
      }
      try {
        await recordSecurityEvent(platform.audit, {
          module: "platform",
          entityType: "PLATFORM",
          entityId: tenant.id,
          action: PlatformAuditAction.TenantBackupExportDownloaded,
          actor: c.get("platformUser")?.id ?? "unknown",
          severity: AuditSeverityCode.Critical,
          timestamp: nowIso(),
          details: { code: tenant.code, fileName: taken.fileName, bytes: taken.bytes, origin: auth.sourceOf(c) ?? "host" },
        });
      } catch (cause) {
        await taken.body.cancel().catch(() => undefined);
        throw new PlatformAuditUnavailableError(cause);
      }
      return new Response(taken.body, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(taken.bytes),
          "content-disposition": `attachment; filename="${taken.fileName}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  const ownerPinResetRefused = (c: Context, tenantId: string | null, reason: string, actorId?: string, outcome?: OwnerPinResetOutcome) =>
    noted(c, PlatformAuditAction.TenantOwnerPinResetRefused, tenantId, { reason, ...(outcome ? { outcome } : {}) }, AuditSeverityCode.Critical, actorId);

  const requireOwnerForPinReset = auth.requirePlatform("owner", (c, user) =>
    ownerPinResetRefused(c, c.req.param("id") ?? null, "OWNER_ONLY", user.id),
  );

  app.post("/tenants/:id/owner-pin/reset", requireOwnerForPinReset, async (c) => {
    const platformUser = c.get("platformUser")!;
    const tenantId = c.req.param("id");
    try {
      const tenant = await requireTenant(tenantId);
      if (tenant.status !== TenantStatusCode.Active && tenant.status !== TenantStatusCode.Suspended) {
        await ownerPinResetRefused(c, tenant.id, PlatformRefusalCode.TenantNotLive);
        return c.json({ error: PlatformRefusalCode.TenantNotLive, message: "لا يُعاد تعيين رمز المالك إلا لمنشأة نشطة أو موقوفة" }, 409);
      }
      if (!resetOwnerPin) throw new Error("resetOwnerPin dependency is not configured");
      const intent: { account: OwnerPinResetAccount | null } = { account: null };
      const recordIntent = async (account: OwnerPinResetAccount): Promise<void> => {
        await recordedWith(c, async () => ({
          value: null,
          action: PlatformAuditAction.TenantOwnerPinResetRequested,
          entityId: tenant.id,
          details: { code: tenant.code, ...account },
          severity: AuditSeverityCode.Critical,
        }));
        intent.account = account;
      };
      const result = await resetOwnerPin({ tenant, actorId: platformUser.id, recordIntent });
      const account = intent.account ?? { signInEmail: result.signInEmail, adminEmail: result.adminEmail };
      // SECURITY: the PIN has moved by now and this answer is the only place it
      // is shown. An outcome row that cannot be written is logged, never turned
      // into a refusal: the intent row written before the PIN moved stands.
      await noted(c, PlatformAuditAction.TenantOwnerPinReset, tenant.id, { code: tenant.code, ...account, outcome: OwnerPinResetOutcome.Reset }, AuditSeverityCode.Critical).catch(
        (err: unknown) => platformLog.error({ err: err }, `the owner PIN of tenant "${tenant.id}" was reset, and its outcome row could not be written`),
      );
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof TenantOwnerAccountNotFoundError) {
        await ownerPinResetRefused(c, tenantId, err.code, undefined, err.outcome);
        return c.json({ error: err.code, message: err.message }, 409);
      }
      return domainErrorResponse(c, err);
    }
  });

  const auditAnchors = options.auditAnchors;
  const anchoringDisabled = (c: Context) =>
    c.json(
      {
        error: TenantLifecycleRefusal.AnchoringDisabled,
        message: "ختم سجل التدقيق خارج الخادم غير مفعّل على هذه المنصة.",
        messageEn: "Audit anchoring outside the server is not enabled on this platform.",
      },
      503,
    );
  const tenantNotLive = (c: Context) =>
    c.json({ error: TenantLifecycleRefusal.TenantNotLive, message: "هذا الإجراء لمنشأة نشطة أو موقوفة فقط.", messageEn: "This is only for an active or suspended tenant." }, 409);
  const isLiveTenant = (tenant: Tenant) => tenant.status === TenantStatusCode.Active || tenant.status === TenantStatusCode.Suspended;
  const DISABLED_ANCHOR: TenantAuditAnchorDTO = {
    state: TenantAnchorState.Disabled,
    refusal: null,
    latestAnchoredSeq: null,
    latestAnchoredAt: null,
    liveHeadSeq: null,
    lastRebase: null,
    canAcceptRestore: false,
  };

  app.get("/tenants/:id/audit-anchor", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!auditAnchors || !isLiveTenant(tenant)) return c.json(DISABLED_ANCHOR);
      return c.json(await auditAnchors.status(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/audit-anchor/accept-restore", requireOwner, async (c) => {
    const parsed = acceptAuditRestoreRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!auditAnchors) return anchoringDisabled(c);
      if (!isLiveTenant(tenant)) return tenantNotLive(c);
      const refused = await auth.confirmPassword(c, parsed.data.password);
      if (refused) return refused;
      const actorId = c.get("platformUser")!.id;
      const { reason } = parsed.data;
      await recordedWith(c, async () => ({
        value: null,
        action: PlatformAuditAction.TenantAuditRestoreAcceptRequested,
        entityId: tenant.id,
        details: { code: tenant.code, reason },
        severity: AuditSeverityCode.Critical,
      }));
      const outcome = await auditAnchors.acceptRestore({ tenant, reason, actorId });
      if (!outcome.accepted) {
        await noted(c, PlatformAuditAction.TenantAuditRestoreRefused, tenant.id, { code: tenant.code, reason, refusal: outcome.refusal, detail: outcome.reason }, AuditSeverityCode.Critical);
        return c.json({ error: TenantLifecycleRefusal.RestoreNotAccepted, reason: outcome.refusal, ...AUDIT_RESTORE_REFUSAL_COPY[outcome.refusal], detail: outcome.reason }, 409);
      }
      // SECURITY: the rebase is already signed and stored outside the server; an outcome row that cannot be
      // written is logged rather than turned into a refusal, and the intent row above stands.
      await noted(c, PlatformAuditAction.TenantAuditRestoreAccepted, tenant.id, { code: tenant.code, reason, ...outcome.result }, AuditSeverityCode.Critical).catch((err: unknown) =>
        platformLog.error({ err }, `the restore of tenant "${tenant.id}" was accepted, and its outcome row could not be written`),
      );
      return c.json(outcome.result);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  const tenantRetention = options.tenantRetention;
  const purgeUnavailable = (c: Context) =>
    c.json({ error: TenantLifecycleRefusal.PurgeUnavailable, message: "حذف بيانات المنشآت غير مفعّل على هذه المنصة.", messageEn: "Tenant data deletion is not enabled on this platform." }, 503);
  const notTerminated = (c: Context) =>
    c.json(
      { error: TenantLifecycleRefusal.NotTerminated, message: "لا تُحذف بيانات منشأة إلا بعد أرشفتها.", messageEn: "A tenant's data is deleted only after the tenant is archived." },
      409,
    );

  app.get("/tenants/:id/retention", requireAny, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!tenantRetention) return c.json({ retentionDays: 0, retention: null } satisfies TenantRetentionDTO);
      return c.json(tenantRetention.view(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/retention/extend", requireOwner, async (c) => {
    const parsed = extendTenantRetentionRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!tenantRetention) return purgeUnavailable(c);
      if (tenant.status !== TenantStatusCode.Archived) return notTerminated(c);
      const before = tenantRetention.view(tenant).retention;
      const deleteAfter = `${parsed.data.deleteAfter}T00:00:00.000Z`;
      const later = before !== null && deleteAfter > before.deleteAfter;
      if (later) {
        const refused = await auth.confirmPassword(c, parsed.data.password);
        if (refused) return refused;
      }
      const at = nowIso();
      const moved = later && await recordedWith(c, async () => {
        const extended = tenantRetention.extend({ tenant, deleteAfter, reason: parsed.data.reason, actorId: c.get("platformUser")!.id, at });
        return {
          value: extended,
          action: PlatformAuditAction.TenantRetentionExtended,
          entityId: tenant.id,
          details: { code: tenant.code, from: before?.deleteAfter ?? null, to: deleteAfter, reason: parsed.data.reason, applied: extended },
          severity: AuditSeverityCode.Critical,
        };
      });
      if (!moved) {
        return c.json(
          {
            error: TenantLifecycleRefusal.RetentionNotLater,
            message: "التاريخ الجديد يجب أن يكون بعد موعد الحذف الحالي. لتقديم الحذف استخدم «حذف البيانات الآن».",
            messageEn: "The new date must be later than the current deletion date. To delete sooner, use “Delete the data now”.",
          },
          409,
        );
      }
      return c.json(tenantRetention.view(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/retention/purge", requireOwner, async (c) => {
    const parsed = purgeTenantNowRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      if (!tenantRetention) return purgeUnavailable(c);
      if (tenant.status !== TenantStatusCode.Archived) return notTerminated(c);
      if (parsed.data.confirmCode !== tenant.code) {
        return c.json(
          { error: TenantLifecycleRefusal.ConfirmCodeMismatch, message: "الرمز المكتوب لا يطابق رمز المنشأة.", messageEn: "The code typed does not match the tenant's code." },
          422,
        );
      }
      const refused = await auth.confirmPassword(c, parsed.data.password);
      if (refused) return refused;
      const actorId = c.get("platformUser")!.id;
      await recordedWith(c, async () => ({
        value: null,
        action: PlatformAuditAction.TenantPurgeRequested,
        entityId: tenant.id,
        details: { code: tenant.code, reason: parsed.data.reason },
        severity: AuditSeverityCode.Critical,
      }));
      const result = await tenantRetention.purgeNow({ tenant, reason: parsed.data.reason, actorId });
      invalidateEntitlements(tenant.code);
      return c.json(result);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/suspend", requireOwner, async (c) => {
    try {
      const tenant = await recordedWith(c, async () => {
        const moved = await suspendTenant({ id: c.req.param("id"), now: nowIso() }, platform.stores.tenants);
        return { value: moved, action: "TENANT_SUSPENDED", entityId: moved.id, details: {} };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/resume", requireOwner, async (c) => {
    try {
      const tenant = await recordedWith(c, async () => {
        const moved = await resumeTenant({ id: c.req.param("id"), now: nowIso() }, platform.stores.tenants);
        return { value: moved, action: "TENANT_RESUMED", entityId: moved.id, details: {} };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/archive", requireOwner, async (c) => {
    try {
      const tenant = await recordedWith(c, async () => {
        const at = nowIso();
        const moved = await archiveTenant({ id: c.req.param("id"), now: at }, platform.stores.tenants);
        options.tenantRetention?.scheduleOnArchive(moved, at);
        const deleteAfter = options.tenantRetention?.view(moved).retention?.deleteAfter ?? null;
        return { value: moved, action: "TENANT_ARCHIVED", entityId: moved.id, details: deleteAfter ? { deleteAfter } : {} };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/subscription", requireOwner, async (c) => {
    const parsed = startSubscriptionRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      await recordedWith(c, async () => {
        await startSubscription(
          { id: idOf(), tenantId: tenant.id, ...parsed.data, now: nowIso() },
          platform.stores.subscriptions,
          platform.stores.plans,
        );
        return { value: null, action: "SUBSCRIPTION_STARTED", entityId: tenant.id, details: { planId: parsed.data.planId } };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant), 201);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  async function requireLiveSubscription(tenant: Tenant) {
    const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
    if (!subscription) throw new SubscriptionNotFoundError(tenant.id);
    return subscription;
  }

  app.post("/tenants/:id/subscription/change-plan", requireOwner, async (c) => {
    const parsed = changePlanRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      await recordedWith(c, async () => {
        const subscription = await requireLiveSubscription(tenant);
        await changePlan({ id: subscription.id, planId: parsed.data.planId, now: nowIso() }, platform.stores.subscriptions, platform.stores.plans);
        return { value: null, action: "SUBSCRIPTION_PLAN_CHANGED", entityId: tenant.id, details: { planId: parsed.data.planId } };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/subscription/cancel", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      await recordedWith(c, async () => {
        const subscription = await requireLiveSubscription(tenant);
        await cancelSubscription({ id: subscription.id, now: nowIso() }, platform.stores.subscriptions);
        return { value: null, action: "SUBSCRIPTION_CANCELLED", entityId: tenant.id, details: {} };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/subscription/anchor-day", requireOwner, async (c) => {
    const parsed = setBillingAnchorDayRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const subscription = await requireLiveSubscription(tenant);
      await recordedWith(c, async () => {
        await setBillingAnchorDay({ id: subscription.id, day: parsed.data.day, now: nowIso() }, platform.stores.subscriptions);
        return {
          value: null,
          action: PlatformAuditAction.SubscriptionAnchorDaySet,
          entityId: tenant.id,
          details: { before: billingAnchorDayOf(subscription), after: parsed.data.day, neededReview: subscription.billingAnchorNeedsReview === true },
          severity: AuditSeverityCode.Warning,
        };
      });
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/subscription/extras", requireOwner, async (c) => {
    const parsed = setSubscriptionExtrasRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      await recordedWith(c, async () => {
        const subscription = await requireLiveSubscription(tenant);
        const saved = await setSubscriptionExtras({ id: subscription.id, ...parsed.data, now: nowIso() }, platform.stores.subscriptions);
        return {
          value: null,
          action: PlatformAuditAction.SubscriptionExtrasSet,
          entityId: tenant.id,
          details: { before: extrasOf(subscription), after: extrasOf(saved) },
          severity: AuditSeverityCode.Warning,
        };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/subscription/suspend", requireOwner, async (c) => {
    const parsed = subscriptionSuspendRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      await recordedWith(c, async () => {
        const subscription = await requireLiveSubscription(tenant);
        await suspendSubscription({ id: subscription.id, now: nowIso() }, platform.stores.subscriptions);
        return { value: null, action: "SUBSCRIPTION_SUSPENDED", entityId: tenant.id, details: { reason: parsed.data.reason } };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/subscription/resume", requireOwner, async (c) => {
    const parsed = subscriptionResumeRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const tenant = await requireTenant(c.req.param("id"));
      await recordedWith(c, async () => {
        const subscription = await requireLiveSubscription(tenant);
        await resumeSubscription({ id: subscription.id, now: nowIso() }, platform.stores.subscriptions);
        return { value: null, action: "SUBSCRIPTION_RESUMED", entityId: tenant.id, details: { reason: parsed.data.reason } };
      });
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/payments", requireOwner, async (c) => {
    const parsed = recordPaymentRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const platformUser = c.get("platformUser")!;
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const subscription = await requireLiveSubscription(tenant);
      const result = await recordPayment(
        {
          id: idOf(),
          tenantId: tenant.id,
          subscriptionId: subscription.id,
          amount: Money.fromMajor(parsed.data.amount),
          reference: parsed.data.reference,
          paidAt: parsed.data.paidAt,
          recordedBy: platformUser.id,
          note: parsed.data.note ?? null,
          now: nowIso(),
          idempotencyKey: parsed.data.idempotencyKey,
          confirmDuplicateReference: parsed.data.confirmDuplicateReference === true,
        },
        platform.stores.payments,
        platform.stores.subscriptions,
        {
          onRecorded: ({ payment, duplicateOfPaymentId }) =>
            recordSecurityEvent(platform.audit, {
              module: "platform",
              entityType: "PLATFORM",
              entityId: tenant.id,
              action: "PAYMENT_RECORDED",
              actor: platformUser.id,
              severity: "INFO",
              timestamp: nowIso(),
              details: {
                paymentId: payment.id, amount: parsed.data.amount, reference: payment.reference, origin: auth.sourceOf(c) ?? "host",
                ...(duplicateOfPaymentId === null ? {} : { duplicateOfPaymentId, duplicateReferenceConfirmed: true }),
              },
            }).catch((cause: unknown) => {
              throw new PlatformAuditUnavailableError(cause);
            }),
        },
      );
      if (result.replayed) return c.json(await summaryOf(tenant), 200);
      invalidateEntitlements(tenant.code);
      return c.json(await summaryOf(tenant), 201);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.get("/tenants/:id/payments", requireAny, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const payments = await platform.stores.payments.listByTenant(tenant.id);
      return c.json(payments.map(serializePayment));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/card-checkout", requireOwner, async (c) => {
    if (!options.cardCheckout) {
      return c.json({ error: "CARD_CHECKOUT_NOT_CONFIGURED", message: "الدفع بالبطاقة غير مُفعّل على هذا الخادم", messageEn: "Card checkout is not configured on this server" }, 503);
    }
    const platformUser = c.get("platformUser")!;
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const checkout = await options.cardCheckout.open({ tenantId: tenant.id, actorId: `platform:${platformUser.id}`, request: c.req.raw });
      await noted(c, "CARD_CHECKOUT_REQUESTED", tenant.id, { checkoutId: checkout.id, amount: checkout.amount.toString() });
      return c.json(serializeCardCheckout(checkout), 201);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.get("/tenants/:id/card-checkouts", requireAny, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const checkouts = options.cardCheckout ? await options.cardCheckout.list(tenant.id) : [];
      const body: PlatformCardCheckoutsDTO = {
        cardCheckout: Boolean(options.cardCheckout),
        testMode: options.cardCheckout?.testMode ?? false,
        checkouts: checkouts.map(serializeCardCheckout),
      };
      return c.json(body);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  const cardCheckoutNotConfigured = (c: Context) =>
    c.json({ error: PlatformCardCheckoutRefusal.NotConfigured, message: "الدفع بالبطاقة غير مُفعّل على هذا الخادم", messageEn: "Card checkout is not configured on this server" }, 503);

  app.post("/card-checkouts/sweep", requireOwner, async (c) => {
    if (!options.cardCheckout) return cardCheckoutNotConfigured(c);
    const result = await options.cardCheckout.sweep();
    if (!result) {
      return c.json(
        {
          error: PlatformCardCheckoutRefusal.SweepRunning,
          message: "مطابقة العمليات المعلّقة جارية بالفعل، انتظر انتهاءها ثم أعد المحاولة",
          messageEn: "A reconciliation pass is already running; try again when it finishes",
        },
        409,
      );
    }
    await noted(c, PlatformCardCheckoutAuditAction.SweepRun, null, { ...result });
    return c.json(result);
  });

  app.post("/tenants/:id/card-checkouts/:checkoutId/apply", requireOwner, async (c) => {
    if (!options.cardCheckout) return cardCheckoutNotConfigured(c);
    const parsed = applyCardCheckoutRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const platformUser = c.get("platformUser")!;
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const checkout = await options.cardCheckout.applyUnapplied({
        tenantId: tenant.id,
        checkoutId: c.req.param("checkoutId"),
        ...(parsed.data.amount === undefined ? {} : { amount: Money.fromMajor(parsed.data.amount) }),
        overrideAmount: parsed.data.overrideAmount === true,
        reason: parsed.data.reason,
        actorId: platformUser.id,
      });
      return c.json(serializeCardCheckout(checkout));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/card-checkouts/:checkoutId/resolve", requireOwner, async (c) => {
    if (!options.cardCheckout) return cardCheckoutNotConfigured(c);
    const parsed = resolveCardCheckoutRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const platformUser = c.get("platformUser")!;
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const checkout = await options.cardCheckout.resolveFlagged({
        tenantId: tenant.id,
        checkoutId: c.req.param("checkoutId"),
        resolution: parsed.data.resolution as CardCheckoutResolution,
        reason: parsed.data.reason,
        actorId: platformUser.id,
        ...(parsed.data.providerRef === undefined ? {} : { providerRef: parsed.data.providerRef }),
        ...(parsed.data.amount === undefined ? {} : { amount: Money.fromMajor(parsed.data.amount) }),
        overrideAmount: parsed.data.overrideAmount === true,
      });
      return c.json(serializeCardCheckout(checkout));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.get("/plans", requireAny, async (c) => {
    const plans = await platform.stores.plans.list();
    return c.json(plans.map(serializePlan));
  });

  app.post("/plans", requireOwner, async (c) => {
    const parsed = planCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const plan = await recordedWith(c, async () => {
        const created = await createPlan(
        {
          id: idOf(),
          code: parsed.data.code,
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn,
          modules: parsed.data.modules,
          features: parsed.data.features,
          seatsIncluded: parsed.data.seatsIncluded,
          branchesIncluded: parsed.data.branchesIncluded,
          warehousesIncluded: parsed.data.warehousesIncluded,
          priceMonthly: Money.fromMajor(parsed.data.priceMonthly),
          priceYearly: Money.fromMajor(parsed.data.priceYearly),
          kind: planKindOf(parsed.data.kind),
          quotas: parsed.data.quotas,
          trialDays: parsed.data.trialDays,
          isPublic: parsed.data.isPublic,
          sortOrder: parsed.data.sortOrder,
          now: nowIso(),
        },
        platform.stores.plans,
        );
        return { value: created, action: "PLAN_CREATED", entityId: created.id, details: { code: created.code } };
      });
      await invalidateTenantsOnPlan(plan.id);
      return c.json(serializePlan(plan), 201);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.put("/plans/:id", requireOwner, async (c) => {
    const parsed = planUpdateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const { priceMonthly, priceYearly, kind, ...rest } = parsed.data;
    try {
      const plan = await recordedWith(c, async () => {
        const updated = await updatePlan(
        {
          id: c.req.param("id"),
          ...rest,
          kind: planKindOf(kind),
          priceMonthly: Money.fromMajor(priceMonthly),
          priceYearly: Money.fromMajor(priceYearly),
        },
        platform.stores.plans,
        (planId) => platform.stores.subscriptions.hasLiveByPlan(planId),
        );
        return { value: updated, action: "PLAN_UPDATED", entityId: updated.id, details: { code: updated.code } };
      });
      await invalidateTenantsOnPlan(plan.id);
      return c.json(serializePlan(plan));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/plans/:id/retire", requireOwner, async (c) => {
    try {
      const plan = await recordedWith(c, async () => {
        const retired = await retirePlan({ id: c.req.param("id") }, platform.stores.plans);
        return { value: retired, action: "PLAN_RETIRED", entityId: retired.id, details: { code: retired.code } };
      });
      await invalidateTenantsOnPlan(plan.id);
      return c.json(serializePlan(plan));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.get("/operations", requireOwner, (c) => {
    if (!options.operations) return c.json({ error: "OPERATIONS_UNAVAILABLE", message: "حالة التشغيل غير متاحة على هذا الخادم.", messageEn: "Operations status is not available on this server." }, 404);
    return c.json(options.operations());
  });

  app.get("/security/unrecorded", requireOwner, (c) => {
    const { count, recent, dropped, corrupted } = platform.audit.unrecorded?.summary() ?? { count: 0, recent: [], dropped: 0, corrupted: 0 };
    return c.json({
      count,
      dropped,
      corrupted,
      recent: recent.map(({ at, module, action, severity, actor, entityId, reason, details }) => ({ at, module, action, severity, actor, entityId, reason, details: details ?? null })),
    });
  });

  app.get("/users", requireAny, async (c) => {
    const users = await platform.stores.platformUsers.list();
    return c.json(users.map(serializePlatformUser));
  });

  app.post("/users", requireOwner, async (c) => {
    const parsed = createPlatformUserRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const passwordHash = await platform.hasher.hash(parsed.data.password);
      const hashedOnce: SecretHasher = { hash: async () => passwordHash, verify: platform.hasher.verify };
      const user = await recordedWith(c, async () => {
        const created = await createPlatformUser({ id: idOf(), ...parsed.data, now: nowIso() }, platform.stores.platformUsers, hashedOnce);
        return { value: created, action: "PLATFORM_USER_CREATED", entityId: created.id, details: { email: created.email, role: created.role } };
      });
      return c.json(serializePlatformUser(user), 201);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/users/:id/deactivate", requireOwner, async (c) => {
    const platformUser = c.get("platformUser")!;
    try {
      const user = await recordedWith(c, async () => {
        const deactivated = await deactivatePlatformUser({ id: c.req.param("id"), actorId: platformUser.id }, platform.stores.platformUsers);
        return { value: deactivated, action: "PLATFORM_USER_DEACTIVATED", entityId: deactivated.id, details: {} };
      });
      return c.json(serializePlatformUser(user));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  return app;
}
