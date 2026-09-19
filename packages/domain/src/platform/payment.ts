import type { Money } from "../money/money.js";
import { renewSubscription, type Subscription, type SubscriptionRepository } from "./subscription.js";
import { isoTimestamp } from "./validation.js";
import { InvalidPaymentError, SubscriptionNotFoundError } from "./errors.js";

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
  listByTenant(tenantId: string): Promise<Payment[]>;
  save(payment: Payment): Promise<void>;
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

  return { payment, subscription: renewed };
}
