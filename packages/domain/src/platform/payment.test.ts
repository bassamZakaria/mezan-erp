import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { recordPayment, type Payment, type PaymentRepository } from "./payment.js";
import type { Subscription, SubscriptionRepository } from "./subscription.js";
import { InvalidPaymentError, InvalidSubscriptionTransitionError, SubscriptionNotFoundError } from "./errors.js";

function memoryPayments(): PaymentRepository & { rows: Map<string, Payment> } {
  const rows = new Map<string, Payment>();
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async listByTenant(tenantId) {
      return [...rows.values()]
        .filter((p) => p.tenantId === tenantId)
        .sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0));
    },
    async save(p) { rows.set(p.id, p); },
  };
}

function memorySubscriptions(seed: Subscription[] = []): SubscriptionRepository & { rows: Map<string, Subscription> } {
  const rows = new Map(seed.map((s) => [s.id, s]));
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findLiveByTenant(tenantId) {
      return [...rows.values()].find((s) => s.tenantId === tenantId && s.status !== "cancelled") ?? null;
    },
    async listByTenant(tenantId) { return [...rows.values()].filter((s) => s.tenantId === tenantId); },
    async hasLiveByPlan(planId) { return [...rows.values()].some((s) => s.planId === planId && s.status !== "cancelled"); },
    async save(s) { rows.set(s.id, s); },
  };
}

const NOW = "2026-09-14T10:00:00.000Z";

const sub: Subscription = {
  id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly", addOnModules: [],
  extraSeats: 0, extraBranches: 0, extraWarehouses: 0, currentPeriodStart: "2026-08-14T10:00:00.000Z",
  currentPeriodEnd: "2026-09-14T10:00:00.000Z", trialEndsAt: null, graceDays: 7, cancelledAt: null,
  createdAt: "2026-08-14T10:00:00.000Z", updatedAt: "2026-08-14T10:00:00.000Z",
};

const cmd = {
  id: "PAY1", tenantId: "T1", subscriptionId: "S1", amount: Money.fromMajor("490.50"),
  reference: "TRX-001", paidAt: "2026-09-14T09:00:00.000Z", recordedBy: "U1", now: NOW,
};

describe("recordPayment", () => {
  it("saves a payment in EGP with normalised timestamps and renews the subscription", async () => {
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub]);
    const { payment, subscription } = await recordPayment(cmd, payments, subscriptions);

    expect(payment).toEqual({
      id: "PAY1", tenantId: "T1", subscriptionId: "S1", amount: cmd.amount, currency: "EGP",
      reference: "TRX-001", paidAt: "2026-09-14T09:00:00.000Z", recordedBy: "U1", note: null, createdAt: NOW,
    });
    expect(payments.rows.get("PAY1")).toEqual(payment);
    expect(subscription.status).toBe("active");
    expect(subscription.currentPeriodEnd).toBe("2026-10-14T10:00:00.000Z");
    expect(subscriptions.rows.get("S1")).toEqual(subscription);
  });

  it("carries a note when given", async () => {
    const { payment } = await recordPayment(
      { ...cmd, note: "شيك مؤجل" },
      memoryPayments(),
      memorySubscriptions([sub]),
    );
    expect(payment.note).toBe("شيك مؤجل");
  });

  it("refuses an amount of zero or less", async () => {
    await expect(
      recordPayment({ ...cmd, amount: Money.zero() }, memoryPayments(), memorySubscriptions([sub])),
    ).rejects.toThrow(InvalidPaymentError);
    await expect(
      recordPayment({ ...cmd, amount: Money.fromMajor("-1") }, memoryPayments(), memorySubscriptions([sub])),
    ).rejects.toThrow(InvalidPaymentError);
  });

  it("refuses an empty reference", async () => {
    await expect(
      recordPayment({ ...cmd, reference: "  " }, memoryPayments(), memorySubscriptions([sub])),
    ).rejects.toThrow(InvalidPaymentError);
  });

  it("refuses an unparseable paidAt", async () => {
    await expect(
      recordPayment({ ...cmd, paidAt: "not-a-date" }, memoryPayments(), memorySubscriptions([sub])),
    ).rejects.toThrow(InvalidPaymentError);
  });

  it("refuses a subscription that does not belong to the tenant", async () => {
    await expect(
      recordPayment({ ...cmd, tenantId: "T2" }, memoryPayments(), memorySubscriptions([sub])),
    ).rejects.toThrow(InvalidPaymentError);
  });

  it("refuses an unknown subscription", async () => {
    await expect(
      recordPayment(cmd, memoryPayments(), memorySubscriptions([])),
    ).rejects.toThrow(SubscriptionNotFoundError);
  });

  it("surfaces the renew error for a cancelled subscription", async () => {
    const cancelled: Subscription = { ...sub, status: "cancelled", cancelledAt: NOW };
    await expect(
      recordPayment(cmd, memoryPayments(), memorySubscriptions([cancelled])),
    ).rejects.toThrow(InvalidSubscriptionTransitionError);
  });
});
