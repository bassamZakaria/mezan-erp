import { randomUUID } from "node:crypto";
import {
  cardCheckoutAmount,
  recordPayment,
  recordSecurityEvent,
  CardCheckoutUnavailableError,
  InvalidPaymentError,
  InvalidSubscriptionError,
  InvalidSubscriptionTransitionError,
  PlanNotFoundError,
  SubscriptionNotFoundError,
  TenantNotFoundError,
  type CardCheckout,
  type PaymentProvider,
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

const RENEWAL_REFUSALS = [InvalidSubscriptionTransitionError, InvalidSubscriptionError, InvalidPaymentError, SubscriptionNotFoundError];

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
    if (tenant.status !== "active" && tenant.status !== "suspended") {
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
      await checkouts.settle(pending.id, ["pending"], {
        status: "failed", providerRef: null, paymentId: null, failureReason: "PROVIDER_ERROR", now: nowIso(),
      });
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

    if (!(await checkouts.claimProviderEvent(provider.id, txn.providerRef, nowIso()))) {
      return { status: "ok", detail: "duplicate" };
    }

    const checkout = await checkouts.findByProviderOrder(provider.id, txn.providerOrderRef);
    if (!checkout) {
      await audit("CARD_WEBHOOK_UNMATCHED", null, { providerRef: txn.providerRef, providerOrderRef: txn.providerOrderRef }, "WARNING");
      return { status: "ok", detail: "unmatched" };
    }
    if (txn.merchantRef !== null && txn.merchantRef !== checkout.id) {
      await audit("CARD_WEBHOOK_REFERENCE_MISMATCH", checkout.tenantId, {
        checkoutId: checkout.id, providerRef: txn.providerRef, merchantRef: txn.merchantRef,
      }, "WARNING");
      return { status: "ok", detail: "reference-mismatch", checkoutId: checkout.id };
    }

    if (txn.outcome === "not_a_payment") {
      await audit("CARD_WEBHOOK_NON_PAYMENT", checkout.tenantId, { checkoutId: checkout.id, providerRef: txn.providerRef }, "WARNING");
      return { status: "ok", detail: "not-a-payment", checkoutId: checkout.id };
    }

    if (txn.outcome === "failed") {
      await checkouts.settle(checkout.id, ["pending"], {
        status: "failed", providerRef: txn.providerRef, paymentId: null, failureReason: "DECLINED", now: nowIso(),
      });
      await audit("CARD_PAYMENT_DECLINED", checkout.tenantId, { checkoutId: checkout.id, providerRef: txn.providerRef });
      return { status: "ok", detail: "declined", checkoutId: checkout.id };
    }

    if (txn.currency !== checkout.currency || !txn.amount.equals(checkout.amount)) {
      const moved = await checkouts.settle(checkout.id, ["pending", "failed"], {
        status: "unapplied", providerRef: txn.providerRef, paymentId: null, failureReason: "AMOUNT_MISMATCH", now: nowIso(),
      });
      await audit("CARD_PAYMENT_UNAPPLIED", checkout.tenantId, {
        checkoutId: checkout.id, providerRef: txn.providerRef, expected: checkout.amount.toString(),
        received: txn.amount.toString(), currency: txn.currency, moved,
      }, "WARNING");
      return { status: "ok", detail: "amount-mismatch", checkoutId: checkout.id };
    }

    const paymentId = idOf();
    const won = await checkouts.settle(checkout.id, ["pending", "failed"], {
      status: "paid", providerRef: txn.providerRef, paymentId, failureReason: null, now: nowIso(),
    });
    if (!won) {
      await audit("CARD_PAYMENT_DUPLICATE_CHARGE", checkout.tenantId, {
        checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(),
      }, "WARNING");
      return { status: "ok", detail: "already-settled", checkoutId: checkout.id };
    }

    try {
      await recordPayment(
        {
          id: paymentId,
          tenantId: checkout.tenantId,
          subscriptionId: checkout.subscriptionId,
          amount: txn.amount,
          reference: `PAYMOB-${txn.providerRef}`,
          paidAt: nowIso(),
          recordedBy: provider.id,
          note: `بطاقة — طلب ${txn.providerOrderRef}، عملية الدفع ${checkout.id}${provider.testMode ? " (وضع الاختبار)" : ""}`,
          now: nowIso(),
        },
        platform.stores.payments,
        platform.stores.subscriptions,
      );
    } catch (err) {
      if (RENEWAL_REFUSALS.some((cls) => err instanceof cls)) {
        await checkouts.settle(checkout.id, ["paid"], {
          status: "unapplied", providerRef: txn.providerRef, paymentId: null,
          failureReason: "SUBSCRIPTION_NOT_RENEWABLE", now: nowIso(),
        });
        await audit("CARD_PAYMENT_UNAPPLIED", checkout.tenantId, {
          checkoutId: checkout.id, providerRef: txn.providerRef, reason: err instanceof Error ? err.message : String(err),
        }, "WARNING");
        return { status: "ok", detail: "unapplied", checkoutId: checkout.id };
      }
      await checkouts.reopen(checkout.id, nowIso());
      await checkouts.releaseProviderEvent(provider.id, txn.providerRef);
      log(`settling checkout ${checkout.id} failed; released for retry`, err);
      return { status: "retry" };
    }

    const tenant = await platform.stores.tenants.findById(checkout.tenantId);
    if (tenant) options.invalidateEntitlements(tenant.code);
    await audit("PAYMENT_RECORDED", checkout.tenantId, {
      paymentId, checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), channel: provider.id,
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
