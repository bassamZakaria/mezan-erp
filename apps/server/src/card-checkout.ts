import { randomUUID } from "node:crypto";
import {
  applyRenewal,
  cardCheckoutAmount,
  recordSecurityEvent,
  CardCheckoutUnavailableError,
  CardPaymentNotApplicableError,
  ProviderInquiryStatus,
  InvalidSubscriptionError,
  InvalidSubscriptionTransitionError,
  PlanNotFoundError,
  SubscriptionNotFoundError,
  TenantNotFoundError,
  type CardCheckout,
  type Money,
  type Payment,
  type PaymentProvider,
  type Subscription,
  type Tenant,
  type VerifiedProviderTransaction,
} from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";

export interface OpenCardCheckoutInput {
  readonly tenantId: string;
  readonly requestedBy: string;
  readonly returnUrl: (checkoutId: string) => string;
  readonly notificationUrl: string;
}

export enum SettlementDetail {
  Pending = "pending",
  NotAPayment = "not-a-payment",
  Unmatched = "unmatched",
  ReferenceMismatch = "reference-mismatch",
  Duplicate = "duplicate",
  AlreadySettled = "already-settled",
  Paid = "paid",
  Declined = "DECLINED",
  AmountMismatch = "AMOUNT_MISMATCH",
  PriceChanged = "PRICE_CHANGED",
  SubscriptionNotRenewable = "SUBSCRIPTION_NOT_RENEWABLE",
}

export type SettlementResult =
  | { readonly status: "retry" }
  | { readonly status: "ok"; readonly detail: SettlementDetail; readonly checkoutId?: string };

export type WebhookResult = { readonly status: "rejected" } | SettlementResult;

/** How a provider transaction reached the settlement: pushed by the provider, or fetched by the sweep. */
export enum SettlementSource {
  Webhook = "webhook",
  Sweep = "sweep",
}

export enum CheckoutFailureReason {
  ProviderError = "PROVIDER_ERROR",
  Expired = "EXPIRED",
}

export const SWEEP_PENDING_AFTER_MS = 15 * 60_000;
export const SWEEP_EXPIRE_AFTER_MS = 24 * 60 * 60_000;
const SWEEP_BATCH = 200;
const SWEEP_GIVE_UP_AFTER_UNAVAILABLE = 3;

export interface CardCheckoutSweepOptions {
  /** A checkout pending for less than this is still inside the window a callback normally arrives in. */
  readonly pendingAfterMs?: number;
  /** A checkout the provider knows nothing about is given up on after this long. */
  readonly expireAfterMs?: number;
}

export interface CardCheckoutSweepResult {
  readonly examined: number;
  readonly paid: number;
  readonly declined: number;
  readonly unapplied: number;
  readonly expired: number;
  readonly stillPending: number;
  readonly alreadySettled: number;
  /** The provider could not be asked; these checkouts were left exactly as they were. */
  readonly unavailable: number;
  readonly failed: number;
}

export interface ApplyUnappliedInput {
  readonly tenantId: string;
  readonly checkoutId: string;
  /** What the operator confirmed the provider actually collected; it becomes the payment's amount. */
  readonly amount: Money;
  readonly reason: string;
  readonly actorId: string;
}

export interface ApplyUnappliedResult {
  readonly checkout: CardCheckout;
  readonly payment: Payment;
}

export interface CardCheckoutService {
  readonly provider: PaymentProvider;
  open(input: OpenCardCheckoutInput): Promise<CardCheckout>;
  handleWebhook(rawBody: string, signature: string): Promise<WebhookResult>;
  /** Asks the provider about every checkout a callback should have settled by now, and settles each through the webhook's own path. */
  sweepPending(options?: CardCheckoutSweepOptions): Promise<CardCheckoutSweepResult>;
  applyUnapplied(input: ApplyUnappliedInput): Promise<ApplyUnappliedResult>;
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

