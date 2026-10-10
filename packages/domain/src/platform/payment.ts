import type { Money } from "../money/money.js";
import { renewSubscription, type Subscription, type SubscriptionRepository } from "./subscription.js";
import { isoTimestamp } from "./validation.js";
import { InvalidPaymentError, PaymentReferenceConflictError, SubscriptionNotFoundError } from "./errors.js";

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
  /** The reference is the caller's own idempotency key: one tenant never holds two payments under it. */
  findByReference(tenantId: string, reference: string): Promise<Payment | null>;
  listByTenant(tenantId: string): Promise<Payment[]>;
  save(payment: Payment): Promise<void>;
  /**
   * Renewing the subscription and recording the payment that bought the renewal
   * are ONE act — the card path already settles them in a single transaction
   * (`SqliteCardCheckoutStore.settlePaid`). The reference lookup that makes a
   * retry harmless runs inside it too, so two simultaneous submissions cannot
   * both find nothing. Omitted, the manual path is neither atomic nor
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
}

export interface RecordPaymentResult {
  readonly payment: Payment;
  readonly subscription: Subscription;
  /** True when this reference was already recorded: nothing was renewed or written this time. */
  readonly replayed: boolean;
}

export async function recordPayment(
  cmd: RecordPaymentCommand,
  payments: PaymentRepository,
  subscriptions: SubscriptionRepository,
): Promise<RecordPaymentResult> {
  const now = isoTimestamp(cmd.now);
  const paidAt = isoTimestamp(cmd.paidAt);
  const reference = cmd.reference.trim();
  const reasons: string[] = [];
  if (cmd.id.trim() === "" || cmd.tenantId.trim() === "" || cmd.subscriptionId.trim() === "") {
    reasons.push("المعرّف ومعرّف المنشأة ومعرّف الاشتراك مطلوبة");
  }
  if (cmd.amount.scaled <= 0n) reasons.push("المبلغ يجب أن يكون أكبر من صفر");
  if (reference === "") reasons.push("المرجع مطلوب");
  if (!paidAt) reasons.push("تاريخ السداد غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!now) reasons.push("الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)");
  if (!now || !paidAt || reasons.length > 0) throw new InvalidPaymentError(reasons);

  const subscription = await subscriptions.findById(cmd.subscriptionId);
  if (!subscription) throw new SubscriptionNotFoundError(cmd.subscriptionId);
  if (subscription.tenantId !== cmd.tenantId) {
    throw new InvalidPaymentError([`الاشتراك "${cmd.subscriptionId}" لا يخص المنشأة "${cmd.tenantId}"`]);
  }

  const run = async (): Promise<RecordPaymentResult> => {
    const recorded = await payments.findByReference(cmd.tenantId, reference);
    if (recorded) {
      if (recorded.subscriptionId !== cmd.subscriptionId || !recorded.amount.equals(cmd.amount)) {
        throw new PaymentReferenceConflictError(reference);
      }
      const current = await subscriptions.findById(cmd.subscriptionId);
      return { payment: recorded, subscription: current ?? subscription, replayed: true };
    }
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
    await payments.save(payment);
    return { payment, subscription: renewed, replayed: false };
  };
  return payments.transaction ? payments.transaction(run) : run();
}
