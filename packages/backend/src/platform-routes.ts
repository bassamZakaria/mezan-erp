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
  type Tenant,
  type Plan,
  type Payment,
  type PlatformUser,
  type CardCheckout,
  CardCheckoutUnavailableError,
} from "@mezan/domain";
import {
  createTenantRequestSchema,
  provisionRetryRequestSchema,
  startSubscriptionRequestSchema,
  changePlanRequestSchema,
  subscriptionSuspendRequestSchema,
  subscriptionResumeRequestSchema,
  recordPaymentRequestSchema,
  planCreateRequestSchema,
  subscriptionStatusSchema,
  licenseStateNameSchema,
  planUpdateRequestSchema,
  createPlatformUserRequestSchema,
  type CreateTenantRequestDTO,
  type ProvisionRetryRequestDTO,
  type ProvisionResultDTO,
  type OwnerPinResetResultDTO,
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
import type { PlatformHandle } from "./create-platform.js";
import type { PlatformAuth } from "./platform-auth.js";

export interface PlatformCardCheckoutPort {
  readonly testMode: boolean;
  open(input: { readonly tenantId: string; readonly actorId: string; readonly request: Request }): Promise<CardCheckout>;
  list(tenantId: string): Promise<CardCheckout[]>;
}

export interface CreatePlatformRoutesOptions {
  readonly platform: PlatformHandle;
  readonly auth: PlatformAuth;
  readonly now: () => Date;
  readonly provisionTenant: (cmd: CreateTenantRequestDTO & { actorId: string }) => Promise<ProvisionResultDTO>;
  /** Re-runs a failed provisioning (seed, admin, subscription) idempotently for a tenant stuck in `provisioning`. Optional only so a rig that never exercises this route still typechecks without supplying it. */
  readonly provisionRetry?: (input: { tenantId: string; actorId: string } & ProvisionRetryRequestDTO) => Promise<ProvisionResultDTO>;
  readonly resetOwnerPin?: (input: { tenant: Tenant; actorId: string }) => Promise<OwnerPinResetResultDTO>;
  readonly invalidateEntitlements: (code: string) => void;
  readonly idOf?: () => string;
  readonly onAuditError?: (err: unknown) => void;
  /** Absent when card checkout is not configured on this deployment; the routes then answer 503. */
  readonly cardCheckout?: PlatformCardCheckoutPort;
}

function serializeTenant(t: Tenant): TenantDTO {
  return {
    id: t.id, code: t.code, nameAr: t.nameAr, nameEn: t.nameEn, ownerEmail: t.ownerEmail,
    status: t.status, dbFile: t.dbFile, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

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

async function tenantSummary(platform: PlatformHandle, tenant: Tenant, nowIso: string): Promise<TenantSummaryDTO> {
  const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
  const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
  const licenseState = subscriptionLicenseState(tenant, subscription, nowIso);
  const entitlements = plan && subscription ? deriveEntitlements(plan, subscription) : null;
  const payments = await platform.stores.payments.listByTenant(tenant.id);
  return {
    tenant: serializeTenant(tenant),
    subscription: subscription
      ? {
          id: subscription.id, tenantId: subscription.tenantId, planId: subscription.planId, status: subscriptionStatusSchema.parse(subscription.status),
          billingCycle: subscription.billingCycle, addOnModules: [...subscription.addOnModules],
          extraSeats: subscription.extraSeats, extraBranches: subscription.extraBranches, extraWarehouses: subscription.extraWarehouses,
          currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd,
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
  };
}

/** Codes for the `apps/server`-only error classes (`provision-tenant.ts`'s `TenantProvisioningError` and `PlanRequiredError`) that map to 422 here. `@mezan/backend` cannot import an `apps/*` class, so each is recognised by shape (`.code` plus, for a provisioning failure, the tenant id it left in `provisioning`) instead of `instanceof`. */
const SERVER_DOMAIN_ERROR_CODES = new Set(["TENANT_PROVISIONING_FAILED", "PLAN_REQUIRED"]);

function asServerDomainFailure(err: unknown): { readonly code: string; readonly message: string; readonly tenantId?: string } | null {
  if (!(err instanceof Error)) return null;
  const shape = err as unknown as Record<string, unknown>;
  if (typeof shape.code !== "string" || !SERVER_DOMAIN_ERROR_CODES.has(shape.code)) return null;
  return { code: shape.code, message: err.message, ...(typeof shape.tenantId === "string" ? { tenantId: shape.tenantId } : {}) };
}

export class TenantOwnerAccountNotFoundError extends Error {
  readonly code = "TENANT_OWNER_ACCOUNT_NOT_FOUND";

  constructor() {
    super("لا يوجد في المنشأة حساب مدير نشط ببريد مالكها.");
    this.name = "TenantOwnerAccountNotFoundError";
  }
}

function domainErrorResponse(c: Context, err: unknown): Response {
  const serverFailure = asServerDomainFailure(err);
  if (serverFailure) {
    return c.json({ error: serverFailure.code, message: serverFailure.message, ...(serverFailure.tenantId ? { tenantId: serverFailure.tenantId } : {}) }, 422);
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
  const { platform, auth, now, provisionTenant, provisionRetry, resetOwnerPin, invalidateEntitlements, idOf = randomUUID } = options;
  const onAuditError = options.onAuditError ?? ((err: unknown) => console.error(err));
  const nowIso = () => now().toISOString();

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
    severity: AuditSeverity = "INFO",
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

  const requireAny = auth.requirePlatform();
  const requireOwner = auth.requirePlatform("owner");

  const app = new Hono();
  app.route("/auth", auth.app);

  app.get("/tenants", requireAny, async (c) => {
    const tenants = await platform.stores.tenants.list();
    const summaries = await Promise.all(tenants.map((t) => tenantSummary(platform, t, nowIso())));
    return c.json(summaries);
  });

  app.get("/tenants/:id", requireAny, async (c) => {
    try {
      const tenant = await requireTenant(c.req.param("id"));
      return c.json(await tenantSummary(platform, tenant, nowIso()));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants", requireOwner, async (c) => {
    const parsed = createTenantRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
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

  const ownerPinResetRefused = (c: Context, tenantId: string | null, reason: string, actorId?: string) =>
    audit(c, "TENANT_OWNER_PIN_RESET_REFUSED", tenantId, { reason }, "CRITICAL", actorId);

  const requireOwnerForPinReset = auth.requirePlatform("owner", (c, user) =>
    ownerPinResetRefused(c, c.req.param("id") ?? null, "OWNER_ONLY", user.id),
  );

  app.post("/tenants/:id/owner-pin/reset", requireOwnerForPinReset, async (c) => {
    const platformUser = c.get("platformUser")!;
    const tenantId = c.req.param("id");
    try {
      const tenant = await requireTenant(tenantId);
      if (tenant.status !== TenantStatusCode.Active && tenant.status !== TenantStatusCode.Suspended) {
        await ownerPinResetRefused(c, tenant.id, "TENANT_NOT_LIVE");
        return c.json({ error: "TENANT_NOT_LIVE", message: "لا يُعاد تعيين رمز المالك إلا لمنشأة نشطة أو موقوفة" }, 409);
      }
      if (!resetOwnerPin) throw new Error("resetOwnerPin dependency is not configured");
      const result = await resetOwnerPin({ tenant, actorId: platformUser.id });
      await audit(c, "TENANT_OWNER_PIN_RESET", tenant.id, { code: tenant.code, adminEmail: result.adminEmail }, "CRITICAL");
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof TenantOwnerAccountNotFoundError) {
        await ownerPinResetRefused(c, tenantId, err.code);
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
      return c.json(await tenantSummary(platform, tenant, nowIso()));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/resume", requireOwner, async (c) => {
    try {
      const tenant = await resumeTenant({ id: c.req.param("id"), now: nowIso() }, platform.stores.tenants);
      invalidateEntitlements(tenant.code);
      await audit(c, "TENANT_RESUMED", tenant.id, {});
      return c.json(await tenantSummary(platform, tenant, nowIso()));
    } catch (err) {
      return domainErrorResponse(c, err);
    }
  });

  app.post("/tenants/:id/archive", requireOwner, async (c) => {
    try {
      const tenant = await archiveTenant({ id: c.req.param("id"), now: nowIso() }, platform.stores.tenants);
      invalidateEntitlements(tenant.code);
      await audit(c, "TENANT_ARCHIVED", tenant.id, {});
      return c.json(await tenantSummary(platform, tenant, nowIso()));
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
      return c.json(await tenantSummary(platform, tenant, nowIso()), 201);
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
      return c.json(await tenantSummary(platform, tenant, nowIso()));
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
      return c.json(await tenantSummary(platform, tenant, nowIso()));
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
      return c.json(await tenantSummary(platform, tenant, nowIso()));
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
      return c.json(await tenantSummary(platform, tenant, nowIso()));
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
      return c.json(await tenantSummary(platform, tenant, nowIso()), 201);
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