  function auditEvent(action: string, entityId: string | null, details: Record<string, unknown>, severity: "INFO" | "WARNING", actor: string) {
    return recordSecurityEvent(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId,
      action,
      actor,
      severity,
      timestamp: nowIso(),
      details,
    });
  }

  async function audit(action: string, entityId: string | null, details: Record<string, unknown>, severity: "INFO" | "WARNING" = "INFO") {
    await auditEvent(action, entityId, details, severity, provider.id).catch((err) => log("audit write failed", err));
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
      await checkouts.abandon(pending.id, CheckoutFailureReason.ProviderError, nowIso());
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
    return settle(txn, SettlementSource.Webhook);
  }

  // THE ONE SETTLEMENT PATH. The webhook and the sweep both end here, and the
  // provider's transaction id is claimed inside the same transaction that moves
  // the money, so a callback delivered twice, a callback racing the sweep, and
  // the sweep running twice all renew exactly once.
  async function settle(txn: VerifiedProviderTransaction, source: SettlementSource): Promise<SettlementResult> {
    if (txn.outcome === "pending") return { status: "ok", detail: SettlementDetail.Pending };

    const checkout = await checkouts.findByProviderOrder(provider.id, txn.providerOrderRef);

    if (txn.outcome === "not_a_payment") {
      if (source === SettlementSource.Webhook) {
        await audit("CARD_WEBHOOK_NON_PAYMENT", checkout?.tenantId ?? null, {
          checkoutId: checkout?.id ?? null, providerRef: txn.providerRef, providerOrderRef: txn.providerOrderRef,
        }, "WARNING");
      }
      return { status: "ok", detail: SettlementDetail.NotAPayment, ...(checkout ? { checkoutId: checkout.id } : {}) };
    }

    const claimOnly = async (action: string, details: Record<string, unknown>, tenantId: string | null) => {
      const outcome = await checkouts.recordOutcome({ provider: provider.id, providerRef: txn.providerRef, now: nowIso() });
      if (outcome !== "duplicate") await audit(action, tenantId, { providerRef: txn.providerRef, ...details }, "WARNING");
      return outcome;
    };

    if (!checkout) {
      await claimOnly("CARD_WEBHOOK_UNMATCHED", { providerOrderRef: txn.providerOrderRef }, null);
      return { status: "ok", detail: SettlementDetail.Unmatched };
    }
    if (txn.merchantRef !== null && txn.merchantRef !== checkout.id) {
      await claimOnly("CARD_WEBHOOK_REFERENCE_MISMATCH", { checkoutId: checkout.id, merchantRef: txn.merchantRef }, checkout.tenantId);
      return { status: "ok", detail: SettlementDetail.ReferenceMismatch, checkoutId: checkout.id };
    }

    const settleAs = async (
      status: "failed" | "unapplied",
      from: readonly CardCheckout["status"][],
      failureReason: SettlementDetail,
      action: string,
      details: Record<string, unknown> = {},
    ): Promise<SettlementResult> => {
      const outcome = await checkouts.recordOutcome({
        provider: provider.id,
        providerRef: txn.providerRef,
        now: nowIso(),
        settle: { checkoutId: checkout.id, from, to: { status, providerRef: txn.providerRef, paymentId: null, failureReason, now: nowIso() } },
      });
      if (outcome === "duplicate") return { status: "ok", detail: SettlementDetail.Duplicate, checkoutId: checkout.id };
      await audit(action, checkout.tenantId, {
        checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), moved: outcome === "settled", via: source, ...details,
      }, status === "failed" ? "INFO" : "WARNING");
      return { status: "ok", detail: failureReason, checkoutId: checkout.id };
    };

    if (txn.outcome === "failed") return settleAs("failed", ["pending"], SettlementDetail.Declined, "CARD_PAYMENT_DECLINED");

    if (txn.currency !== checkout.currency || !txn.amount.equals(checkout.amount)) {
      return settleAs("unapplied", ["pending", "failed"], SettlementDetail.AmountMismatch, "CARD_PAYMENT_UNAPPLIED", {
        expected: checkout.amount.toString(), currency: txn.currency,
      });
    }

    const subscription = await platform.stores.subscriptions.findById(checkout.subscriptionId);
    const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
    let renewed: Subscription;
    try {
      if (!subscription || !plan) throw new SubscriptionNotFoundError(checkout.subscriptionId);
      if (!cardCheckoutAmount(plan, subscription).equals(checkout.amount)) {
        return settleAs("unapplied", ["pending", "failed"], SettlementDetail.PriceChanged, "CARD_PAYMENT_UNAPPLIED", {
          expected: cardCheckoutAmount(plan, subscription).toString(),
        });
      }
      renewed = applyRenewal(subscription, nowIso());
    } catch (err) {
      if (RENEWAL_REFUSALS.some((cls) => err instanceof cls)) {
        return settleAs("unapplied", ["pending", "failed"], SettlementDetail.SubscriptionNotRenewable, "CARD_PAYMENT_UNAPPLIED", {
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
    if (outcome === "duplicate") return { status: "ok", detail: SettlementDetail.Duplicate, checkoutId: checkout.id };
    if (outcome === "subscription-changed") {
      log(`subscription ${checkout.subscriptionId} changed while settling checkout ${checkout.id}; asking the provider to retry`);
      return { status: "retry" };
    }
    if (outcome === "already-settled") {
      await audit("CARD_PAYMENT_DUPLICATE_CHARGE", checkout.tenantId, {
        checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), via: source,
      }, "WARNING");
      return { status: "ok", detail: SettlementDetail.AlreadySettled, checkoutId: checkout.id };
    }

    const tenant = await platform.stores.tenants.findById(checkout.tenantId);
    if (tenant) options.invalidateEntitlements(tenant.code);
    await audit("PAYMENT_RECORDED", checkout.tenantId, {
      paymentId: payment.id, checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), channel: provider.id, via: source,
    });
    return { status: "ok", detail: SettlementDetail.Paid, checkoutId: checkout.id };
  }

  type SweepTally = { -readonly [K in keyof CardCheckoutSweepResult]: number };

  async function expire(checkout: CardCheckout, why: string, tally: SweepTally): Promise<void> {
    await checkouts.abandon(checkout.id, CheckoutFailureReason.Expired, nowIso());
    const after = await checkouts.findById(checkout.id);
    if (after?.status !== "failed" || after.failureReason !== CheckoutFailureReason.Expired) {
      tally.alreadySettled += 1;
      return;
    }
    tally.expired += 1;
    await audit("CARD_CHECKOUT_EXPIRED", checkout.tenantId, {
      checkoutId: checkout.id, providerOrderRef: checkout.providerOrderRef, openedAt: checkout.createdAt, why,
    }, "WARNING");
  }

  async function sweepOne(checkout: CardCheckout, expireBefore: string, tally: SweepTally): Promise<void> {
    const overdue = checkout.createdAt <= expireBefore;
    if (!checkout.providerOrderRef) {
      if (!overdue) {
        tally.stillPending += 1;
        return;
      }
      await expire(checkout, "never reached the provider", tally);
      return;
    }
    const inquiry = await provider.inquireTransaction({ providerOrderRef: checkout.providerOrderRef, merchantRef: checkout.id });
    if (inquiry.status === ProviderInquiryStatus.Unavailable) {
      log(`inquiry unavailable for checkout ${checkout.id}: ${inquiry.reason}`);
      tally.unavailable += 1;
      return;
    }
    if (inquiry.status === ProviderInquiryStatus.None) {
      if (!overdue) {
        tally.stillPending += 1;
        return;
      }
      await expire(checkout, "the provider holds no transaction for the order", tally);
      return;
    }
    const result = await settle(inquiry.transaction, SettlementSource.Sweep);
    if (result.status === "retry") {
      tally.failed += 1;
      return;
    }
    switch (result.detail) {
      case SettlementDetail.Paid:
        tally.paid += 1;
        return;
      case SettlementDetail.Declined:
        tally.declined += 1;
        return;
      case SettlementDetail.AmountMismatch:
      case SettlementDetail.PriceChanged:
      case SettlementDetail.SubscriptionNotRenewable:
        tally.unapplied += 1;
        return;
      case SettlementDetail.Duplicate:
      case SettlementDetail.AlreadySettled:
        tally.alreadySettled += 1;
        return;
      case SettlementDetail.Pending:
        tally.stillPending += 1;
        return;
      case SettlementDetail.NotAPayment:
      case SettlementDetail.Unmatched:
      case SettlementDetail.ReferenceMismatch:
        if (!overdue) {
          tally.stillPending += 1;
          return;
        }
        await expire(checkout, `the provider's latest transaction for the order is ${result.detail}`, tally);
        return;
    }
  }

  let sweeping: Promise<CardCheckoutSweepResult> | null = null;

  async function runSweep(sweepOptions: CardCheckoutSweepOptions): Promise<CardCheckoutSweepResult> {
    const at = now().getTime();
    const pendingBefore = new Date(at - (sweepOptions.pendingAfterMs ?? SWEEP_PENDING_AFTER_MS)).toISOString();
    const expireBefore = new Date(at - (sweepOptions.expireAfterMs ?? SWEEP_EXPIRE_AFTER_MS)).toISOString();
    const due = await checkouts.listPending(pendingBefore, SWEEP_BATCH);
    const tally: SweepTally = {
      examined: due.length, paid: 0, declined: 0, unapplied: 0, expired: 0, stillPending: 0, alreadySettled: 0, unavailable: 0, failed: 0,
    };
    let unavailableInARow = 0;
    for (const checkout of due) {
      // A provider that has just failed several inquiries running is down or
      // refusing our key; asking it about the rest of the batch helps nobody.
      if (unavailableInARow >= SWEEP_GIVE_UP_AFTER_UNAVAILABLE) {
        tally.unavailable += 1;
        continue;
      }
      const unavailableBefore = tally.unavailable;
      try {
        await sweepOne(checkout, expireBefore, tally);
      } catch (err) {
        log(`sweep failed on checkout ${checkout.id}`, err);
        tally.failed += 1;
      }
      unavailableInARow = tally.unavailable > unavailableBefore ? unavailableInARow + 1 : 0;
    }
    return tally;
  }

  // One sweep at a time per process: the timer and an operator pressing the
  // button must not both be asking the provider about the same checkouts.
  function sweepPending(sweepOptions: CardCheckoutSweepOptions = {}): Promise<CardCheckoutSweepResult> {
    if (sweeping) return sweeping;
    sweeping = runSweep(sweepOptions).finally(() => {
      sweeping = null;
    });
    return sweeping;
  }

  async function applyUnapplied(input: ApplyUnappliedInput): Promise<ApplyUnappliedResult> {
    const refuse = (ar: string, en: string) => new CardPaymentNotApplicableError([ar], [en]);
    const reason = input.reason.trim();
    if (reason === "") throw refuse("سبب التطبيق مطلوب", "a reason is required");
    if (input.amount.scaled <= 0n) throw refuse("المبلغ يجب أن يكون أكبر من صفر", "the amount must be greater than zero");

    const checkout = await checkouts.findById(input.checkoutId);
    if (!checkout || checkout.tenantId !== input.tenantId) throw refuse("عملية الدفع غير موجودة لهذه المنشأة", "no such checkout for this tenant");
    if (checkout.status !== "unapplied" || !checkout.providerRef) {
      throw refuse(`حالة عملية الدفع "${checkout.status}" ليست «غير مطبّقة»`, `checkout status "${checkout.status}" is not unapplied`);
    }
    const reference = `PAYMOB-${checkout.providerRef}`;
    if (await platform.stores.payments.findByReference(checkout.tenantId, reference)) {
      throw refuse(`المرجع "${reference}" مسجَّل كدفعة من قبل`, `reference "${reference}" is already recorded as a payment`);
    }
    const subscription = await platform.stores.subscriptions.findById(checkout.subscriptionId);
    if (!subscription) throw new SubscriptionNotFoundError(checkout.subscriptionId);

    const stamp = nowIso();
    const renewed = applyRenewal(subscription, stamp);
    const payment: Payment = {
      id: idOf(),
      tenantId: checkout.tenantId,
      subscriptionId: checkout.subscriptionId,
      amount: input.amount,
      currency: "EGP",
      reference,
      paidAt: stamp,
      recordedBy: input.actorId,
      note: `بطاقة — تطبيق يدوي لعملية الدفع ${checkout.id}: ${reason}`,
      createdAt: stamp,
    };
    const settleAndRecord = async () => {
      const outcome = await checkouts.settlePaid({
        provider: checkout.provider,
        providerRef: checkout.providerRef!,
        claimRef: `manual-apply:${checkout.id}`,
        now: stamp,
        checkoutId: checkout.id,
        from: ["unapplied"],
        subscriptionBefore: subscription,
        subscriptionAfter: renewed,
        payment,
      });
      if (outcome !== "paid") {
        throw refuse("تغيّرت عملية الدفع أو الاشتراك أثناء التطبيق، أعد المحاولة", `the checkout or subscription changed while applying (${outcome}); try again`);
      }
      await auditEvent("CARD_PAYMENT_APPLIED_MANUALLY", checkout.tenantId, {
        checkoutId: checkout.id, paymentId: payment.id, providerRef: checkout.providerRef, amount: input.amount.toString(),
        expected: checkout.amount.toString(), was: checkout.failureReason, reason,
      }, "WARNING", input.actorId);
    };
    // The renewal, the payment and the record of who applied it and why are one
    // transaction: an owner-forced renewal that left no trail must not exist.
    await (platform.audit.atomic ? platform.audit.atomic(settleAndRecord) : settleAndRecord());

    const tenant = await platform.stores.tenants.findById(checkout.tenantId);
    if (tenant) options.invalidateEntitlements(tenant.code);
    return { checkout: (await checkouts.findById(checkout.id))!, payment };
  }

  return {
    provider,
    open,
    handleWebhook,
    sweepPending,
    applyUnapplied,
    listByTenant: (tenantId) => checkouts.listByTenant(tenantId),
    find: (id) => checkouts.findById(id),
  };
}
