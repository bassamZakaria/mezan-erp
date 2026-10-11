import { afterEach, describe, expect, it } from "vitest";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import {
  activateTenant,
  cancelSubscription,
  CardPaymentNotApplicableError,
  createTenant,
  Money,
  ProviderInquiryStatus,
  startSubscription,
  type CardCheckout,
  type PaymentProvider,
} from "@mezan/domain";
import {
  createCardCheckoutService,
  SettlementDetail,
  SWEEP_EXPIRE_AFTER_MS,
  SWEEP_PENDING_AFTER_MS,
  type CardCheckoutService,
} from "./card-checkout.js";
import { createPaymobProvider, createPaymobTestProvider, type PaymobTestProvider } from "./paymob-provider.js";

const OPENED = "2026-03-01T10:00:00.000Z";
const MINUTE = 60_000;

const platforms: PlatformHandle[] = [];
afterEach(() => {
  for (const platform of platforms.splice(0)) platform.close();
});

interface Rig {
  readonly platform: PlatformHandle;
  readonly provider: PaymobTestProvider;
  readonly service: CardCheckoutService;
  readonly invalidated: string[];
  readonly logged: string[];
  advance(ms: number): void;
  open(tenantId?: string): Promise<CardCheckout>;
  periodEnd(subscriptionId?: string): Promise<string>;
  payments(tenantId?: string): Promise<number>;
  actions(): Promise<string[]>;
  details(action: string): Promise<Record<string, unknown>[]>;
}

async function addTenant(platform: PlatformHandle, code: string): Promise<void> {
  const tenant = await createTenant(
    { id: `t-${code}`, code, nameAr: `منشأة ${code}`, ownerEmail: `owner@${code}.example`, now: OPENED },
    platform.stores.tenants,
  );
  await activateTenant({ id: tenant.id, now: OPENED }, platform.stores.tenants);
  await startSubscription(
    { id: `sub-${code}`, tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: OPENED },
    platform.stores.subscriptions,
    platform.stores.plans,
  );
}

async function rig(wrapProvider: (provider: PaymobTestProvider) => PaymentProvider = (p) => p): Promise<Rig> {
  const platform = await createPlatform({ dbPath: ":memory:" });
  platforms.push(platform);
  await addTenant(platform, "acme");
  const provider = createPaymobTestProvider();
  let clock = Date.parse(OPENED);
  let ids = 0;
  const invalidated: string[] = [];
  const logged: string[] = [];
  const service = createCardCheckoutService({
    platform,
    provider: wrapProvider(provider),
    now: () => new Date(clock),
    invalidateEntitlements: (code) => invalidated.push(code),
    idOf: () => `id-${++ids}`,
    log: (message) => logged.push(message),
  });
  const events = () => platform.audit.query("security", 200);
  return {
    platform,
    provider,
    service,
    invalidated,
    logged,
    advance: (ms) => {
      clock += ms;
    },
    open: (tenantId = "t-acme") =>
      service.open({ tenantId, requestedBy: "tester", returnUrl: (id) => `https://app.test/back?checkout=${id}`, notificationUrl: "https://app.test/hook" }),
    periodEnd: async (subscriptionId = "sub-acme") => (await platform.stores.subscriptions.findById(subscriptionId))!.currentPeriodEnd,
    payments: async (tenantId = "t-acme") => (await platform.stores.payments.listByTenant(tenantId)).length,
    actions: async () => (await events()).map((event) => event.action),
    details: async (action) =>
      (await events()).filter((event) => event.action === action).map((event) => event.details ?? {}),
  };
}

function deliver(r: Rig, checkout: CardCheckout, outcome: "success" | "failure" = "success") {
  const { rawBody, signature } = r.provider.simulateCallback(checkout, outcome);
  return r.service.handleWebhook(rawBody, signature);
}

const reload = async (r: Rig, checkout: CardCheckout) => (await r.service.find(checkout.id))!;

