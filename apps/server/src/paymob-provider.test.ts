import { describe, expect, it } from "vitest";
import { CardCheckoutStatus, Money, ProviderInquiryStatus, type CardCheckout, type CheckoutRequest } from "@mezan/domain";
import {
  createPaymobProvider,
  createPaymobTestProvider,
  PaymentProviderError,
  paymobSignature,
  type PaymobLiveConfig,
} from "./paymob-provider.js";

const config: PaymobLiveConfig = {
  baseUrl: "https://accept.paymob.test/",
  secretKey: "sk_live_secret",
  publicKey: "pk_live_public",
  hmacSecret: "hmac-secret",
  integrationIds: [158],
  apiKey: "dashboard-api-key",
};

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 574588,
    pending: false,
    amount_cents: 49050,
    success: true,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: false,
    is_3d_secure: true,
    integration_id: 158,
    has_parent_transaction: false,
    order: { id: 690898, merchant_order_id: "checkout-1" },
    created_at: "2026-03-01T10:00:00.502448",
    currency: "EGP",
    error_occured: false,
    owner: 211,
    source_data: { pan: "2346", type: "card", sub_type: "MasterCard" },
    ...overrides,
  };
}

function callback(obj: Record<string, unknown>, secret = config.hmacSecret) {
  return { rawBody: JSON.stringify({ type: "TRANSACTION", obj }), signature: paymobSignature(secret, obj) };
}

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(respond: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const checkoutRequest: CheckoutRequest = {
  checkoutId: "checkout-1",
  tenantId: "t-acme",
  subscriptionId: "sub-acme",
  amount: Money.fromMajor("490.50"),
  description: "Mezan Core (monthly)",
  customer: { email: "owner@acme.example", name: "Mona Ibrahim" },
  returnUrl: "https://app.test/back",
  notificationUrl: "https://app.test/hook",
};

describe("Paymob callback verification", () => {
  const provider = createPaymobProvider(config, fakeFetch(() => json({})).impl);

  it("accepts a callback signed with the merchant's HMAC secret and reads it as paid", async () => {
    const { rawBody, signature } = callback(transaction());
    const txn = await provider.verifyWebhook(rawBody, signature);

    expect(txn).toMatchObject({ providerRef: "574588", providerOrderRef: "690898", merchantRef: "checkout-1", currency: "EGP", outcome: "paid" });
    expect(txn?.amount.equals(Money.fromMajor("490.50"))).toBe(true);
  });

  it("accepts the same signature in upper case and with surrounding whitespace", async () => {
    const { rawBody, signature } = callback(transaction());
    expect(await provider.verifyWebhook(rawBody, ` ${signature.toUpperCase()} `)).not.toBeNull();
  });

  it("rejects a signature made with another secret", async () => {
    const { rawBody, signature } = callback(transaction(), "someone-else's-secret");
    expect(await provider.verifyWebhook(rawBody, signature)).toBeNull();
  });

  it("rejects an amount edited after signing", async () => {
    const { signature } = callback(transaction());
    const edited = JSON.stringify({ type: "TRANSACTION", obj: transaction({ amount_cents: 1 }) });
    expect(await provider.verifyWebhook(edited, signature)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["too short", "ab12"],
    ["one digit too long", "a".repeat(129)],
    ["right length but not hex", "g".repeat(128)],
  ])("rejects a signature that is %s", async (_label, signature) => {
    expect(await provider.verifyWebhook(callback(transaction()).rawBody, signature)).toBeNull();
  });

  it("rejects a signed field whose JSON type was changed without changing the signed string", async () => {
    const genuine = transaction();
    const { signature } = callback(genuine);
    const retyped = JSON.stringify({ type: "TRANSACTION", obj: { ...genuine, success: "true" } });
    expect(await provider.verifyWebhook(retyped, signature)).toBeNull();
  });

  it("rejects a correctly signed transaction from an integration that is not ours", async () => {
    const { rawBody, signature } = callback(transaction({ integration_id: 999 }));
    expect(await provider.verifyWebhook(rawBody, signature)).toBeNull();
  });

  it.each([
    ["not JSON", "{not json"],
    ["a JSON string", '"TRANSACTION"'],
    ["another callback type", JSON.stringify({ type: "TOKEN", obj: transaction() })],
    ["an array where the object belongs", JSON.stringify({ type: "TRANSACTION", obj: [transaction()] })],
  ])("rejects a body that is %s", async (_label, rawBody) => {
    expect(await provider.verifyWebhook(rawBody, "a".repeat(128))).toBeNull();
  });

  it.each([
    ["a refund", { is_refunded: true }, "not_a_payment"],
    ["a void", { is_voided: true }, "not_a_payment"],
    ["an authorisation hold", { is_auth: true }, "not_a_payment"],
    ["a child transaction", { has_parent_transaction: true }, "not_a_payment"],
    ["a pending transaction", { pending: true }, "pending"],
    ["a declined card", { success: false, error_occured: true }, "failed"],
  ])("reads %s as %s, never as paid", async (_label, overrides, outcome) => {
    const { rawBody, signature } = callback(transaction(overrides));
    expect((await provider.verifyWebhook(rawBody, signature))?.outcome).toBe(outcome);
  });

  it.each([
    ["a refunded sale", { is_refunded: true }, "refund"],
    ["a refund of a sale", { has_parent_transaction: true, is_refund: true }, "refund"],
    ["a voided sale", { is_voided: true }, "void"],
    ["a void of a sale", { has_parent_transaction: true, is_void: true }, "void"],
    ["an authorisation hold", { is_auth: true }, "other"],
    ["a capture of a hold", { has_parent_transaction: true }, "other"],
  ])("reads %s as the non-payment kind %s", async (_label, overrides, kind) => {
    const { rawBody, signature } = callback(transaction(overrides));
    expect((await provider.verifyWebhook(rawBody, signature))?.nonPayment).toBe(kind);
  });

  it("names no non-payment kind for a payment", async () => {
    const { rawBody, signature } = callback(transaction());
    expect((await provider.verifyWebhook(rawBody, signature))?.nonPayment).toBeNull();
  });
});

describe("Paymob checkout creation", () => {
  it("creates an intention with the secret key and returns the hosted checkout URL", async () => {
    const { impl, calls } = fakeFetch(() => json({ client_secret: "cs_test_1", intention_order_id: 690898 }));
    const session = await createPaymobProvider(config, impl).createCheckout(checkoutRequest);

    expect(session.providerOrderRef).toBe("690898");
    expect(session.url).toBe("https://accept.paymob.test/unifiedcheckout/?publicKey=pk_live_public&clientSecret=cs_test_1");
    expect(calls[0]?.url).toBe("https://accept.paymob.test/v1/intention/");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Token sk_live_secret");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ amount: 49050, currency: "EGP", special_reference: "checkout-1", payment_methods: [158] });
  });

  it("refuses an amount that is not a whole number of piasters before calling Paymob", async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    await expect(
      createPaymobProvider(config, impl).createCheckout({ ...checkoutRequest, amount: Money.fromScaled(1n) }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
    expect(calls).toHaveLength(0);
  });

  it("surfaces a Paymob refusal with its status and never the secret key", async () => {
    const { impl } = fakeFetch(() => new Response("invalid integration", { status: 400 }));
    const error = await createPaymobProvider(config, impl).createCheckout(checkoutRequest).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(PaymentProviderError);
    expect((error as PaymentProviderError).status).toBe(400);
    expect((error as Error).message).not.toContain("sk_live_secret");
  });

  it("fails closed when the answer carries no client secret", async () => {
    const { impl } = fakeFetch(() => json({ intention_order_id: 1 }));
    await expect(createPaymobProvider(config, impl).createCheckout(checkoutRequest)).rejects.toBeInstanceOf(PaymentProviderError);
  });
});

describe("Paymob transaction inquiry", () => {
  const request = { providerOrderRef: "690898", merchantRef: "checkout-1" };
  const isAuth = (call: Call) => call.url.endsWith("/api/auth/tokens");

  function inquiring(answer: (call: Call, index: number) => Response | Promise<Response>, overrides: Partial<PaymobLiveConfig> = {}, now = () => 0) {
    const fetched = fakeFetch((call, index) => (isAuth(call) ? json({ token: "bearer-1" }) : answer(call, index)));
    return { provider: createPaymobProvider({ ...config, ...overrides }, fetched.impl, now), calls: fetched.calls };
  }

  it("authenticates with the API key, then asks for the order's transaction with the bearer token", async () => {
    const { provider, calls } = inquiring(() => json(transaction()));

    const inquiry = await provider.inquireTransaction(request);

    expect(inquiry).toMatchObject({ status: ProviderInquiryStatus.Found, transaction: { providerRef: "574588", outcome: "paid" } });
    expect(calls.map((call) => call.url)).toEqual([
      "https://accept.paymob.test/api/auth/tokens",
      "https://accept.paymob.test/api/ecommerce/orders/transaction_inquiry",
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ api_key: "dashboard-api-key" });
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe("Bearer bearer-1");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ order_id: "690898" });
  });

  it("reuses one token across inquiries until it nears expiry", async () => {
    let clock = 0;
    const { provider, calls } = inquiring(() => json(transaction()), {}, () => clock);

    await provider.inquireTransaction(request);
    await provider.inquireTransaction(request);
    expect(calls.filter(isAuth)).toHaveLength(1);

    clock = 51 * 60_000;
    await provider.inquireTransaction(request);
    expect(calls.filter(isAuth)).toHaveLength(2);
  });

  it("fetches a fresh token once when Paymob answers 401, then gives up rather than loop", async () => {
    const { provider, calls } = inquiring(() => new Response("", { status: 401 }));

    const inquiry = await provider.inquireTransaction(request);

    expect(inquiry).toEqual({ status: ProviderInquiryStatus.Unavailable, reason: "HTTP 401" });
    expect(calls.filter(isAuth)).toHaveLength(2);
    expect(calls).toHaveLength(4);
  });

  it("reports unavailable without calling Paymob when no API key is configured", async () => {
    const fetched = fakeFetch(() => json(transaction()));
    const { apiKey: _apiKey, ...withoutKey } = config;
    const provider = createPaymobProvider(withoutKey, fetched.impl);

    expect((await provider.inquireTransaction(request)).status).toBe(ProviderInquiryStatus.Unavailable);
    expect(fetched.calls).toHaveLength(0);
  });

  it("reads Paymob's own not-found answer as no transaction for the order", async () => {
    const { provider } = inquiring(() => json({ detail: "Not found." }, 404));
    expect(await provider.inquireTransaction(request)).toEqual({ status: ProviderInquiryStatus.None });
  });

  it.each([
    ["a gateway's HTML page", () => new Response("<html><body>404 Not Found</body></html>", { status: 404, headers: { "content-type": "text/html" } })],
    ["an empty body", () => new Response(null, { status: 404 })],
    ["another service's JSON", () => json({ message: "not found" }, 404)],
    ["a route that no longer exists", () => json({ detail: "The requested URL was not found on this server." }, 404)],
    ["a list", () => json([{ detail: "Not found." }], 404)],
  ])("does not read a 404 that is %s as no transaction — it cannot say the order was never paid", async (_name, answer) => {
    const { provider } = inquiring(answer);

    const inquiry = await provider.inquireTransaction(request);

    expect(inquiry.status).toBe(ProviderInquiryStatus.Unavailable);
  });

  it.each([
    ["an empty object", () => json({})],
    ["an error carried in a 200 body", () => json({ detail: "no transactions", message: "error" })],
    ["a transaction wrapped in an envelope", () => json({ obj: transaction() })],
    ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
    ["a JSON array", () => json([transaction()])],
    ["a transaction missing its signed fields", () => json({ id: 574588 })],
    ["a transaction that belongs to another order", () => json(transaction({ order: { id: 111, merchant_order_id: "checkout-1" } }))],
    ["a transaction from an integration that is not ours", () => json(transaction({ integration_id: 999 }))],
    ["a 400 for this order", () => json({ message: "bad order" }, 400)],
    ["a 422 for this order", () => new Response("", { status: 422 })],
  ])("reads %s as unreadable for this order — never as no transaction, never as an outage", async (_label, answer) => {
    const { provider } = inquiring(answer);
    expect((await provider.inquireTransaction(request)).status).toBe(ProviderInquiryStatus.Unreadable);
  });

  it.each([
    ["a server error", () => new Response("upstream down", { status: 502 })],
    ["a rate limit", () => new Response("", { status: 429 })],
    ["a forbidden token", () => new Response("", { status: 403 })],
    ["a request timeout", () => new Response("", { status: 408 })],
  ])("reads %s as the provider being unavailable", async (_label, answer) => {
    const { provider } = inquiring(answer);
    expect((await provider.inquireTransaction(request)).status).toBe(ProviderInquiryStatus.Unavailable);
  });

  it("reports unavailable when the API key is refused or the token is missing from the answer", async () => {
    const refused = fakeFetch(() => new Response("", { status: 403 }));
    const tokenless = fakeFetch(() => json({ profile: {} }));

    expect((await createPaymobProvider(config, refused.impl).inquireTransaction(request)).status).toBe(ProviderInquiryStatus.Unavailable);
    expect((await createPaymobProvider(config, tokenless.impl).inquireTransaction(request)).status).toBe(ProviderInquiryStatus.Unavailable);
    expect(tokenless.calls).toHaveLength(1);
  });

  it("reports unavailable, without leaking the key or token, when the network fails", async () => {
    const fetched = fakeFetch((call) => {
      if (isAuth(call)) return json({ token: "bearer-1" });
      throw new TypeError("fetch failed: bearer-1 dashboard-api-key");
    });
    const inquiry = await createPaymobProvider(config, fetched.impl).inquireTransaction(request);

    expect(inquiry).toEqual({ status: ProviderInquiryStatus.Unavailable, reason: "TypeError" });
  });
});

describe("the Paymob test double", () => {
  const checkout: CardCheckout = {
    id: "checkout-1", tenantId: "t-acme", subscriptionId: "sub-acme", provider: "paymob-test", amount: Money.fromMajor("490.50"),
    currency: "EGP", status: CardCheckoutStatus.Pending, providerOrderRef: "424242", checkoutUrl: "/billing/test-checkout/checkout-1", providerRef: null,
    paymentId: null, failureReason: null, capturedAmount: null, requestedBy: "tester", attentionCause: null, resolution: null, resolvedAt: null,
    resolvedBy: null, resolutionReason: null, createdAt: "2026-03-01T10:00:00.000Z", updatedAt: "2026-03-01T10:00:00.000Z",
  };
  const request = { providerOrderRef: "424242", merchantRef: "checkout-1" };

  it("signs callbacks that pass its own verification and no other instance's", async () => {
    const provider = createPaymobTestProvider();
    const { rawBody, signature } = provider.simulateCallback(checkout, "success");

    expect((await provider.verifyWebhook(rawBody, signature))?.outcome).toBe("paid");
    expect(await createPaymobTestProvider().verifyWebhook(rawBody, signature)).toBeNull();
  });

  it("answers an inquiry from what it has simulated: nothing, then the latest transaction", async () => {
    const provider = createPaymobTestProvider();
    expect(await provider.inquireTransaction(request)).toEqual({ status: ProviderInquiryStatus.None });

    provider.simulateCallback(checkout, "failure");
    expect(await provider.inquireTransaction(request)).toMatchObject({ status: ProviderInquiryStatus.Found, transaction: { outcome: "failed" } });

    provider.simulateCallback(checkout, "success");
    expect(await provider.inquireTransaction(request)).toMatchObject({
      status: ProviderInquiryStatus.Found,
      transaction: { outcome: "paid", merchantRef: "checkout-1", providerOrderRef: "424242" },
    });
  });
});
