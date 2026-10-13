import { randomUUID } from "node:crypto";
import {
  applyRenewal,
  cardCheckoutAmount,
  recordSecurityEvent,
  CardCheckoutUnavailableError,
  InvalidSubscriptionError,
  InvalidSubscriptionTransitionError,
  PlanNotFoundError,
  SubscriptionNotFoundError,
  TenantNotFoundError,
  TenantStatusCode,
  type CardCheckout,
  type Payment,
  type PaymentProvider,
  type Subscription,
  type Tenant,
} from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";

export interface OpenCardCheckoutInput {
  readonly tenantId: string;
  readonly requestedBy: string;
  readonly returnUrl: (checkoutId: string) => string;
  readonly notificationUrl: string;
}

export type WebhookResult =
  | { readonly status: "rejected" }
  | { readonly status: "retry" }
  | { readonly status: "ok"; readonly detail: string; readonly checkoutId?: string };

export interface CardCheckoutService {
  readonly provider: PaymentProvider;
  open(input: OpenCardCheckoutInput): Promise<CardCheckout>;
  handleWebhook(rawBody: string, signature: string): Promise<WebhookResult>;
  listByTenant(tenantId: string): Promise<CardCheckout[]>;
  find(id: string): Promise<CardCheckout | null>;
}

export interface CardCheckoutServiceOptions {
  readonly platform: PlatformHandle;
  readonly provider: PaymentProvider;
  readonly now: () => Date;
  readonly invalidateEntitlements: (tenantCode: string) => void;
  readonly idOf?: () => string;
  readonly log?: (message: string, err?: unknown) => void;
}

const RENEWAL_REFUSALS = [InvalidSubscriptionTransitionError, InvalidSubscriptionError, SubscriptionNotFoundError, CardCheckoutUnavailableError];