describe("card checkout — opening", () => {
  it("opens a pending checkout for the plan's own price, never a caller's figure", async () => {
    const r = await rig();
    const checkout = await r.open();
    const plan = (await r.platform.stores.plans.findById("PLAN-CORE"))!;

    expect(checkout.status).toBe("pending");
    expect(checkout.amount.equals(plan.priceMonthly)).toBe(true);
    expect(checkout.providerOrderRef).toMatch(/^\d+$/);
    expect(await r.actions()).toContain("CARD_CHECKOUT_OPENED");
  });
});

describe("card checkout — the callback", () => {
  it("renews the subscription and records the payment for a genuine paid callback", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();

    const result = await deliver(r, checkout);

    expect(result).toMatchObject({ status: "ok", detail: SettlementDetail.Paid });
    const paid = await reload(r, checkout);
    expect(paid.status).toBe("paid");
    expect(await r.periodEnd()).not.toBe(before);
    const [payment] = await r.platform.stores.payments.listByTenant("t-acme");
    expect(payment?.reference).toBe(`PAYMOB-${paid.providerRef}`);
    expect(payment?.amount.equals(checkout.amount)).toBe(true);
    expect(r.invalidated).toEqual(["acme"]);
    expect(await r.actions()).toContain("PAYMENT_RECORDED");
  });

  it("refuses a callback whose signature has one character changed", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();
    const { rawBody, signature } = r.provider.simulateCallback(checkout, "success");
    const forged = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;

    expect(await r.service.handleWebhook(rawBody, forged)).toEqual({ status: "rejected" });
    expect((await reload(r, checkout)).status).toBe("pending");
    expect(await r.periodEnd()).toBe(before);
    expect(await r.actions()).toContain("CARD_WEBHOOK_REJECTED");
  });

  it.each([
    ["an empty signature", ""],
    ["a truncated signature", "abc123"],
    ["a signature one hex digit too long", "a".repeat(129)],
    ["a non-hex signature of the right length", "z".repeat(128)],
  ])("refuses %s without throwing", async (_label, signature) => {
    const r = await rig();
    const checkout = await r.open();
    const { rawBody } = r.provider.simulateCallback(checkout, "success");

    expect(await r.service.handleWebhook(rawBody, signature)).toEqual({ status: "rejected" });
    expect((await reload(r, checkout)).status).toBe("pending");
  });

  it("refuses a body edited after it was signed", async () => {
    const r = await rig();
    const checkout = await r.open();
    const failure = r.provider.simulateCallback(checkout, "failure");
    const edited = failure.rawBody.replace('"success":false', '"success":true').replace('"error_occured":true', '"error_occured":false');

    expect(edited).not.toBe(failure.rawBody);
    expect(await r.service.handleWebhook(edited, failure.signature)).toEqual({ status: "rejected" });
    expect(await r.payments()).toBe(0);
  });

  it("renews once when the same callback is delivered twice", async () => {
    const r = await rig();
    const checkout = await r.open();
    const { rawBody, signature } = r.provider.simulateCallback(checkout, "success");

    const first = await r.service.handleWebhook(rawBody, signature);
    const afterFirst = await r.periodEnd();
    const second = await r.service.handleWebhook(rawBody, signature);

    expect(first).toMatchObject({ detail: SettlementDetail.Paid });
    expect(second).toMatchObject({ detail: SettlementDetail.Duplicate });
    expect(await r.periodEnd()).toBe(afterFirst);
    expect(await r.payments()).toBe(1);
  });

  it("renews once when the same callback arrives twice at the same moment", async () => {
    const r = await rig();
    const checkout = await r.open();
    const { rawBody, signature } = r.provider.simulateCallback(checkout, "success");

    const results = await Promise.all([
      r.service.handleWebhook(rawBody, signature),
      r.service.handleWebhook(rawBody, signature),
      r.service.handleWebhook(rawBody, signature),
    ]);

    const details = results.map((result) => (result.status === "ok" ? result.detail : result.status)).sort();
    expect(details).toEqual([SettlementDetail.Duplicate, SettlementDetail.Duplicate, SettlementDetail.Paid].sort());
    expect(await r.payments()).toBe(1);
    expect(r.invalidated).toEqual(["acme"]);
  });

  it("leaves a payment of the wrong amount unapplied", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();

    const result = await deliver(r, { ...checkout, amount: Money.fromMajor("1.00") });

    expect(result).toMatchObject({ detail: SettlementDetail.AmountMismatch });
    const after = await reload(r, checkout);
    expect(after.status).toBe("unapplied");
    expect(after.failureReason).toBe("AMOUNT_MISMATCH");
    expect(await r.periodEnd()).toBe(before);
    expect(await r.payments()).toBe(0);
    expect(await r.actions()).toContain("CARD_PAYMENT_UNAPPLIED");
  });

  it("leaves a payment unapplied when the plan's price changed after the checkout was opened", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();
    const plan = (await r.platform.stores.plans.findById("PLAN-CORE"))!;
    await r.platform.stores.plans.save({ ...plan, priceMonthly: plan.priceMonthly.add(Money.fromMajor("100.00")) });

    const result = await deliver(r, checkout);

    expect(result).toMatchObject({ detail: SettlementDetail.PriceChanged });
    expect((await reload(r, checkout)).failureReason).toBe("PRICE_CHANGED");
    expect(await r.periodEnd()).toBe(before);
    expect(await r.payments()).toBe(0);
  });

  it("leaves a payment unapplied when the subscription can no longer be renewed", async () => {
    const r = await rig();
    const checkout = await r.open();
    await cancelSubscription({ id: "sub-acme", now: OPENED }, r.platform.stores.subscriptions);

    const result = await deliver(r, checkout);

    expect(result).toMatchObject({ detail: SettlementDetail.SubscriptionNotRenewable });
    expect(await r.payments()).toBe(0);
  });

  it("marks a declined card failed and still accepts a later successful attempt on the same checkout", async () => {
    const r = await rig();
    const checkout = await r.open();

    expect(await deliver(r, checkout, "failure")).toMatchObject({ detail: SettlementDetail.Declined });
    expect((await reload(r, checkout)).status).toBe("failed");
    expect(await deliver(r, checkout, "success")).toMatchObject({ detail: SettlementDetail.Paid });
    expect((await reload(r, checkout)).status).toBe("paid");
    expect(await r.payments()).toBe(1);
  });
});

