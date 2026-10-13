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
  recordPayment,
  createPlatformUser,
  deactivatePlatformUser,
  deriveEntitlements,
  subscriptionLicenseState,
  recordSecurityEvent,
  type AuditSeverity,
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
  InvalidSubscriptionError,
  SubscriptionNotFoundError,
  TenantAlreadySubscribedError,
  InvalidSubscriptionTransitionError,
  InvalidPaymentError,
  InvalidPlatformUserError,
  PlatformUserEmailTakenError,
  PlatformUserNotFoundError,
  TenantStatusCode,
  tenantDbFileRefusalOf,
  type Tenant,
  type Plan,
  type Payment,
  type PlatformUser,
  type CardCheckout,
  CardCheckoutUnavailableError,
  isReservedTenantCode,
  RESERVED_TENANT_CODE_MESSAGE,
  AuditSeverityCode,
} from "@mezan/domain";
import {
  createTenantRequestSchema,
  provisionRetryRequestSchema,
  assignOwnerRequestSchema,
  confirmTenantBooksRequestSchema,
  unbindTenantBooksRequestSchema,
  setBillingAnchorDayRequestSchema,
  startSubscriptionRequestSchema,
  changePlanRequestSchema,
  subscriptionSuspendRequestSchema,
  subscriptionResumeRequestSchema,
  recordPaymentRequestSchema,
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
  type PlatformCardCheckoutsDTO,
} from "@mezan/contracts";
import { requestOrigin } from "@mezan/api";
import { OwnerPinResetOutcome } from "./owner-pin-reset-outcome.js";
import type { PlatformHandle } from "./create-platform.js";
import type { PlatformAuth } from "./platform-auth.js";

