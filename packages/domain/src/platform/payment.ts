import type { Money } from "../money/money.js";
import { renewSubscription, type Subscription, type SubscriptionRepository } from "./subscription.js";
import { isoTimestamp } from "./validation.js";
import { InvalidPaymentError, PaymentIdempotencyConflictError, PaymentReferenceAlreadyRecordedError, SubscriptionNotFoundError } from "./errors.js";

export interface Payment {
  readonly id: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly amount: Money;
  readonly currency: "EGP";
  readonly reference: string;
  readonly paidAt: string;
  readonly recordedBy: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface PaymentRepository {
  findById(id: string): Promise<Payment | null>;
  /** The earliest payment the tenant holds under this reference. A reference is what the bank or the customer wrote, so it can legitimately repeat. */
  findByReference(tenantId: string, reference: string): Promise<Payment | null>;
  /** The payment one submission produced. The key is minted by the client per intended payment, so one tenant never holds two payments under it. */
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Payment | null>;
  listByTenant(tenantId: string): Promise<Payment[]>;
  save(payment: Payment, idempotencyKey?: string): Promise<void>;
  /**
   * Renewing the subscription and recording the payment that bought the renewal
   * are ONE act — the card path already settles them in a single transaction
   * (`SqliteCardCheckoutStore.settlePaid`). The key and reference lookups that
   * make a retry harmless run inside it too, so two simultaneous submissions
   * cannot both find nothing. Omitted, the manual path is neither atomic nor
   * race-free.
   */
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

export interface RecordPaymentCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly amount: Money;
  readonly reference: string;
  readonly paidAt: string;
  readonly recordedBy: string;
  readonly note?: string | null;
  readonly now: string;
  readonly idempotencyKey: string;
  /** The caller has been told the reference is already recorded and says this is another payment. */
  readonly confirmDuplicateReference?: boolean;
}

export interface RecordPaymentResult {
  readonly payment: Payment;
  readonly subscription: Subscription;
  /** True when this very submission was already recorded: nothing was renewed or written this time. */
  readonly replayed: boolean;
  /** The earlier payment under the same reference that the caller confirmed this one is not. */
  readonly duplicateOfPaymentId: string | null;
}

export interface RecordPaymentHooks {
  /**
   * Runs inside the payment's transaction, after the renewal and the payment row
   * and never on a replay. Throwing rolls both back — which is how a payment is
   * kept from existing without the audit event that records it.
   */
  readonly onRecorded?: (recorded: {
    readonly payment: Payment;
    readonly subscription: Subscription;
    readonly duplicateOfPaymentId: string | null;
  }) => Promise<void>;
}

export async function recordPayment(
  cmd: RecordPaymentCommand,
  payments: PaymentRepository,
  subscriptions: SubscriptionRepository,
  hooks: RecordPaymentHooks = {},
): Promise<RecordPaymentResult> {
  const now = isoTimestamp(cmd.now);
  const paidAt = isoTimestamp(cmd.paidAt);
  const reference = cmd.reference.trim();
  const idempotencyKey = cmd.idempotencyKey.trim();
  const reasons: string[] = [];
  if (cmd.id.trim() === "" || cmd.tenantId.trim() === "" || cmd.subscriptionId.trim() === "") {
    reasons.push("المعرّف ومعرّف المنشأة ومعرّف الاشتراك مطلوبة");
  }
  if (cmd.amount.scaled <= 0n) reasons.push("المبلغ يجب أن يكون أكبر من صفر");
  if (reference === "") reasons.push("المرجع مطلوب");
  if (idempotencyKey === "") reasons.push("مفتاح منع التكرار مطلوب");
  if (!paidAt) reasons.push("تاريخ السداد غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!now) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!now || !paidAt || reasons.length > 0) throw new InvalidPaymentError(reasons);

  const subscription = await subscriptions.findById(cmd.subscriptionId);
  if (!subscription) throw new SubscriptionNotFoundError(cmd.subscriptionId);
  if (subscription.tenantId !== cmd.tenantId) {
    throw new InvalidPaymentError([`الاشتراك "${cmd.subscriptionId}" لا يخص المنشأة "${cmd.tenantId}"`]);
  }

  const run = async (): Promise<RecordPaymentResult> => {
    const submitted = await payments.findByIdempotencyKey(cmd.tenantId, idempotencyKey);
    if (submitted) {
      if (submitted.subscriptionId !== cmd.subscriptionId || !submitted.amount.equals(cmd.amount) || submitted.reference !== reference) {
        throw new PaymentIdempotencyConflictError(idempotencyKey);
      }
      const current = await subscriptions.findById(cmd.subscriptionId);
      return { payment: submitted, subscription: current ?? subscription, replayed: true, duplicateOfPaymentId: null };
    }
    const sameReference = await payments.findByReference(cmd.tenantId, reference);
    if (sameReference && cmd.confirmDuplicateReference !== true) {
      throw new PaymentReferenceAlreadyRecordedError(reference, {
        id: sameReference.id,
        amount: sameReference.amount.toString(),
        paidAt: sameReference.paidAt,
        recordedAt: sameReference.createdAt,
      });
    }
    const duplicateOfPaymentId = sameReference?.id ?? null;
    const renewed = await renewSubscription({ id: cmd.subscriptionId, now }, subscriptions);
    const payment: Payment = {
      id: cmd.id,
      tenantId: cmd.tenantId,
      subscriptionId: cmd.subscriptionId,
      amount: cmd.amount,
      currency: "EGP",
      reference,
      paidAt,
      recordedBy: cmd.recordedBy,
      note: cmd.note ?? null,
      createdAt: now,
    };
    await payments.save(payment, idempotencyKey);
    await hooks.onRecorded?.({ payment, subscription: renewed, duplicateOfPaymentId });
    return { payment, subscription: renewed, replayed: false, duplicateOfPaymentId };
  };
  return payments.transaction ? payments.transaction(run) : run();
}