describe("card checkout — a settlement and its audit event are one transaction", () => {
  function failAudit(r: Rig, action: string): () => void {
    const realAppend = r.platform.audit.append.bind(r.platform.audit);
    r.platform.audit.append = async (event) => {
      if (event.action === action) throw new Error("audit sink unavailable");
      await realAppend(event);
    };
    return () => {
      r.platform.audit.append = realAppend;
    };
  }
  const signed = (r: Rig, checkout: CardCheckout) => r.provider.simulateCallback(checkout, "success");

  it("records no payment and asks the provider to deliver again when the payment's event cannot be written", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();
    const callback = signed(r, checkout);
    const restore = failAudit(r, "PAYMENT_RECORDED");

    const refused = await r.service.handleWebhook(callback.rawBody, callback.signature);

    expect(refused).toEqual({ status: "retry" });
    expect((await reload(r, checkout)).status).toBe("pending");
    expect(await r.periodEnd()).toBe(before);
    expect(await r.payments()).toBe(0);
    expect(r.invalidated).toEqual([]);

    restore();
    const redelivered = await r.service.handleWebhook(callback.rawBody, callback.signature);

    expect(redelivered).toMatchObject({ status: "ok", detail: SettlementDetail.Paid });
    expect(await r.payments()).toBe(1);
    expect((await r.actions()).filter((action) => action === "PAYMENT_RECORDED")).toHaveLength(1);
  });

  it("leaves a checkout pending, not silently unapplied, when the unapplied event cannot be written", async () => {
    const r = await rig();
    const checkout = await r.open();
    const callback = signed(r, { ...checkout, amount: Money.fromMajor("1.00") });
    const restore = failAudit(r, "CARD_PAYMENT_UNAPPLIED");

    const refused = await r.service.handleWebhook(callback.rawBody, callback.signature);

    expect(refused).toEqual({ status: "retry" });
    expect((await reload(r, checkout)).status).toBe("pending");

    restore();
    const redelivered = await r.service.handleWebhook(callback.rawBody, callback.signature);

    expect(redelivered).toMatchObject({ status: "ok", detail: SettlementDetail.AmountMismatch });
    expect((await reload(r, checkout)).status).toBe("unapplied");
    expect(await r.actions()).toContain("CARD_PAYMENT_UNAPPLIED");
  });

  it("does not lose the record of a second charge on a paid checkout when its event cannot be written", async () => {
    const r = await rig();
    const checkout = await r.open();
    await deliver(r, checkout);
    const second = signed(r, checkout);
    const restore = failAudit(r, "CARD_PAYMENT_DUPLICATE_CHARGE");

    expect(await r.service.handleWebhook(second.rawBody, second.signature)).toEqual({ status: "retry" });

    restore();
    const redelivered = await r.service.handleWebhook(second.rawBody, second.signature);

    expect(redelivered).toMatchObject({ status: "ok", detail: SettlementDetail.AlreadySettled });
    expect(await r.actions()).toContain("CARD_PAYMENT_DUPLICATE_CHARGE");
    expect(await r.payments()).toBe(1);
  });

  it("leaves a card payment unapplied, and deliverable, when its reference was already recorded by hand", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();
    const callback = signed(r, checkout);
    const providerRef = String((JSON.parse(callback.rawBody) as { obj: { id: number } }).obj.id);
    await r.platform.stores.payments.save({
      id: "PAY-BY-HAND", tenantId: "t-acme", subscriptionId: "sub-acme", amount: checkout.amount, currency: "EGP",
      reference: `PAYMOB-${providerRef}`, paidAt: OPENED, recordedBy: "PU-OWNER", note: null, createdAt: OPENED,
    });

    const result = await r.service.handleWebhook(callback.rawBody, callback.signature);

    expect(result).toMatchObject({ status: "ok", detail: SettlementDetail.ReferenceAlreadyRecorded });
    const after = await reload(r, checkout);
    expect(after.status).toBe("unapplied");
    expect(after.failureReason).toBe("REFERENCE_ALREADY_RECORDED");
    expect(after.capturedAmount?.equals(checkout.amount)).toBe(true);
    expect(await r.periodEnd()).toBe(before);
    expect(await r.payments()).toBe(1);
    expect(await r.details("CARD_PAYMENT_UNAPPLIED")).toMatchObject([{ reference: `PAYMOB-${providerRef}`, recordedPaymentId: "PAY-BY-HAND" }]);
    expect(await r.service.handleWebhook(callback.rawBody, callback.signature)).toMatchObject({ status: "ok", detail: SettlementDetail.Duplicate });
  });
});

