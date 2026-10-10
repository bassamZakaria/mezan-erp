import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { recordPayment, type Payment, type PaymentRepository } from "./payment.js";
import type { Subscription, SubscriptionRepository } from "./subscription.js";
import {
  InvalidPaymentError,
  InvalidSubscriptionTransitionError,
  PaymentIdempotencyConflictError,
  PaymentReferenceAlreadyRecordedError,
  SubscriptionNotFoundError,
} from "./errors.js";

function memoryPayments(): PaymentRepository & { rows: Map<string, Payment> } {
  const rows = new Map<string, Payment>();
  const keys = new Map<string, string>();
  return {
    rows,
    async findByIdempotencyKey(tenantId, key) {
      const id = keys.get(`${tenantId}|${key}`);
      return id ? (rows.get(id) ?? null) : null;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async findByReference(tenantId, reference) {
      return [...rows.values()].find((p) => p.tenantId === tenantId && p.reference === reference) ?? null;
    },
    async listByTenant(tenantId) {
      return [...rows.values()]
        .filter((p) => p.tenantId === tenantId)
        .sort((a, b) => (a.paidAt < b.paidAt ? 1 : a.paidAt > b.paidAt ? -1 : 0));
    },
    async save(p, idempotencyKey) {
      rows.set(p.id, p);
      if (idempotencyKey) keys.set(`${p.tenantId}|${idempotencyKey}`, p.id);
    },
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
    async listByPlan(planId) { return [...rows.values()].filter((s) => s.planId === planId && s.status !== "cancelled"); },
    async save(s) { rows.set(s.id, s); },
  };
}

const NOW = "2026-09-14T10:00:00.000Z";

const sub: Subscription = {
  id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly", addOnModules: [],
  extraSeats: 0, extraBranches: 0, extraWarehouses: 0, currentPeriodStart: "2026-08-14T10:00:00.000Z",
  currentPeriodEnd: "2026-09-14T10:00:00.000Z", trialEndsAt: null, previousPlanId: null, graceDays: 7, cancelledAt: null,
  createdAt: "2026-08-14T10:00:00.000Z", updatedAt: "2026-08-14T10:00:00.000Z",
};

const cmd = {
  id: "PAY1", tenantId: "T1", subscriptionId: "S1", amount: Money.fromMajor("490.50"),
  reference: "TRX-001", paidAt: "2026-09-14T09:00:00.000Z", recordedBy: "U1", now: NOW, idempotencyKey: "KEY-1",
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

  it("surfaces the renew error for a cancelled subscription and writes no payment", async () => {
    const cancelled: Subscription = { ...sub, status: "cancelled", cancelledAt: NOW };
    const payments = memoryPayments();
    await expect(
      recordPayment(cmd, payments, memorySubscriptions([cancelled])),
    ).rejects.toThrow(InvalidSubscriptionTransitionError);
    expect(payments.rows.size).toBe(0);
  });
});

describe("a manual payment renews and records as one act", () => {
  /** Rolls back the subscription rows when the body throws, like the SQLite store does. */
  function transactional(payments: PaymentRepository, subscriptions: ReturnType<typeof memorySubscriptions>) {
    return {
      ...payments,
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        const snapshot = new Map(subscriptions.rows);
        try {
          return await fn();
        } catch (err) {
          subscriptions.rows.clear();
          for (const [k, v] of snapshot) subscriptions.rows.set(k, v);
          throw err;
        }
      },
    } satisfies PaymentRepository;
  }

  const cmd = {
    id: "PMT-1",
    tenantId: "T1",
    subscriptionId: "S1",
    amount: Money.fromMajor("2500.00"),
    reference: "TRF-9001",
    paidAt: NOW,
    recordedBy: "admin",
    now: NOW,
    idempotencyKey: "KEY-PMT-1",
  };

  it("leaves the subscription un-renewed when the payment row cannot be written", async () => {
    const subscriptions = memorySubscriptions([sub]);
    const payments = transactional(
      { ...memoryPayments(), async save() { throw new Error("duplicate payment id"); } },
      subscriptions,
    );

    await expect(recordPayment(cmd, payments, subscriptions)).rejects.toThrow("duplicate payment id");
    // The tenant must not keep a period nothing paid for.
    expect(subscriptions.rows.get("S1")!.currentPeriodEnd).toBe(sub.currentPeriodEnd);
  });

  it("commits the renewal and the payment together on success", async () => {
    const subscriptions = memorySubscriptions([sub]);
    const store = memoryPayments();
    const result = await recordPayment(cmd, transactional(store, subscriptions), subscriptions);

    expect(store.rows.get("PMT-1")!.reference).toBe("TRF-9001");
    expect(subscriptions.rows.get("S1")!.currentPeriodEnd).toBe(result.subscription.currentPeriodEnd);
    expect(result.subscription.currentPeriodEnd).not.toBe(sub.currentPeriodEnd);
  });
});