export function createCardCheckoutService(options: CardCheckoutServiceOptions): CardCheckoutService {
  const { platform, provider, now } = options;
  const idOf = options.idOf ?? randomUUID;
  const log = options.log ?? ((message: string, err?: unknown) => console.error(`[billing] ${message}`, err ?? ""));
  const checkouts = platform.stores.cardCheckouts;
  const nowIso = () => now().toISOString();

  async function audit(action: string, entityId: string | null, details: Record<string, unknown>, severity: "INFO" | "WARNING" = "INFO") {
    await recordSecurityEvent(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId,
      action,
      actor: provider.id,
      severity,
      timestamp: nowIso(),
      details,
    }).catch((err) => log("audit write failed", err));
  }

  async function requireTenant(id: string): Promise<Tenant> {
    const tenant = await platform.stores.tenants.findById(id);
    if (!tenant) throw new TenantNotFoundError(id);
    return tenant;
  }

  async function open(input: OpenCardCheckoutInput): Promise<CardCheckout> {
    const tenant = await requireTenant(input.tenantId);
    if (tenant.status !== TenantStatusCode.Active && tenant.status !== TenantStatusCode.Suspended) {
      throw new CardCheckoutUnavailableError([`حالة المنشأة "${tenant.status}" لا تسمح بالدفع`], [`tenant status "${tenant.status}" cannot pay`]);
    }
    const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
    if (!subscription) throw new SubscriptionNotFoundError(tenant.id);
    const plan = await platform.stores.plans.findById(subscription.planId);
    if (!plan) throw new PlanNotFoundError(subscription.planId);
    const amount = cardCheckoutAmount(plan, subscription);

    const stamp = nowIso();
    const pending: CardCheckout = {
      id: idOf(),
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      provider: provider.id,
      amount,
      currency: "EGP",
      status: "pending",
      providerOrderRef: null,
      checkoutUrl: null,
      providerRef: null,
      paymentId: null,
      failureReason: null,
      requestedBy: input.requestedBy,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await checkouts.insert(pending);

    const cycle = subscription.billingCycle === "yearly" ? "سنوي" : "شهري";
    try {
      const session = await provider.createCheckout({
        checkoutId: pending.id,
        tenantId: tenant.id,
        subscriptionId: subscription.id,
        amount,
        description: `Mezan ${plan.nameEn} (${subscription.billingCycle}) — ${tenant.code} — اشتراك ${plan.nameAr} ${cycle}`,
        customer: { email: tenant.ownerEmail, name: tenant.nameEn ?? tenant.nameAr },
        returnUrl: input.returnUrl(pending.id),
        notificationUrl: input.notificationUrl,
      });
      await checkouts.attachSession(pending.id, session.providerOrderRef, session.url, nowIso());
    } catch (err) {
      await checkouts.abandon(pending.id, "PROVIDER_ERROR", nowIso());
      throw err;
    }
    await audit("CARD_CHECKOUT_OPENED", tenant.id, { checkoutId: pending.id, amount: amount.toString(), requestedBy: input.requestedBy });
    return (await checkouts.findById(pending.id))!;
  }

  async function handleWebhook(rawBody: string, signature: string): Promise<WebhookResult> {
    const txn = await provider.verifyWebhook(rawBody, signature);
    if (!txn) {
      await audit("CARD_WEBHOOK_REJECTED", null, { reason: "HMAC_OR_SHAPE" }, "WARNING");
      return { status: "rejected" };
    }

    if (txn.outcome === "pending") return { status: "ok", detail: "pending" };

    const checkout = await checkouts.findByProviderOrder(provider.id, txn.providerOrderRef);

    if (txn.outcome === "not_a_payment") {
      await audit("CARD_WEBHOOK_NON_PAYMENT", checkout?.tenantId ?? null, {
        checkoutId: checkout?.id ?? null, providerRef: txn.providerRef, providerOrderRef: txn.providerOrderRef,
      }, "WARNING");
      return { status: "ok", detail: "not-a-payment" };
    }

    const claimOnly = async (action: string, details: Record<string, unknown>, tenantId: string | null) => {
      const outcome = await checkouts.recordOutcome({ provider: provider.id, providerRef: txn.providerRef, now: nowIso() });
      if (outcome !== "duplicate") await audit(action, tenantId, { providerRef: txn.providerRef, ...details }, "WARNING");
      return outcome;
    };

    if (!checkout) {
      await claimOnly("CARD_WEBHOOK_UNMATCHED", { providerOrderRef: txn.providerOrderRef }, null);
      return { status: "ok", detail: "unmatched" };
    }
    if (txn.merchantRef !== null && txn.merchantRef !== checkout.id) {
      await claimOnly("CARD_WEBHOOK_REFERENCE_MISMATCH", { checkoutId: checkout.id, merchantRef: txn.merchantRef }, checkout.tenantId);
      return { status: "ok", detail: "reference-mismatch", checkoutId: checkout.id };
    }

    const settleAs = async (
      status: "failed" | "unapplied",
      from: readonly CardCheckout["status"][],
      failureReason: string,
      action: string,
      details: Record<string, unknown> = {},
    ): Promise<WebhookResult> => {
      const outcome = await checkouts.recordOutcome({
        provider: provider.id,
        providerRef: txn.providerRef,
        now: nowIso(),
        settle: { checkoutId: checkout.id, from, to: { status, providerRef: txn.providerRef, paymentId: null, failureReason, now: nowIso() } },
      });
      if (outcome === "duplicate") return { status: "ok", detail: "duplicate", checkoutId: checkout.id };
      await audit(action, checkout.tenantId, {
        checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), moved: outcome === "settled", ...details,
      }, status === "failed" ? "INFO" : "WARNING");
      return { status: "ok", detail: failureReason, checkoutId: checkout.id };
    };

    if (txn.outcome === "failed") return settleAs("failed", ["pending"], "DECLINED", "CARD_PAYMENT_DECLINED");

    if (txn.currency !== checkout.currency || !txn.amount.equals(checkout.amount)) {
      return settleAs("unapplied", ["pending", "failed"], "AMOUNT_MISMATCH", "CARD_PAYMENT_UNAPPLIED", {
        expected: checkout.amount.toString(), currency: txn.currency,
      });
    }

    const subscription = await platform.stores.subscriptions.findById(checkout.subscriptionId);
    const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
    let renewed: Subscription;
    try {
      if (!subscription || !plan) throw new SubscriptionNotFoundError(checkout.subscriptionId);
      if (!cardCheckoutAmount(plan, subscription).equals(checkout.amount)) {
        return settleAs("unapplied", ["pending", "failed"], "PRICE_CHANGED", "CARD_PAYMENT_UNAPPLIED", {
          expected: cardCheckoutAmount(plan, subscription).toString(),
        });
      }
      renewed = applyRenewal(subscription, nowIso());
    } catch (err) {
      if (RENEWAL_REFUSALS.some((cls) => err instanceof cls)) {
        return settleAs("unapplied", ["pending", "failed"], "SUBSCRIPTION_NOT_RENEWABLE", "CARD_PAYMENT_UNAPPLIED", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }

    const stamp = nowIso();
    const payment: Payment = {
      id: idOf(),
      tenantId: checkout.tenantId,
      subscriptionId: checkout.subscriptionId,
      amount: txn.amount,
      currency: "EGP",
      reference: `PAYMOB-${txn.providerRef}`,
      paidAt: stamp,
      recordedBy: provider.id,
      note: `بطاقة — طلب ${txn.providerOrderRef}، عملية الدفع ${checkout.id}${provider.testMode ? " (وضع الاختبار)" : ""}`,
      createdAt: stamp,
    };
    const outcome = await checkouts.settlePaid({
      provider: provider.id,
      providerRef: txn.providerRef,
      now: stamp,
      checkoutId: checkout.id,
      from: ["pending", "failed"],
      subscriptionBefore: subscription,
      subscriptionAfter: renewed,
      payment,
    });
    if (outcome === "duplicate") return { status: "ok", detail: "duplicate", checkoutId: checkout.id };
    if (outcome === "subscription-changed") {
      log(`subscription ${checkout.subscriptionId} changed while settling checkout ${checkout.id}; asking the provider to retry`);
      return { status: "retry" };
    }
    if (outcome === "already-settled") {
      await audit("CARD_PAYMENT_DUPLICATE_CHARGE", checkout.tenantId, {
        checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(),
      }, "WARNING");
      return { status: "ok", detail: "already-settled", checkoutId: checkout.id };
    }

    const tenant = await platform.stores.tenants.findById(checkout.tenantId);
    if (tenant) options.invalidateEntitlements(tenant.code);
    await audit("PAYMENT_RECORDED", checkout.tenantId, {
      paymentId: payment.id, checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), channel: provider.id,
    });
    return { status: "ok", detail: "paid", checkoutId: checkout.id };
  }

  return {
    provider,
    open,
    handleWebhook,
    listByTenant: (tenantId) => checkouts.listByTenant(tenantId),
    find: (id) => checkouts.findById(id),
  };
}