describe("card checkout — sweeping checkouts whose callback never arrived", () => {
  it("settles a paid checkout the provider knows about through the callback's own path", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();
    r.provider.simulateCallback(checkout, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    const result = await r.service.sweepPending();

    expect(result).toMatchObject({ examined: 1, paid: 1, expired: 0, unavailable: 0, failed: 0 });
    expect((await reload(r, checkout)).status).toBe("paid");
    expect(await r.periodEnd()).not.toBe(before);
    expect(await r.payments()).toBe(1);
    expect(r.invalidated).toEqual(["acme"]);
    expect(await r.details("PAYMENT_RECORDED")).toEqual([expect.objectContaining({ via: "sweep", checkoutId: checkout.id })]);
  });

  it("renews exactly once when the sweep settles first and the late callback is then delivered twice", async () => {
    const r = await rig();
    const checkout = await r.open();
    const { rawBody, signature } = r.provider.simulateCallback(checkout, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    await r.service.sweepPending();
    const afterSweep = await r.periodEnd();
    const late = [await r.service.handleWebhook(rawBody, signature), await r.service.handleWebhook(rawBody, signature)];

    expect(late).toEqual([
      expect.objectContaining({ detail: SettlementDetail.Duplicate }),
      expect.objectContaining({ detail: SettlementDetail.Duplicate }),
    ]);
    expect(await r.periodEnd()).toBe(afterSweep);
    expect(await r.payments()).toBe(1);
  });

  it("renews exactly once when the callback and the sweep race", async () => {
    const r = await rig();
    const checkout = await r.open();
    const { rawBody, signature } = r.provider.simulateCallback(checkout, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    await Promise.all([r.service.sweepPending(), r.service.handleWebhook(rawBody, signature), r.service.sweepPending()]);

    expect(await r.payments()).toBe(1);
    expect((await reload(r, checkout)).status).toBe("paid");
    expect(r.invalidated).toEqual(["acme"]);
  });

  it("does nothing on a second pass", async () => {
    const r = await rig();
    const checkout = await r.open();
    r.provider.simulateCallback(checkout, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);
    await r.service.sweepPending();

    expect(await r.service.sweepPending()).toMatchObject({ examined: 0, paid: 0 });
    expect(await r.payments()).toBe(1);
  });

  it("leaves a checkout alone while a callback could still be on its way", async () => {
    const r = await rig();
    const checkout = await r.open();
    r.provider.simulateCallback(checkout, "success");
    r.advance(SWEEP_PENDING_AFTER_MS - MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 0 });
    expect((await reload(r, checkout)).status).toBe("pending");
  });

  it("marks a declined checkout failed", async () => {
    const r = await rig();
    const checkout = await r.open();
    r.provider.simulateCallback(checkout, "failure");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, declined: 1 });
    expect((await reload(r, checkout)).status).toBe("failed");
    expect(await r.payments()).toBe(0);
  });

  it("keeps waiting on a checkout the provider has never heard of until the expiry threshold", async () => {
    const r = await rig();
    const checkout = await r.open();
    r.advance(SWEEP_EXPIRE_AFTER_MS - MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, stillPending: 1, expired: 0 });
    expect((await reload(r, checkout)).status).toBe("pending");
  });

  it("expires a checkout the provider has never heard of once the threshold passes, and audits it", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();
    r.advance(SWEEP_EXPIRE_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, expired: 1 });
    const expired = await reload(r, checkout);
    expect(expired.status).toBe("failed");
    expect(expired.failureReason).toBe("EXPIRED");
    expect(await r.periodEnd()).toBe(before);
    expect(await r.details("CARD_CHECKOUT_EXPIRED")).toEqual([expect.objectContaining({ checkoutId: checkout.id })]);
  });

  it("does not report or audit an expiry for a checkout a callback settled while the provider was being asked", async () => {
    let r!: Rig;
    let stale!: CardCheckout;
    r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async (request) => {
        const answer = await provider.inquireTransaction(request);
        await deliver(r, stale);
        return answer;
      },
    }));
    stale = await r.open();
    r.advance(SWEEP_EXPIRE_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, expired: 0, alreadySettled: 1 });
    expect((await reload(r, stale)).status).toBe("paid");
    expect(await r.details("CARD_CHECKOUT_EXPIRED")).toEqual([]);
  });

  it("still applies a genuine payment that arrives after the checkout was expired", async () => {
    const r = await rig();
    const checkout = await r.open();
    r.advance(SWEEP_EXPIRE_AFTER_MS + MINUTE);
    await r.service.sweepPending();

    expect(await deliver(r, checkout)).toMatchObject({ detail: SettlementDetail.Paid });
    expect((await reload(r, checkout)).status).toBe("paid");
  });

  it("never expires a checkout on a 404 that is not Paymob's own answer, and expires it on the one that is", async () => {
    let answer = () => new Response("<html>404 Not Found</html>", { status: 404, headers: { "content-type": "text/html" } });
    const live = createPaymobProvider(
      { baseUrl: "https://accept.paymob.test/", secretKey: "sk", publicKey: "pk", hmacSecret: "hmac", integrationIds: [158], apiKey: "key" },
      (async (input: Parameters<typeof fetch>[0]) =>
        String(input).endsWith("/api/auth/tokens") ? new Response(JSON.stringify({ token: "bearer" }), { status: 200 }) : answer()) as typeof fetch,
    );
    const r = await rig((provider) => ({ ...provider, inquireTransaction: (request) => live.inquireTransaction(request) }));
    const checkout = await r.open();
    r.advance(SWEEP_EXPIRE_AFTER_MS * 3);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, unavailable: 1, expired: 0 });
    expect((await reload(r, checkout)).status).toBe("pending");

    answer = () => new Response(JSON.stringify({ detail: "Not found." }), { status: 404, headers: { "content-type": "application/json" } });
    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, unavailable: 0, expired: 1 });
    expect((await reload(r, checkout)).status).toBe("failed");
  });

  it("never expires a checkout while the provider cannot be asked", async () => {
    const r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async () => ({ status: ProviderInquiryStatus.Unavailable, reason: "HTTP 503" }),
    }));
    const checkout = await r.open();
    r.advance(SWEEP_EXPIRE_AFTER_MS * 3);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, unavailable: 1, expired: 0 });
    expect((await reload(r, checkout)).status).toBe("pending");
    expect(r.logged.join("\n")).toContain("HTTP 503");
  });

  it("carries on with the other checkouts when one inquiry throws", async () => {
    let calls = 0;
    const r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async (request) => {
        calls += 1;
        if (calls === 1) throw new Error("socket hang up");
        return provider.inquireTransaction(request);
      },
    }));
    await addTenant(r.platform, "beta");
    const first = await r.open("t-acme");
    r.advance(1000);
    const second = await r.open("t-beta");
    r.provider.simulateCallback(second, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 2, failed: 1, paid: 1 });
    expect((await reload(r, first)).status).toBe("pending");
    expect((await reload(r, second)).status).toBe("paid");
  });

  it("carries on past checkouts whose answer cannot be read, however many there are, and settles the one behind them", async () => {
    let inquiries = 0;
    const r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async (request) => {
        inquiries += 1;
        const answer = await provider.inquireTransaction(request);
        return answer.status === ProviderInquiryStatus.Found
          ? answer
          : { status: ProviderInquiryStatus.Unreadable, reason: "the transaction belongs to another integration" };
      },
    }));
    for (const code of ["shop1", "shop2", "shop3", "shop4"]) {
      await addTenant(r.platform, code);
      await r.open(`t-${code}`);
      r.advance(1000);
    }
    await addTenant(r.platform, "payer");
    const paid = await r.open("t-payer");
    r.provider.simulateCallback(paid, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 5, stillPending: 4, paid: 1, unavailable: 0, needsAttention: 0 });
    expect(inquiries).toBe(5);
    expect((await reload(r, paid)).status).toBe("paid");
  });

  it("flags an unreadable checkout for a person past the expiry threshold, once, and never expires it", async () => {
    const r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async () => ({ status: ProviderInquiryStatus.Unreadable, reason: "the inquiry answer is not a transaction" }),
    }));
    const before = await r.periodEnd();
    const checkout = await r.open();
    r.advance(SWEEP_EXPIRE_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, needsAttention: 1, expired: 0 });
    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, needsAttention: 1, expired: 0 });

    const flagged = await reload(r, checkout);
    expect(flagged.status).toBe("pending");
    expect(flagged.failureReason).toBe("NEEDS_ATTENTION");
    expect(await r.periodEnd()).toBe(before);
    expect(await r.details("CARD_CHECKOUT_NEEDS_ATTENTION")).toEqual([
      expect.objectContaining({ checkoutId: checkout.id, why: "the inquiry answer is not a transaction" }),
    ]);
    expect(await r.details("CARD_CHECKOUT_EXPIRED")).toEqual([]);

    expect(await deliver(r, checkout)).toMatchObject({ detail: SettlementDetail.Paid });
    expect((await reload(r, checkout)).status).toBe("paid");
  });

  it("finds the successful retry of a declined checkout whose callback was lost", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await r.open();
    await deliver(r, checkout, "failure");
    expect((await reload(r, checkout)).status).toBe("failed");
    r.provider.simulateCallback(checkout, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, paid: 1 });
    expect((await reload(r, checkout)).status).toBe("paid");
    expect(await r.periodEnd()).not.toBe(before);
    expect(await r.payments()).toBe(1);
  });

  it("keeps asking about a declined checkout without touching it, and stops once the expiry threshold passes", async () => {
    const r = await rig();
    const checkout = await r.open();
    await deliver(r, checkout, "failure");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 1, alreadySettled: 1, declined: 0, expired: 0 });
    expect((await reload(r, checkout)).failureReason).toBe("DECLINED");

    r.advance(SWEEP_EXPIRE_AFTER_MS);
    expect(await r.service.sweepPending()).toMatchObject({ examined: 0 });
  });

  it("stops at its time budget and reports what it left for the next pass", async () => {
    let r!: Rig;
    r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async (request) => {
        r.advance(8_000);
        return provider.inquireTransaction(request);
      },
    }));
    for (const code of ["shop1", "shop2", "shop3", "shop4", "shop5"]) {
      await addTenant(r.platform, code);
      const opened = await r.open(`t-${code}`);
      r.provider.simulateCallback(opened, "success");
      r.advance(1000);
    }
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    expect(await r.service.sweepPending({ budgetMs: 20_000 })).toMatchObject({ examined: 3, paid: 3, deferred: 2 });
    expect(await r.service.sweepPending()).toMatchObject({ examined: 2, paid: 2, deferred: 0 });
  });

  it("says whether a pass is running", async () => {
    const r = await rig();
    expect(r.service.sweepRunning()).toBe(false);
    const pass = r.service.sweepPending();
    expect(r.service.sweepRunning()).toBe(true);
    await pass;
    expect(r.service.sweepRunning()).toBe(false);
  });

  it("stops asking a provider that keeps failing and leaves the rest of the batch untouched", async () => {
    let inquiries = 0;
    const r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async () => {
        inquiries += 1;
        return { status: ProviderInquiryStatus.Unavailable, reason: "Paymob refused the API key" };
      },
    }));
    for (const code of ["shop1", "shop2", "shop3", "shop4", "shop5"]) {
      await addTenant(r.platform, code);
      await r.open(`t-${code}`);
    }
    r.advance(SWEEP_EXPIRE_AFTER_MS * 2);

    expect(await r.service.sweepPending()).toMatchObject({ examined: 5, unavailable: 5, expired: 0, paid: 0 });
    expect(inquiries).toBe(3);
  });

  it("runs one pass at a time", async () => {
    let inquiries = 0;
    const r = await rig((provider) => ({
      ...provider,
      inquireTransaction: async (request) => {
        inquiries += 1;
        return provider.inquireTransaction(request);
      },
    }));
    const checkout = await r.open();
    r.provider.simulateCallback(checkout, "success");
    r.advance(SWEEP_PENDING_AFTER_MS + MINUTE);

    const [first, second] = await Promise.all([r.service.sweepPending(), r.service.sweepPending()]);

    expect(second).toBe(first);
    expect(inquiries).toBe(1);
  });
});