export interface PlatformCardCheckoutPort {
  readonly testMode: boolean;
  open(input: { readonly tenantId: string; readonly actorId: string; readonly request: Request }): Promise<CardCheckout>;
  list(tenantId: string): Promise<CardCheckout[]>;
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
  SubscriptionPlanChanged = "SUBSCRIPTION_PLAN_CHANGED",
  SubscriptionResumed = "SUBSCRIPTION_RESUMED",
  SubscriptionStarted = "SUBSCRIPTION_STARTED",
  SubscriptionSuspended = "SUBSCRIPTION_SUSPENDED",
  TenantArchived = "TENANT_ARCHIVED",
  TenantOwnerPinReset = "TENANT_OWNER_PIN_RESET",
  TenantOwnerPinResetRefused = "TENANT_OWNER_PIN_RESET_REFUSED",
  TenantOwnerPinResetRequested = "TENANT_OWNER_PIN_RESET_REQUESTED",
  TenantProvisioned = "TENANT_PROVISIONED",
  TenantProvisionRetried = "TENANT_PROVISION_RETRIED",
  TenantResumed = "TENANT_RESUMED",
  TenantSuspended = "TENANT_SUSPENDED",
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

export interface OwnerPinResetAccount {
  readonly userId: string;
  readonly signInEmail: string;
  readonly adminEmail: string;
}

export interface CreatePlatformRoutesOptions {
  readonly platform: PlatformHandle;
  readonly auth: PlatformAuth;
  readonly now: () => Date;
  readonly provisionTenant: (cmd: CreateTenantRequestDTO & { actorId: string }) => Promise<ProvisionResultDTO>;
  /** Re-runs a failed provisioning (seed, admin, subscription) idempotently for a tenant stuck in `provisioning`. Optional only so a rig that never exercises this route still typechecks without supplying it. */
  readonly provisionRetry?: (input: { tenantId: string; actorId: string } & ProvisionRetryRequestDTO) => Promise<ProvisionResultDTO>;
  readonly resetOwnerPin?: (input: { tenant: Tenant; actorId: string; recordIntent: (account: OwnerPinResetAccount) => Promise<void> }) => Promise<OwnerPinResetResultDTO>;
  readonly releaseTenant?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly ownerCandidates?: (tenant: Tenant) => Promise<OwnerCandidateDTO[]>;
  readonly assignOwner?: (input: { tenant: Tenant; userId: string; actorId: string }) => Promise<Tenant>;
  readonly confirmPendingOwner?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly declinePendingOwner?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly resendPendingOwner?: (input: { tenant: Tenant; actorId: string }) => Promise<Tenant>;
  readonly tenantBooks?: PlatformTenantBooksPort;
  readonly handOverMailConfigured?: boolean;
  // CONTRACT: must not throw; it runs in front of a read.
  readonly reconcileOwner?: (tenant: Tenant) => Promise<void>;
  // CONTRACT: only tenants whose backend is already open. The list must not open every tenant's database to draw itself.
  readonly reconcileOpenOwners?: () => Promise<void>;
  readonly invalidateEntitlements: (code: string) => void;
  readonly idOf?: () => string;
  readonly onAuditError?: (err: unknown) => void;
  /** Absent when card checkout is not configured on this deployment; the routes then answer 503. */
  readonly cardCheckout?: PlatformCardCheckoutPort;
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
    checkoutUrl: c.status === "pending" ? c.checkoutUrl : null, providerRef: c.providerRef, paymentId: c.paymentId,
    failureReason: c.failureReason, requestedBy: c.requestedBy, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
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

function domainErrorResponse(c: Context, err: unknown): Response {
  if (err instanceof PlatformAuditUnavailableError) {
    console.error(err.cause);
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 503);
  }
  const dbFileRefusal = tenantDbFileRefusalOf(err) ?? tenantDbFileRefusalOf(err instanceof Error ? err.cause : undefined);
  if (dbFileRefusal) {
    console.error(err);
    if (dbFileRefusal.retryable) c.header("Retry-After", String(DB_FILE_RETRY_AFTER_SECONDS));
    return c.json({ error: dbFileRefusal.error, message: dbFileRefusal.message, messageEn: dbFileRefusal.messageEn }, 503);
  }
  const serverFailure = asServerDomainFailure(err);
  if (serverFailure) {
    return c.json({ error: serverFailure.code, message: serverFailure.message, ...(serverFailure.tenantId ? { tenantId: serverFailure.tenantId } : {}) }, 422);
  }
  if (err instanceof Error && (err as { code?: unknown }).code === SERVER_OWNER_RETRY_CODE) {
    console.error(err);
    c.header("Retry-After", String(OWNER_RETRY_AFTER_SECONDS));
    return c.json({ error: SERVER_OWNER_RETRY_CODE, message: err.message }, 503);
  }
  if (err instanceof Error && SERVER_OWNER_CONFLICT_CODES.has(String((err as { code?: unknown }).code))) {
    const messageEn = (err as { messageEn?: unknown }).messageEn;
    return c.json({ error: (err as unknown as { code: string }).code, message: err.message, ...(typeof messageEn === "string" ? { messageEn } : {}) }, 409);
  }
  if (err instanceof Error && (err as { code?: unknown }).code === "PAYMENT_PROVIDER_ERROR") {
    console.error(err);
    return c.json({ error: "PAYMENT_PROVIDER_ERROR", message: "تعذّر الاتصال بمزوّد الدفع، حاول مرة أخرى", messageEn: "The payment provider could not be reached; try again" }, 502);
  }
  if (err instanceof CardCheckoutUnavailableError) {
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
  throw err;
}

export function createPlatformRoutes(options: CreatePlatformRoutesOptions): Hono {
  const { platform, auth, now, provisionTenant, provisionRetry, resetOwnerPin, releaseTenant, ownerCandidates, assignOwner, confirmPendingOwner, declinePendingOwner, resendPendingOwner, tenantBooks, reconcileOwner, reconcileOpenOwners, invalidateEntitlements, idOf = randomUUID } = options;
  const onAuditError = options.onAuditError ?? ((err: unknown) => console.error(err));
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

  async function audit(
    c: Context,
    action: string,
    entityId: string | null,
    details: Record<string, unknown>,
    severity: AuditSeverity = AuditSeverityCode.Info,
    actorId?: string,
  ) {
    const platformUser = c.get("platformUser");
    await recordSecurityEvent(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId,
      action,
      actor: actorId ?? platformUser?.id ?? "unknown",
      severity,
      timestamp: nowIso(),
      details: { ...details, origin: requestOrigin(c) ?? "host" },
    }).catch(onAuditError);
  }

