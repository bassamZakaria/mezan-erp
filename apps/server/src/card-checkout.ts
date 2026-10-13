import { randomUUID } from "node:crypto";
import {
  applyRenewal,
  cardCheckoutAmount,
  recordSecurityEvent,
  recordSecurityEventOrFallback,
  CardCheckoutAttentionCause,
  CardCheckoutFailureReason,
  CardCheckoutResolution,
  CardCheckoutStatus,
  CardCheckoutUnavailableError,
  CardPaymentNotApplicableError,
  PaidSettlementOutcome,
  ProviderEventOutcome,
  ProviderInquiryStatus,
  ProviderNonPaymentKind,
  ProviderTransactionOutcome,
  TenantStatusCode,
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
  ReferenceAlreadyRecorded = "REFERENCE_ALREADY_RECORDED",
}

export enum SettlementStatus {
  Retry = "retry",
  Ok = "ok",
  Rejected = "rejected",
}

interface SettlementRetry {
  readonly status: SettlementStatus.Retry;
}

export type SettlementResult =
  | SettlementRetry
  | { readonly status: SettlementStatus.Ok; readonly detail: SettlementDetail; readonly checkoutId?: string };

export type WebhookResult = { readonly status: SettlementStatus.Rejected } | SettlementResult;

enum EventSeverity {
  Info = "INFO",
  Warning = "WARNING",
  Critical = "CRITICAL",
}

type UnsettledReason =
  | CardCheckoutFailureReason.Declined
  | CardCheckoutFailureReason.AmountMismatch
  | CardCheckoutFailureReason.PriceChanged
  | CardCheckoutFailureReason.SubscriptionNotRenewable
  | CardCheckoutFailureReason.ReferenceAlreadyRecorded;

const DETAIL_OF: Readonly<Record<UnsettledReason, SettlementDetail>> = {
  [CardCheckoutFailureReason.Declined]: SettlementDetail.Declined,
  [CardCheckoutFailureReason.AmountMismatch]: SettlementDetail.AmountMismatch,
  [CardCheckoutFailureReason.PriceChanged]: SettlementDetail.PriceChanged,
  [CardCheckoutFailureReason.SubscriptionNotRenewable]: SettlementDetail.SubscriptionNotRenewable,
  [CardCheckoutFailureReason.ReferenceAlreadyRecorded]: SettlementDetail.ReferenceAlreadyRecorded,
};

const CAUSE_OF_NON_PAYMENT: Readonly<Record<ProviderNonPaymentKind, CardCheckoutAttentionCause>> = {
  [ProviderNonPaymentKind.Refund]: CardCheckoutAttentionCause.Refund,
  [ProviderNonPaymentKind.Void]: CardCheckoutAttentionCause.Void,
  [ProviderNonPaymentKind.Other]: CardCheckoutAttentionCause.NotACapture,
};

const PROVIDER_TRANSACTION_NUMBER = /^[0-9]{1,20}$/;

const RETRY: SettlementRetry = { status: SettlementStatus.Retry };
const OPEN_TO_A_PAYMENT: readonly CardCheckoutStatus[] = [CardCheckoutStatus.Pending, CardCheckoutStatus.Failed];

class SettlementUnrecorded extends Error {
  constructor(readonly reason: unknown) {
    super("the audit event for a card settlement could not be written");
    this.name = "SettlementUnrecorded";
  }
}

export enum SettlementSource {
  Webhook = "webhook",
  Sweep = "sweep",
}

export enum CardCheckoutAuditAction {
  Opened = "CARD_CHECKOUT_OPENED",
  WebhookRejected = "CARD_WEBHOOK_REJECTED",
  WebhookNonPayment = "CARD_WEBHOOK_NON_PAYMENT",
  WebhookUnmatched = "CARD_WEBHOOK_UNMATCHED",
  WebhookReferenceMismatch = "CARD_WEBHOOK_REFERENCE_MISMATCH",
  PaymentDeclined = "CARD_PAYMENT_DECLINED",
  PaymentUnapplied = "CARD_PAYMENT_UNAPPLIED",
  PaymentDuplicateCharge = "CARD_PAYMENT_DUPLICATE_CHARGE",
  PaymentRecorded = "PAYMENT_RECORDED",
  PaymentAppliedManually = "CARD_PAYMENT_APPLIED_MANUALLY",
  CheckoutExpired = "CARD_CHECKOUT_EXPIRED",
  CheckoutNeedsAttention = "CARD_CHECKOUT_NEEDS_ATTENTION",
  CheckoutResolved = "CARD_CHECKOUT_RESOLVED",
}