describe("card checkout — applying an unapplied payment by hand", () => {
  async function unapplied(r: Rig): Promise<CardCheckout> {
    const checkout = await r.open();
    await deliver(r, { ...checkout, amount: Money.fromMajor("1.00") });
    return reload(r, checkout);
  }
  const apply = (r: Rig, checkout: CardCheckout, overrides: Partial<Parameters<CardCheckoutService["applyUnapplied"]>[0]> = {}) =>
    r.service.applyUnapplied({
      tenantId: "t-acme", checkoutId: checkout.id, overrideAmount: false, reason: "راجعت لوحة بيموب", actorId: "PU-OWNER", ...overrides,
    });
  const appliedEvent = async (r: Rig) =>
    (await r.platform.audit.query("security", 200)).find((event) => event.action === "CARD_PAYMENT_APPLIED_MANUALLY");

  it("keeps the amount the provider collected on the unapplied checkout", async () => {
    const r = await rig();
    const checkout = await unapplied(r);

    expect(checkout.capturedAmount?.equals(Money.fromMajor("1.00"))).toBe(true);
    expect(checkout.amount.equals(Money.fromMajor("1.00"))).toBe(false);
  });

  it("refuses an amount other than the one the provider collected unless the override is confirmed", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await unapplied(r);

    await expect(apply(r, checkout, { amount: Money.fromMajor("490.50") })).rejects.toMatchObject({
      code: "CARD_PAYMENT_NOT_APPLICABLE",
      messageEn: expect.stringContaining("is not what the provider collected (1.000000)"),
    });
    expect(await r.periodEnd()).toBe(before);
    expect(await r.payments()).toBe(0);
  });

  it("records an overridden amount when the override is confirmed, and audits it as an override", async () => {
    const r = await rig();
    const checkout = await unapplied(r);

    const result = await apply(r, checkout, { amount: Money.fromMajor("490.50"), overrideAmount: true });

    expect(result.payment.amount.equals(Money.fromMajor("490.50"))).toBe(true);
    expect((await appliedEvent(r))?.details).toMatchObject({ amount: "490.500000", captured: "1.000000", amountOverridden: true });
  });

  it("demands an explicit amount and override for a checkout that carries no collected amount", async () => {
    const r = await rig();
    const checkout = await unapplied(r);
    r.platform.stores.sqlite.prepare("UPDATE card_checkout SET captured_amount = NULL WHERE id = ?").run(checkout.id);

    await expect(apply(r, checkout)).rejects.toBeInstanceOf(CardPaymentNotApplicableError);
    await expect(apply(r, checkout, { amount: Money.fromMajor("1.00") })).rejects.toBeInstanceOf(CardPaymentNotApplicableError);
    const result = await apply(r, checkout, { amount: Money.fromMajor("1.00"), overrideAmount: true });

    expect(result.checkout.status).toBe("paid");
    expect((await appliedEvent(r))?.details).toMatchObject({ captured: null, amountOverridden: true });
  });

  it("renews, records the amount the provider collected, and audits who applied it and why", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await unapplied(r);

    const result = await apply(r, checkout);

    expect(result.checkout.status).toBe("paid");
    expect(result.checkout.providerRef).toBe(checkout.providerRef);
    expect(result.payment.amount.equals(Money.fromMajor("1.00"))).toBe(true);
    expect(result.payment.reference).toBe(`PAYMOB-${checkout.providerRef}`);
    expect(result.payment.recordedBy).toBe("PU-OWNER");
    expect(await r.periodEnd()).not.toBe(before);
    expect(r.invalidated).toEqual(["acme"]);
    const applied = await appliedEvent(r);
    expect(applied?.actor).toBe("PU-OWNER");
    expect(applied?.details).toMatchObject({
      checkoutId: checkout.id, reason: "راجعت لوحة بيموب", was: "AMOUNT_MISMATCH", captured: "1.000000", amountOverridden: false,
    });
  });

  it("refuses a second application of the same checkout", async () => {
    const r = await rig();
    const checkout = await unapplied(r);
    await apply(r, checkout);
    const afterFirst = await r.periodEnd();

    await expect(apply(r, checkout)).rejects.toBeInstanceOf(CardPaymentNotApplicableError);
    expect(await r.periodEnd()).toBe(afterFirst);
    expect(await r.payments()).toBe(1);
  });

  it("refuses a checkout that is not unapplied", async () => {
    const r = await rig();
    const checkout = await r.open();
    await deliver(r, checkout, "failure");

    await expect(apply(r, await reload(r, checkout))).rejects.toMatchObject({
      code: "CARD_PAYMENT_NOT_APPLICABLE",
      messageEn: expect.stringContaining('"failed" is not unapplied'),
    });
    expect(await r.payments()).toBe(0);
  });

  it("refuses another tenant's checkout", async () => {
    const r = await rig();
    await addTenant(r.platform, "beta");
    const checkout = await unapplied(r);

    await expect(apply(r, checkout, { tenantId: "t-beta" })).rejects.toBeInstanceOf(CardPaymentNotApplicableError);
    expect((await reload(r, checkout)).status).toBe("unapplied");
  });

  it("refuses an empty reason", async () => {
    const r = await rig();
    const checkout = await unapplied(r);
    await expect(apply(r, checkout, { reason: "   " })).rejects.toBeInstanceOf(CardPaymentNotApplicableError);
  });

  it("applies nothing when the audit event cannot be written", async () => {
    const r = await rig();
    const before = await r.periodEnd();
    const checkout = await unapplied(r);
    const realAppend = r.platform.audit.append.bind(r.platform.audit);
    r.platform.audit.append = async (event) => {
      if (event.action === "CARD_PAYMENT_APPLIED_MANUALLY") throw new Error("audit sink unavailable");
      await realAppend(event);
    };

    await expect(apply(r, checkout)).rejects.toThrow("audit sink unavailable");

    expect((await reload(r, checkout)).status).toBe("unapplied");
    expect(await r.periodEnd()).toBe(before);
    expect(await r.payments()).toBe(0);
  });
});