  async function auditOrRefuse(c: Context, action: string, entityId: string, details: Record<string, unknown>, severity: AuditSeverity) {
    await recordSecurityEvent(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId,
      action,
      actor: c.get("platformUser")?.id ?? "unknown",
      severity,
      timestamp: nowIso(),
      details: { ...details, origin: requestOrigin(c) ?? "host" },
    }).catch((cause: unknown) => {
      throw new PlatformAuditUnavailableError(cause);
    });
  }

  const requireAny = auth.requirePlatform();
  const requireOwner = auth.requirePlatform("owner");

  const app = new Hono();
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
      const result = await provisionTenant({ ...parsed.data, actorId: platformUser.id });
      invalidateEntitlements(result.tenant.code);
      await audit(c, "TENANT_PROVISIONED", result.tenant.id, { code: result.tenant.code });
      return c.json(result, 201);
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
      const result = await provisionRetry({ tenantId: tenant.id, actorId: c.get("platformUser")!.id, ...parsed.data });
      invalidateEntitlements(result.tenant.code);
      await audit(c, "TENANT_PROVISION_RETRIED", result.tenant.id, { code: result.tenant.code });
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

  const ownerPinResetRefused = (c: Context, tenantId: string | null, reason: string, actorId?: string, outcome?: OwnerPinResetOutcome) =>
    audit(c, PlatformAuditAction.TenantOwnerPinResetRefused, tenantId, { reason, ...(outcome ? { outcome } : {}) }, AuditSeverityCode.Critical, actorId);

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
        await auditOrRefuse(c, PlatformAuditAction.TenantOwnerPinResetRequested, tenant.id, { code: tenant.code, ...account }, AuditSeverityCode.Critical);
        intent.account = account;
      };
      const result = await resetOwnerPin({ tenant, actorId: platformUser.id, recordIntent });
      const account = intent.account ?? { signInEmail: result.signInEmail, adminEmail: result.adminEmail };
      // SECURITY: the PIN has moved by now and this answer is the only place it
      // is shown. An outcome row that cannot be written is logged, never turned
      // into a refusal: the intent row written before the PIN moved stands.
      await audit(c, PlatformAuditAction.TenantOwnerPinReset, tenant.id, { code: tenant.code, ...account, outcome: OwnerPinResetOutcome.Reset }, AuditSeverityCode.Critical).catch(
        (err: unknown) => console.error(`[platform] the owner PIN of tenant "${tenant.id}" was reset, and its outcome row could not be written`, err),
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

  app.post("/tenants/:id/suspend", requireOwner, async (c) => {
    try {
      const tenant = await suspendTenant({ id: c.req.param("id"), now: nowIso() }, platform.stores.tenants);
      invalidateEntitlements(tenant.code);
      await audit(c, "TENANT_SUSPENDED", tenant.id, {});
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/resume", requireOwner, async (c) => {
    try {
      const tenant = await resumeTenant({ id: c.req.param("id"), now: nowIso() }, platform.stores.tenants);
      invalidateEntitlements(tenant.code);
      await audit(c, "TENANT_RESUMED", tenant.id, {});
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/archive", requireOwner, async (c) => {
    try {
      const tenant = await archiveTenant({ id: c.req.param("id"), now: nowIso() }, platform.stores.tenants);
      invalidateEntitlements(tenant.code);
      await audit(c, "TENANT_ARCHIVED", tenant.id, {});
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
      await startSubscription(
        { id: idOf(), tenantId: tenant.id, ...parsed.data, now: nowIso() },
        platform.stores.subscriptions,
        platform.stores.plans,
      );
      invalidateEntitlements(tenant.code);
      await audit(c, "SUBSCRIPTION_STARTED", tenant.id, { planId: parsed.data.planId });
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
      const subscription = await requireLiveSubscription(tenant);
      await changePlan({ id: subscription.id, planId: parsed.data.planId, now: nowIso() }, platform.stores.subscriptions, platform.stores.plans);
      invalidateEntitlements(tenant.code);
      await audit(c, "SUBSCRIPTION_PLAN_CHANGED", tenant.id, { planId: parsed.data.planId });
      return c.json(await summaryOf(tenant));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/subscription/cancel", requireOwner, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      const subscription = await requireLiveSubscription(tenant);
      await cancelSubscription({ id: subscription.id, now: nowIso() }, platform.stores.subscriptions);
      invalidateEntitlements(tenant.code);
      await audit(c, "SUBSCRIPTION_CANCELLED", tenant.id, {});
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
      await setBillingAnchorDay({ id: subscription.id, day: parsed.data.day, now: nowIso() }, platform.stores.subscriptions);
      await audit(
        c,
        PlatformAuditAction.SubscriptionAnchorDaySet,
        tenant.id,
        { before: billingAnchorDayOf(subscription), after: parsed.data.day, neededReview: subscription.billingAnchorNeedsReview === true },
        AuditSeverityCode.Warning,
      );
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
      const subscription = await requireLiveSubscription(tenant);
      await suspendSubscription({ id: subscription.id, now: nowIso() }, platform.stores.subscriptions);
      invalidateEntitlements(tenant.code);
      await audit(c, "SUBSCRIPTION_SUSPENDED", tenant.id, { reason: parsed.data.reason });
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
      const subscription = await requireLiveSubscription(tenant);
      await resumeSubscription({ id: subscription.id, now: nowIso() }, platform.stores.subscriptions);
      invalidateEntitlements(tenant.code);
      await audit(c, "SUBSCRIPTION_RESUMED", tenant.id, { reason: parsed.data.reason });
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
        },
        platform.stores.payments,
        platform.stores.subscriptions,
      );
      invalidateEntitlements(tenant.code);
      await audit(c, "PAYMENT_RECORDED", tenant.id, { paymentId: result.payment.id, amount: parsed.data.amount });
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
      await audit(c, "CARD_CHECKOUT_REQUESTED", tenant.id, { checkoutId: checkout.id, amount: checkout.amount.toString() });
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

  app.get("/plans", requireAny, async (c) => {
    const plans = await platform.stores.plans.list();
    return c.json(plans.map(serializePlan));
  });

  app.post("/plans", requireOwner, async (c) => {
    const parsed = planCreateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const plan = await createPlan(
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
      await invalidateTenantsOnPlan(plan.id);
      await audit(c, "PLAN_CREATED", plan.id, { code: plan.code });
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
      const plan = await updatePlan(
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
      await invalidateTenantsOnPlan(plan.id);
      await audit(c, "PLAN_UPDATED", plan.id, { code: plan.code });
      return c.json(serializePlan(plan));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/plans/:id/retire", requireOwner, async (c) => {
    try {
      const plan = await retirePlan({ id: c.req.param("id") }, platform.stores.plans);
      await invalidateTenantsOnPlan(plan.id);
      await audit(c, "PLAN_RETIRED", plan.id, { code: plan.code });
      return c.json(serializePlan(plan));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.get("/users", requireAny, async (c) => {
    const users = await platform.stores.platformUsers.list();
    return c.json(users.map(serializePlatformUser));
  });

  app.post("/users", requireOwner, async (c) => {
    const parsed = createPlatformUserRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const user = await createPlatformUser({ id: idOf(), ...parsed.data, now: nowIso() }, platform.stores.platformUsers, platform.hasher);
      await audit(c, "PLATFORM_USER_CREATED", user.id, { email: user.email, role: user.role });
      return c.json(serializePlatformUser(user), 201);
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/users/:id/deactivate", requireOwner, async (c) => {
    const platformUser = c.get("platformUser")!;
    try {
      const user = await deactivatePlatformUser({ id: c.req.param("id"), actorId: platformUser.id }, platform.stores.platformUsers);
      await audit(c, "PLATFORM_USER_DEACTIVATED", user.id, {});
      return c.json(serializePlatformUser(user));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  return app;
}