export const SWEEP_PENDING_AFTER_MS = 15 * 60_000;
export const SWEEP_EXPIRE_AFTER_MS = 24 * 60 * 60_000;
const SWEEP_BATCH = 200;
const SWEEP_GIVE_UP_AFTER_UNAVAILABLE = 3;

export interface CardCheckoutSweepOptions {
  readonly pendingAfterMs?: number;
  readonly expireAfterMs?: number;
  readonly budgetMs?: number;
  readonly batchSize?: number;
}

export interface CardCheckoutSweepResult {
  readonly examined: number;
  readonly paid: number;
  readonly declined: number;
  readonly unapplied: number;
  readonly expired: number;
  readonly stillPending: number;
  readonly alreadySettled: number;
  readonly needsAttention: number;
  readonly unavailable: number;
  readonly failed: number;
  readonly deferred: number;
}

export interface ApplyUnappliedInput {
  readonly tenantId: string;
  readonly checkoutId: string;
  readonly amount?: Money;
  readonly overrideAmount: boolean;
  readonly reason: string;
  readonly actorId: string;
}

export interface ApplyUnappliedResult {
  readonly checkout: CardCheckout;
  readonly payment: Payment;
}

export interface ResolveFlaggedInput {
  readonly tenantId: string;
  readonly checkoutId: string;
  readonly resolution: CardCheckoutResolution;
  readonly reason: string;
  readonly actorId: string;
  readonly providerRef?: string;
  readonly amount?: Money;
  readonly overrideAmount: boolean;
}

export interface CardCheckoutService {
  readonly provider: PaymentProvider;
  open(input: OpenCardCheckoutInput): Promise<CardCheckout>;
  handleWebhook(rawBody: string, signature: string): Promise<WebhookResult>;
  sweepPending(options?: CardCheckoutSweepOptions): Promise<CardCheckoutSweepResult>;
  sweepRunning(): boolean;
  applyUnapplied(input: ApplyUnappliedInput): Promise<ApplyUnappliedResult>;
  resolveFlagged(input: ResolveFlaggedInput): Promise<CardCheckout>;
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
  const { platform, now } = options;
  const provider: PaymentProvider = {
    ...options.provider,
    createCheckout: (input) => platform.outsideTheTurn(() => options.provider.createCheckout(input)),
    inquireTransaction: (input) => platform.outsideTheTurn(() => options.provider.inquireTransaction(input)),
  };
  const idOf = options.idOf ?? randomUUID;
  const log = options.log ?? ((message: string, err?: unknown) => console.error(`[billing] ${message}`, err ?? ""));
  const checkouts = platform.stores.cardCheckouts;
  const nowIso = () => now().toISOString();

  function auditEvent(action: CardCheckoutAuditAction, entityId: string | null, details: Record<string, unknown>, severity: EventSeverity, actor: string) {
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

  function audit(action: CardCheckoutAuditAction, entityId: string | null, details: Record<string, unknown>, severity: EventSeverity = EventSeverity.Info): Promise<void> {
    return recordSecurityEventOrFallback(platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId,
      action,
      actor: provider.id,
      severity,
      timestamp: nowIso(),
      details,
    });
  }

  function mustRecord(action: CardCheckoutAuditAction, entityId: string | null, details: Record<string, unknown>, severity: EventSeverity): Promise<void> {
    return auditEvent(action, entityId, details, severity, provider.id).catch((reason: unknown) => {
      throw new SettlementUnrecorded(reason);
    });
  }