describe("recordPayment is idempotent on the caller's key, not on the reference", () => {
  const LATER = "2026-09-14T10:05:00.000Z";

  it("answers a repeated key with the payment already recorded and renews only once", async () => {
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub]);
    const first = await recordPayment(cmd, payments, subscriptions);
    const second = await recordPayment({ ...cmd, id: "PAY2", now: LATER }, payments, subscriptions);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe("PAY1");
    expect(payments.rows.size).toBe(1);
    expect(second.subscription.currentPeriodEnd).toBe(first.subscription.currentPeriodEnd);
    expect(subscriptions.rows.get("S1")!.currentPeriodEnd).toBe("2026-10-14T10:00:00.000Z");
  });

  it("refuses a repeated key that carries a different payment, and changes nothing", async () => {
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub]);
    const first = await recordPayment(cmd, payments, subscriptions);

    for (const changed of [{ amount: Money.fromMajor("500.00") }, { reference: "TRX-002" }]) {
      await expect(recordPayment({ ...cmd, id: "PAY2", ...changed }, payments, subscriptions)).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
    }
    expect(payments.rows.size).toBe(1);
    expect(subscriptions.rows.get("S1")!.currentPeriodEnd).toBe(first.subscription.currentPeriodEnd);
  });

  it("refuses a second, separately submitted payment under a reference already recorded, saying when it was", async () => {
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub]);
    const first = await recordPayment(cmd, payments, subscriptions);

    const refusal = await recordPayment({ ...cmd, id: "PAY2", idempotencyKey: "KEY-2", now: LATER }, payments, subscriptions).catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(PaymentReferenceAlreadyRecordedError);
    expect(refusal).toMatchObject({ code: "PAYMENT_REFERENCE_ALREADY_RECORDED", reference: "TRX-001", recorded: { id: "PAY1" } });
    expect((refusal as Error).message).toContain("بتاريخ 2026-09-14 بمبلغ 490.50 ج.م");
    expect(payments.rows.size).toBe(1);
    expect(subscriptions.rows.get("S1")!.currentPeriodEnd).toBe(first.subscription.currentPeriodEnd);
  });

  it("treats surrounding whitespace as the same reference", async () => {
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub]);
    await recordPayment(cmd, payments, subscriptions);
    await expect(
      recordPayment({ ...cmd, id: "PAY2", idempotencyKey: "KEY-2", reference: "  TRX-001 " }, payments, subscriptions),
    ).rejects.toBeInstanceOf(PaymentReferenceAlreadyRecordedError);
  });

  it("records a second genuine payment under the same reference once the duplicate is confirmed, and renews again", async () => {
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub]);
    const first = await recordPayment(cmd, payments, subscriptions);

    const second = await recordPayment(
      { ...cmd, id: "PAY2", idempotencyKey: "KEY-2", now: LATER, confirmDuplicateReference: true },
      payments,
      subscriptions,
    );

    expect(second.replayed).toBe(false);
    expect(second.duplicateOfPaymentId).toBe("PAY1");
    expect(first.duplicateOfPaymentId).toBeNull();
    expect(payments.rows.size).toBe(2);
    expect(second.subscription.currentPeriodEnd).not.toBe(first.subscription.currentPeriodEnd);
  });

  it("answers a retry of the confirmed duplicate with that same second payment", async () => {
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub]);
    await recordPayment(cmd, payments, subscriptions);
    const confirmed = { ...cmd, id: "PAY2", idempotencyKey: "KEY-2", now: LATER, confirmDuplicateReference: true };
    await recordPayment(confirmed, payments, subscriptions);

    const retried = await recordPayment({ ...confirmed, id: "PAY3" }, payments, subscriptions);

    expect(retried.replayed).toBe(true);
    expect(retried.payment.id).toBe("PAY2");
    expect(payments.rows.size).toBe(2);
  });

  it("refuses an empty key", async () => {
    await expect(recordPayment({ ...cmd, idempotencyKey: "  " }, memoryPayments(), memorySubscriptions([sub]))).rejects.toBeInstanceOf(InvalidPaymentError);
  });

  it("lets two tenants use the same reference and the same key", async () => {
    const other: Subscription = { ...sub, id: "S2", tenantId: "T2" };
    const payments = memoryPayments();
    const subscriptions = memorySubscriptions([sub, other]);
    await recordPayment(cmd, payments, subscriptions);
    const second = await recordPayment({ ...cmd, id: "PAY2", tenantId: "T2", subscriptionId: "S2" }, payments, subscriptions);

    expect(second.replayed).toBe(false);
    expect(payments.rows.size).toBe(2);
  });
});