  // A provider transaction id is claimed in the SAME transaction as the event
  // that says what was done with it. Were the claim to commit alone, every
  // redelivery would be answered "duplicate" and the event could never be
  // written; rolled back together, the provider is asked to deliver again.
  async function settledTogether<T>(work: () => Promise<T>): Promise<T | SettlementRetry> {
    try {
      return await (platform.audit.atomic ? platform.audit.atomic(work) : work());
    } catch (err) {
      if (!(err instanceof SettlementUnrecorded)) throw err;
      log("audit write failed, so nothing was settled; asking the provider to deliver again", err.reason);
      return RETRY;
    }
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
      status: CardCheckoutStatus.Pending,
      providerOrderRef: null,
      checkoutUrl: null,
      providerRef: null,
      paymentId: null,
      failureReason: null,
      capturedAmount: null,
      requestedBy: input.requestedBy,
      attentionCause: null,
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionReason: null,
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
      await checkouts.abandon(pending.id, CardCheckoutFailureReason.ProviderError, nowIso());
      throw err;
    }
    await audit(CardCheckoutAuditAction.Opened, tenant.id, { checkoutId: pending.id, amount: amount.toString(), requestedBy: input.requestedBy });
    return (await checkouts.findById(pending.id))!;
  }

  async function handleWebhook(rawBody: string, signature: string): Promise<WebhookResult> {
    const txn = await provider.verifyWebhook(rawBody, signature);
    if (!txn) {
      await audit(CardCheckoutAuditAction.WebhookRejected, null, { reason: "HMAC_OR_SHAPE" }, EventSeverity.Warning);
      return { status: SettlementStatus.Rejected };
    }
    return settle(txn, SettlementSource.Webhook);
  }

  // THE ONE SETTLEMENT PATH. The webhook and the sweep both end here, and the
  // provider's transaction id is claimed inside the same transaction that moves
  // the money, so a callback delivered twice, a callback racing the sweep, and
  // the sweep running twice all renew exactly once.
  async function settle(txn: VerifiedProviderTransaction, source: SettlementSource): Promise<SettlementResult> {
    const ok = (detail: SettlementDetail, checkoutId?: string): SettlementResult => ({
      status: SettlementStatus.Ok, detail, ...(checkoutId === undefined ? {} : { checkoutId }),
    });
    if (txn.outcome === ProviderTransactionOutcome.Pending) return ok(SettlementDetail.Pending);

    const checkout = await checkouts.findByProviderOrder(provider.id, txn.providerOrderRef);

    if (txn.outcome === ProviderTransactionOutcome.NotAPayment) {
      if (source === SettlementSource.Webhook) {
        await audit(CardCheckoutAuditAction.WebhookNonPayment, checkout?.tenantId ?? null, {
          checkoutId: checkout?.id ?? null, providerRef: txn.providerRef, providerOrderRef: txn.providerOrderRef,
        }, EventSeverity.Warning);
      }
      return ok(SettlementDetail.NotAPayment, checkout?.id);
    }

    const claimOnly = (action: CardCheckoutAuditAction, details: Record<string, unknown>, tenantId: string | null, result: SettlementResult) =>
      settledTogether(async () => {
        const outcome = await checkouts.recordOutcome({ provider: provider.id, providerRef: txn.providerRef, now: nowIso() });
        if (outcome !== ProviderEventOutcome.Duplicate) await mustRecord(action, tenantId, { providerRef: txn.providerRef, ...details }, EventSeverity.Warning);
        return result;
      });

    if (!checkout) {
      return claimOnly(CardCheckoutAuditAction.WebhookUnmatched, { providerOrderRef: txn.providerOrderRef }, null, ok(SettlementDetail.Unmatched));
    }
    if (txn.merchantRef !== null && txn.merchantRef !== checkout.id) {
      return claimOnly(
        CardCheckoutAuditAction.WebhookReferenceMismatch,
        { checkoutId: checkout.id, merchantRef: txn.merchantRef },
        checkout.tenantId,
        ok(SettlementDetail.ReferenceMismatch, checkout.id),
      );
    }

    const settleAs = (
      status: CardCheckoutStatus.Failed | CardCheckoutStatus.Unapplied,
      from: readonly CardCheckoutStatus[],
      failureReason: UnsettledReason,
      action: CardCheckoutAuditAction,
      details: Record<string, unknown> = {},
    ): Promise<SettlementResult> =>
      settledTogether(async () => {
        const outcome = await checkouts.recordOutcome({
          provider: provider.id,
          providerRef: txn.providerRef,
          now: nowIso(),
          settle: {
            checkoutId: checkout.id,
            from,
            to: {
              status, providerRef: txn.providerRef, paymentId: null, failureReason, now: nowIso(),
              capturedAmount: status === CardCheckoutStatus.Unapplied ? txn.amount : null,
            },
          },
        });
        if (outcome === ProviderEventOutcome.Duplicate) return ok(SettlementDetail.Duplicate, checkout.id);
        await mustRecord(action, checkout.tenantId, {
          checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(),
          moved: outcome === ProviderEventOutcome.Settled, via: source, ...details,
        }, status === CardCheckoutStatus.Failed ? EventSeverity.Info : EventSeverity.Warning);
        return ok(DETAIL_OF[failureReason], checkout.id);
      });
    const unapplied = (failureReason: UnsettledReason, details: Record<string, unknown>) =>
      settleAs(CardCheckoutStatus.Unapplied, OPEN_TO_A_PAYMENT, failureReason, CardCheckoutAuditAction.PaymentUnapplied, details);

    if (txn.outcome === ProviderTransactionOutcome.Failed) {
      return settleAs(CardCheckoutStatus.Failed, [CardCheckoutStatus.Pending], CardCheckoutFailureReason.Declined, CardCheckoutAuditAction.PaymentDeclined);
    }

    if (txn.currency !== checkout.currency || !txn.amount.equals(checkout.amount)) {
      return unapplied(CardCheckoutFailureReason.AmountMismatch, { expected: checkout.amount.toString(), currency: txn.currency });
    }

    const subscription = await platform.stores.subscriptions.findById(checkout.subscriptionId);
    const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
    let renewed: Subscription;
    try {
      if (!subscription || !plan) throw new SubscriptionNotFoundError(checkout.subscriptionId);
      if (!cardCheckoutAmount(plan, subscription).equals(checkout.amount)) {
        return unapplied(CardCheckoutFailureReason.PriceChanged, { expected: cardCheckoutAmount(plan, subscription).toString() });
      }
      renewed = applyRenewal(subscription, nowIso());
    } catch (err) {
      if (RENEWAL_REFUSALS.some((cls) => err instanceof cls)) {
        return unapplied(CardCheckoutFailureReason.SubscriptionNotRenewable, { reason: err instanceof Error ? err.message : String(err) });
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
    const settled = await settledTogether(async (): Promise<SettlementResult | PaidSettlementOutcome.ReferenceTaken> => {
      const outcome = await checkouts.settlePaid({
        provider: provider.id,
        providerRef: txn.providerRef,
        now: stamp,
        checkoutId: checkout.id,
        from: OPEN_TO_A_PAYMENT,
        subscriptionBefore: subscription,
        subscriptionAfter: renewed,
        payment,
      });
      switch (outcome) {
        case PaidSettlementOutcome.Duplicate:
          return ok(SettlementDetail.Duplicate, checkout.id);
        case PaidSettlementOutcome.ReferenceTaken:
          return outcome;
        case PaidSettlementOutcome.SubscriptionChanged:
          log(`subscription ${checkout.subscriptionId} changed while settling checkout ${checkout.id}; asking the provider to retry`);
          return RETRY;
        case PaidSettlementOutcome.AlreadySettled:
          await mustRecord(CardCheckoutAuditAction.PaymentDuplicateCharge, checkout.tenantId, {
            checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), via: source,
          }, EventSeverity.Warning);
          return ok(SettlementDetail.AlreadySettled, checkout.id);
        case PaidSettlementOutcome.Paid:
          await mustRecord(CardCheckoutAuditAction.PaymentRecorded, checkout.tenantId, {
            paymentId: payment.id, checkoutId: checkout.id, providerRef: txn.providerRef, amount: txn.amount.toString(), channel: provider.id, via: source,
          }, EventSeverity.Info);
          return ok(SettlementDetail.Paid, checkout.id);
      }
    });

    if (settled === PaidSettlementOutcome.ReferenceTaken) {
      const recorded = await platform.stores.payments.findByReference(checkout.tenantId, payment.reference);
      return unapplied(CardCheckoutFailureReason.ReferenceAlreadyRecorded, { reference: payment.reference, recordedPaymentId: recorded?.id ?? null });
    }
    if (settled.status === SettlementStatus.Ok && settled.detail === SettlementDetail.Paid) {
      const tenant = await platform.stores.tenants.findById(checkout.tenantId);
      if (tenant) options.invalidateEntitlements(tenant.code);
    }
    return settled;
  }

  type SweepTally = { -readonly [K in keyof CardCheckoutSweepResult]: number };

  // An expiry or a flag and the event that says why are ONE transaction: a
  // checkout must not be closed, or marked as needing a person, with no record
  // of it. If the event cannot be written the checkout is left as it was and
  // the next pass tries again.
  const recordedTogether = <T>(work: () => Promise<T>): Promise<T> => (platform.audit.atomic ? platform.audit.atomic(work) : work());

  async function expire(checkout: CardCheckout, why: string, tally: SweepTally): Promise<void> {
    const expired = await recordedTogether(async () => {
      await checkouts.abandon(checkout.id, CardCheckoutFailureReason.Expired, nowIso());
      const after = await checkouts.findById(checkout.id);
      if (after?.status !== CardCheckoutStatus.Failed || after.failureReason !== CardCheckoutFailureReason.Expired) return false;
      await mustRecord(CardCheckoutAuditAction.CheckoutExpired, checkout.tenantId, {
        checkoutId: checkout.id, providerOrderRef: checkout.providerOrderRef, openedAt: checkout.createdAt, why,
      }, EventSeverity.Warning);
      return true;
    });
    if (expired) tally.expired += 1;
    else tally.alreadySettled += 1;
  }

  // A checkout the provider knows about but whose answer we cannot read is
  // never expired on a guess: money may have been taken. Past the threshold it
  // is flagged for a person, once, and stays payable by a late callback.
  async function raise(checkout: CardCheckout, cause: CardCheckoutAttentionCause, why: string, tally: SweepTally): Promise<void> {
    await recordedTogether(async () => {
      if (!(await checkouts.flagNeedsAttention(checkout.id, cause, nowIso()))) return;
      await mustRecord(CardCheckoutAuditAction.CheckoutNeedsAttention, checkout.tenantId, {
        checkoutId: checkout.id, providerOrderRef: checkout.providerOrderRef, openedAt: checkout.createdAt, cause, why,
      }, EventSeverity.Warning);
    });
    tally.needsAttention += 1;
  }

  async function sweepOne(checkout: CardCheckout, expireBefore: string, tally: SweepTally): Promise<void> {
    const stillOpen = checkout.status === CardCheckoutStatus.Pending;
    const overdue = checkout.createdAt <= expireBefore;
    const leaveOr = async (act: () => Promise<void>): Promise<void> => {
      if (stillOpen && overdue) return act();
      tally.stillPending += 1;
    };
    if (!checkout.providerOrderRef) return leaveOr(() => expire(checkout, "never reached the provider", tally));

    const inquiry = await provider.inquireTransaction({ providerOrderRef: checkout.providerOrderRef, merchantRef: checkout.id });
    switch (inquiry.status) {
      case ProviderInquiryStatus.Unavailable:
        log(`inquiry unavailable for checkout ${checkout.id}: ${inquiry.reason}`);
        tally.unavailable += 1;
        return;
      case ProviderInquiryStatus.Unreadable:
        log(`inquiry unreadable for checkout ${checkout.id}: ${inquiry.reason}`);
        return leaveOr(() => raise(checkout, CardCheckoutAttentionCause.Unreadable, inquiry.reason, tally));
      case ProviderInquiryStatus.None:
        return leaveOr(() => expire(checkout, "the provider holds no transaction for the order", tally));
      case ProviderInquiryStatus.Found:
        break;
    }

    const result = await settle(inquiry.transaction, SettlementSource.Sweep);
    if (result.status === SettlementStatus.Retry) {
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
      case SettlementDetail.ReferenceAlreadyRecorded:
        tally.unapplied += 1;
        return;
      case SettlementDetail.Duplicate:
      case SettlementDetail.AlreadySettled:
        tally.alreadySettled += 1;
        return;
      case SettlementDetail.Pending:
        tally.stillPending += 1;
        return;
      // The provider HOLDS a transaction for this order — a refund, a void, one
      // that names another checkout. Money may have moved, so it is put in
      // front of a person; only an order the provider has no transaction for
      // is expired.
      case SettlementDetail.NotAPayment:
        return leaveOr(() => raise(checkout, CAUSE_OF_NON_PAYMENT[inquiry.transaction.nonPayment ?? ProviderNonPaymentKind.Other], `the provider's latest transaction for the order is ${result.detail}`, tally));
      case SettlementDetail.Unmatched:
      case SettlementDetail.ReferenceMismatch:
        return leaveOr(() => raise(checkout, CardCheckoutAttentionCause.OtherCheckout, `the provider's latest transaction for the order is ${result.detail}`, tally));
    }
  }

  let sweeping: Promise<CardCheckoutSweepResult> | null = null;

  async function runSweep(sweepOptions: CardCheckoutSweepOptions): Promise<CardCheckoutSweepResult> {
    const startedAt = now().getTime();
    const pendingBefore = new Date(startedAt - (sweepOptions.pendingAfterMs ?? SWEEP_PENDING_AFTER_MS)).toISOString();
    const expireBefore = new Date(startedAt - (sweepOptions.expireAfterMs ?? SWEEP_EXPIRE_AFTER_MS)).toISOString();
    const due = await checkouts.listSweepable(pendingBefore, expireBefore, sweepOptions.batchSize ?? SWEEP_BATCH);
    const tally: SweepTally = {
      examined: 0, paid: 0, declined: 0, unapplied: 0, expired: 0, stillPending: 0, alreadySettled: 0,
      needsAttention: 0, unavailable: 0, failed: 0, deferred: 0,
    };
    let unavailableInARow = 0;
    for (const [index, checkout] of due.entries()) {
      if (sweepOptions.budgetMs !== undefined && now().getTime() - startedAt >= sweepOptions.budgetMs) {
        tally.deferred = due.length - index;
        break;
      }
      // ONLY a provider-wide failure ends the pass early. An answer that is
      // wrong for one order says nothing about the next, and giving up on those
      // would let the oldest few checkouts block every pass behind them.
      if (unavailableInARow >= SWEEP_GIVE_UP_AFTER_UNAVAILABLE) {
        tally.unavailable += due.length - index;
        tally.examined = due.length;
        return tally;
      }
      tally.examined += 1;
      const unavailableBefore = tally.unavailable;
      try {
        await checkouts.markSwept(checkout.id, nowIso());
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
    sweeping = platform.inTheTurn("card checkout sweep", () => runSweep(sweepOptions)).finally(() => {
      sweeping = null;
    });
    return sweeping;
  }

  function amountToApply(checkout: CardCheckout, input: ApplyUnappliedInput): Money {
    const refuse = (ar: string, en: string) => new CardPaymentNotApplicableError([ar], [en]);
    const captured = checkout.capturedAmount;
    const amount = input.amount ?? captured;
    if (!amount) {
      throw refuse("مزوّد الدفع لم يسجّل مبلغًا لهذه العملية؛ أدخل المبلغ المحصَّل", "the provider recorded no amount for this checkout; enter the amount collected");
    }
    if (amount.scaled <= 0n) throw refuse("المبلغ يجب أن يكون أكبر من صفر", "the amount must be greater than zero");
    if ((!captured || !amount.equals(captured)) && !input.overrideAmount) {
      throw refuse(
        `المبلغ ${amount.toString()} لا يطابق ما حصّله مزوّد الدفع (${captured?.toString() ?? "غير مسجَّل"})؛ أكِّد التجاوز لتسجيله`,
        `amount ${amount.toString()} is not what the provider collected (${captured?.toString() ?? "not recorded"}); confirm the override to record it`,
      );
    }
    return amount;
  }

  async function applyUnapplied(input: ApplyUnappliedInput): Promise<ApplyUnappliedResult> {
    const refuse = (ar: string, en: string) => new CardPaymentNotApplicableError([ar], [en]);
    const reason = input.reason.trim();
    if (reason === "") throw refuse("سبب التطبيق مطلوب", "a reason is required");

    const checkout = await checkouts.findById(input.checkoutId);
    if (!checkout || checkout.tenantId !== input.tenantId) throw refuse("عملية الدفع غير موجودة لهذه المنشأة", "no such checkout for this tenant");
    if (checkout.status !== CardCheckoutStatus.Unapplied || !checkout.providerRef) {
      throw refuse(`حالة عملية الدفع "${checkout.status}" ليست «غير مطبّقة»`, `checkout status "${checkout.status}" is not unapplied`);
    }
    const amount = amountToApply(checkout, input);
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
      amount,
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
        from: [CardCheckoutStatus.Unapplied],
        subscriptionBefore: subscription,
        subscriptionAfter: renewed,
        payment,
      });
      if (outcome !== PaidSettlementOutcome.Paid) {
        throw refuse("تغيّرت عملية الدفع أو الاشتراك أثناء التطبيق، أعد المحاولة", `the checkout or subscription changed while applying (${outcome}); try again`);
      }
      await auditEvent(CardCheckoutAuditAction.PaymentAppliedManually, checkout.tenantId, {
        checkoutId: checkout.id, paymentId: payment.id, providerRef: checkout.providerRef, amount: amount.toString(),
        captured: checkout.capturedAmount?.toString() ?? null,
        amountOverridden: !checkout.capturedAmount || !amount.equals(checkout.capturedAmount),
        expected: checkout.amount.toString(), was: checkout.failureReason, reason,
      }, EventSeverity.Warning, input.actorId);
    };
    // The renewal, the payment and the record of who applied it and why are one
    // transaction: an owner-forced renewal that left no trail must not exist.
    await (platform.audit.atomic ? platform.audit.atomic(settleAndRecord) : settleAndRecord());

    const tenant = await platform.stores.tenants.findById(checkout.tenantId);
    if (tenant) options.invalidateEntitlements(tenant.code);
    return { checkout: (await checkouts.findById(checkout.id))!, payment };
  }

  const snapshot = (checkout: CardCheckout) => ({
    status: checkout.status,
    failureReason: checkout.failureReason,
    attentionCause: checkout.attentionCause,
    resolution: checkout.resolution,
    providerRef: checkout.providerRef,
    paymentId: checkout.paymentId,
  });

  async function handApplication(checkout: CardCheckout, input: ResolveFlaggedInput, reason: string, stamp: string) {
    const refuse = (ar: string, en: string) => new CardPaymentNotApplicableError([ar], [en]);
    const providerRef = input.providerRef?.trim() ?? "";
    if (!PROVIDER_TRANSACTION_NUMBER.test(providerRef)) {
      throw refuse("أدخل رقم العملية كما يظهر في لوحة مزوّد الدفع (أرقام فقط)", "enter the transaction number shown on the provider's dashboard (digits only)");
    }
    const amount = input.amount;
    if (!amount) throw refuse("أدخل المبلغ المحصَّل كما يظهر في لوحة مزوّد الدفع", "enter the amount collected as the provider's dashboard shows it");
    if (amount.scaled <= 0n) throw refuse("المبلغ يجب أن يكون أكبر من صفر", "the amount must be greater than zero");
    if (!amount.equals(checkout.amount) && !input.overrideAmount) {
      throw refuse(
        `المبلغ ${amount.toString()} لا يطابق قيمة عملية الدفع (${checkout.amount.toString()})؛ أكِّد التجاوز لتسجيله`,
        `amount ${amount.toString()} is not the checkout's amount (${checkout.amount.toString()}); confirm the override to record it`,
      );
    }
    const reference = `PAYMOB-${providerRef}`;
    if (await platform.stores.payments.findByReference(checkout.tenantId, reference)) {
      throw refuse(`المرجع "${reference}" مسجَّل كدفعة من قبل`, `reference "${reference}" is already recorded as a payment`);
    }
    const subscription = await platform.stores.subscriptions.findById(checkout.subscriptionId);
    if (!subscription) throw new SubscriptionNotFoundError(checkout.subscriptionId);
    const renewed = applyRenewal(subscription, stamp);
    const payment: Payment = {
      id: idOf(),
      tenantId: checkout.tenantId,
      subscriptionId: checkout.subscriptionId,
      amount,
      currency: "EGP",
      reference,
      paidAt: stamp,
      recordedBy: input.actorId,
      note: `بطاقة — تطبيق يدوي لعملية دفع معلّقة للمراجعة ${checkout.id}: ${reason}`,
      createdAt: stamp,
    };
    return { providerRef, amount, subscription, renewed, payment };
  }

  async function resolveFlagged(input: ResolveFlaggedInput): Promise<CardCheckout> {
    const refuse = (ar: string, en: string) => new CardPaymentNotApplicableError([ar], [en]);
    const reason = input.reason.trim();
    if (reason === "") throw refuse("سبب القرار مطلوب", "a reason is required");
    const before = await checkouts.findById(input.checkoutId);
    if (!before || before.tenantId !== input.tenantId) throw refuse("عملية الدفع غير موجودة لهذه المنشأة", "no such checkout for this tenant");
    if (before.status !== CardCheckoutStatus.Pending || before.failureReason !== CardCheckoutFailureReason.NeedsAttention || before.resolvedAt !== null) {
      throw refuse("عملية الدفع ليست معلّقة للمراجعة، أو سبق البتّ فيها", "the checkout is not waiting for a review, or was already resolved");
    }
    const stamp = nowIso();
    const byHand = input.resolution === CardCheckoutResolution.AppliedByHand ? await handApplication(before, input, reason, stamp) : null;
    const changed = () => refuse("تغيّرت عملية الدفع أو الاشتراك أثناء التنفيذ، أعد المحاولة", "the checkout or subscription changed meanwhile; try again");

    const resolveAndRecord = async () => {
      const marked = await checkouts.resolveFlagged({
        checkoutId: before.id,
        resolution: input.resolution,
        status: input.resolution === CardCheckoutResolution.Refunded ? CardCheckoutStatus.Refunded : CardCheckoutStatus.Pending,
        resolvedBy: input.actorId,
        reason,
        now: stamp,
      });
      if (!marked) throw changed();
      if (byHand) {
        const outcome = await checkouts.settlePaid({
          provider: before.provider,
          providerRef: byHand.providerRef,
          now: stamp,
          checkoutId: before.id,
          from: [CardCheckoutStatus.Pending],
          subscriptionBefore: byHand.subscription,
          subscriptionAfter: byHand.renewed,
          payment: byHand.payment,
        });
        if (outcome === PaidSettlementOutcome.Duplicate) {
          throw refuse(`رقم العملية ${byHand.providerRef} عولج من قبل`, `transaction ${byHand.providerRef} was already processed`);
        }
        if (outcome !== PaidSettlementOutcome.Paid) throw changed();
      }
      const after = (await checkouts.findById(before.id))!;
      await auditEvent(CardCheckoutAuditAction.CheckoutResolved, before.tenantId, {
        checkoutId: before.id, resolution: input.resolution, reason, before: snapshot(before), after: snapshot(after),
        ...(byHand
          ? {
              paymentId: byHand.payment.id, amount: byHand.amount.toString(), expected: before.amount.toString(),
              amountOverridden: !byHand.amount.equals(before.amount),
            }
          : {}),
      }, EventSeverity.Critical, input.actorId);
      return after;
    };
    const after = await (platform.audit.atomic ? platform.audit.atomic(resolveAndRecord) : resolveAndRecord());

    if (byHand) {
      const tenant = await platform.stores.tenants.findById(before.tenantId);
      if (tenant) options.invalidateEntitlements(tenant.code);
    }
    return after;
  }

  return {
    provider: options.provider,
    open: (input) => platform.inTheTurn("card checkout", () => open(input)),
    handleWebhook: (rawBody, signature) => platform.inTheTurn("card callback", () => handleWebhook(rawBody, signature)),
    sweepPending,
    sweepRunning: () => sweeping !== null,
    applyUnapplied: (input) => platform.inTheTurn("card payment applied by hand", () => applyUnapplied(input)),
    resolveFlagged: (input) => platform.inTheTurn("card checkout resolution", () => resolveFlagged(input)),
    listByTenant: (tenantId) => checkouts.listByTenant(tenantId),
    find: (id) => checkouts.findById(id),
  };
}
