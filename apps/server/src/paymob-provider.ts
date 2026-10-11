import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  hasPaymobSignedShape,
  moneyToPaymobCents,
  parsePaymobTransaction,
  paymobTransactionHmacMessage,
  ProviderInquiryStatus,
  type CardCheckout,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type ProviderInquiry,
  type ProviderInquiryRequest,
  type PaymobTransactionObject,
  type VerifiedProviderTransaction,
} from "@mezan/domain";

export interface PaymobLiveConfig {
  readonly baseUrl: string;
  readonly secretKey: string;
  readonly publicKey: string;
  readonly hmacSecret: string;
  readonly integrationIds: readonly number[];
  readonly apiKey?: string;
}

export class PaymentProviderError extends Error {
  readonly code = "PAYMENT_PROVIDER_ERROR";
  constructor(readonly status: number | null, detail: string) {
    super(`Paymob intention request failed${status === null ? "" : ` (HTTP ${status})`}: ${detail}`);
    this.name = "PaymentProviderError";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
// Paymob documents a 60-minute token; refreshing early keeps a sweep from
// starting on a token that dies half-way through it.
const AUTH_TOKEN_TTL_MS = 50 * 60_000;

function unavailable(reason: string): ProviderInquiry {
  return { status: ProviderInquiryStatus.Unavailable, reason };
}

function unreadable(reason: string): ProviderInquiry {
  return { status: ProviderInquiryStatus.Unreadable, reason };
}

function asTransactionObject(body: unknown): PaymobTransactionObject | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return body as PaymobTransactionObject;
}

/**
 * The inquiry answer carries no HMAC, so what makes it trustworthy is where it
 * came from (TLS to the configured host, our own bearer token) plus the same
 * shape, integration and order checks a callback passes. Anything short of a
 * transaction that passes them all is `Unreadable` — never "no transaction":
 * Paymob does not document what an empty answer looks like, and guessing would
 * expire a checkout whose money was taken.
 */
function readInquiredTransaction(
  body: unknown,
  integrationIds: readonly number[],
  request: ProviderInquiryRequest,
): ProviderInquiry {
  const transaction = asTransactionObject(body);
  if (!transaction) return unreadable("the inquiry answer is not a JSON object");
  if (!hasPaymobSignedShape(transaction)) return unreadable("the inquiry answer is not a transaction");
  const parsed = parsePaymobTransaction(transaction);
  if (!parsed) return unreadable("the inquiry answer could not be read");
  if (parsed.providerOrderRef !== request.providerOrderRef) return unreadable("the inquiry answered for another order");
  if (!integrationIds.includes(parsed.integrationId)) return unreadable("the transaction belongs to another integration");
  return { status: ProviderInquiryStatus.Found, transaction: parsed };
}

const HTTP_NOT_FOUND = 404;
// These say something about us or about Paymob, not about the order asked for.
const PROVIDER_WIDE_STATUSES: ReadonlySet<number> = new Set([401, 403, 408, 429]);
// EXTERNAL CONTRACT: Paymob's API answers a resource it does not hold with
// 404 and `{"detail": "Not found."}`. Only that says "no transaction was ever
// made on this order". A 404 from anything else on the way — a gateway, a
// moved route, a wrong base URL — says nothing about the order, and reading it
// as "none" lets the sweep expire a checkout the customer may have paid.
const PAYMOB_NOT_FOUND_DETAIL = /^not found\.?$/i;

function isPaymobNotFound(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const detail = (body as { detail?: unknown }).detail;
  return typeof detail === "string" && PAYMOB_NOT_FOUND_DETAIL.test(detail.trim());
}

async function readInquiryResponse(response: Response): Promise<ProviderInquiry | null> {
  const status = response.status;
  if (status === HTTP_NOT_FOUND) {
    const body: unknown = await response.json().catch(() => undefined);
    return isPaymobNotFound(body) ? { status: ProviderInquiryStatus.None } : unavailable("HTTP 404 that is not Paymob's own not-found answer");
  }
  if (status >= 500 || PROVIDER_WIDE_STATUSES.has(status)) return unavailable(`HTTP ${status}`);
  if (status < 200 || status >= 300) return unreadable(`HTTP ${status}`);
  return null;
}

interface PaymobInquiryClient {
  inquire(request: ProviderInquiryRequest): Promise<ProviderInquiry>;
}

function createPaymobInquiryClient(config: PaymobLiveConfig, base: string, fetchImpl: typeof fetch, now: () => number): PaymobInquiryClient {
  let cached: { readonly token: string; readonly expiresAt: number } | null = null;

  async function authToken(apiKey: string): Promise<string | null> {
    if (cached && cached.expiresAt > now()) return cached.token;
    const response = await fetchImpl(`${base}/api/auth/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string" || body.token === "") return null;
    cached = { token: body.token, expiresAt: now() + AUTH_TOKEN_TTL_MS };
    return cached.token;
  }

  function ask(token: string, request: ProviderInquiryRequest): Promise<Response> {
    return fetchImpl(`${base}/api/ecommerce/orders/transaction_inquiry`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ order_id: request.providerOrderRef }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function inquire(request: ProviderInquiryRequest): Promise<ProviderInquiry> {
    if (!config.apiKey) return unavailable("MEZAN_PAYMOB_API_KEY is not set");
    try {
      let token = await authToken(config.apiKey);
      if (!token) return unavailable("Paymob refused the API key");
      let response = await ask(token, request);
      if (response.status === 401) {
        cached = null;
        token = await authToken(config.apiKey);
        if (!token) return unavailable("Paymob refused the API key");
        response = await ask(token, request);
      }
      const refused = await readInquiryResponse(response);
      if (refused) return refused;
      const body: unknown = await response.json().catch(() => undefined);
      return readInquiredTransaction(body, config.integrationIds, request);
    } catch (err) {
      return unavailable(err instanceof Error ? err.name : "network error");
    }
  }

  return { inquire };
}

const HEX_SHA512 = /^[0-9a-f]{128}$/;

export function paymobSignature(hmacSecret: string, obj: PaymobTransactionObject): string {
  return createHmac("sha512", hmacSecret).update(paymobTransactionHmacMessage(obj), "utf8").digest("hex");
}

function signatureMatches(expectedHex: string, providedRaw: string): boolean {
  const provided = providedRaw.trim().toLowerCase();
  if (!HEX_SHA512.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(provided, "hex"));
}

function verifyPaymobCallback(
  hmacSecret: string,
  integrationIds: readonly number[],
  rawBody: string,
  signature: string,
): VerifiedProviderTransaction | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const { type, obj } = body as { type?: unknown; obj?: unknown };
  if (type !== "TRANSACTION" || obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const transaction = obj as PaymobTransactionObject;
  if (!hasPaymobSignedShape(transaction)) return null;
  if (!signatureMatches(paymobSignature(hmacSecret, transaction), signature)) return null;
  const parsed = parsePaymobTransaction(transaction);
  if (!parsed || !integrationIds.includes(parsed.integrationId)) return null;
  return parsed;
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "NA", last: "NA" };
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

function centsOf(request: CheckoutRequest): number {
  const cents = moneyToPaymobCents(request.amount);
  if (cents === null || cents <= 0) throw new PaymentProviderError(null, "amount is not a positive whole number of piasters");
  return cents;
}

export function createPaymobProvider(
  config: PaymobLiveConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): PaymentProvider {
  const base = config.baseUrl.replace(/\/+$/, "");
  const inquiry = createPaymobInquiryClient(config, base, fetchImpl, now);
  return {
    id: "paymob",
    testMode: false,
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
      const cents = centsOf(request);
      const { first, last } = splitName(request.customer.name);
      let response: Response;
      try {
        response = await fetchImpl(`${base}/v1/intention/`, {
          method: "POST",
          headers: { authorization: `Token ${config.secretKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            amount: cents,
            currency: "EGP",
            payment_methods: [...config.integrationIds],
            items: [{ name: request.description.slice(0, 50), amount: cents, description: request.description, quantity: 1 }],
            billing_data: {
              first_name: first,
              last_name: last,
              email: request.customer.email,
              phone_number: "NA",
              apartment: "NA",
              floor: "NA",
              street: "NA",
              building: "NA",
              city: "NA",
              state: "NA",
              country: "EGY",
            },
            special_reference: request.checkoutId,
            notification_url: request.notificationUrl,
            redirection_url: request.returnUrl,
            extras: { tenant_id: request.tenantId, subscription_id: request.subscriptionId, checkout_id: request.checkoutId },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new PaymentProviderError(null, err instanceof Error ? err.name : "network error");
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new PaymentProviderError(response.status, detail);
      }
      const body = (await response.json().catch(() => null)) as { client_secret?: unknown; intention_order_id?: unknown } | null;
      const clientSecret = body?.client_secret;
      const orderId = body?.intention_order_id;
      if (typeof clientSecret !== "string" || clientSecret === "" || (typeof orderId !== "number" && typeof orderId !== "string")) {
        throw new PaymentProviderError(response.status, "response carried no client_secret / intention_order_id");
      }
      const url = `${base}/unifiedcheckout/?publicKey=${encodeURIComponent(config.publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
      return { url, providerOrderRef: String(orderId) };
    },
    async verifyWebhook(rawBody, signature) {
      return verifyPaymobCallback(config.hmacSecret, config.integrationIds, rawBody, signature);
    },
    inquireTransaction: (request) => inquiry.inquire(request),
  };
}

const TEST_INTEGRATION_ID = 1;

export interface PaymobTestProvider extends PaymentProvider {
  readonly testMode: true;
  /** Builds the callback Paymob would POST for this checkout, signed with this process's test secret. */
  simulateCallback(checkout: CardCheckout, outcome: "success" | "failure"): { readonly rawBody: string; readonly signature: string };
  returnUrlFor(checkoutId: string): string | null;
}

/**
 * The no-credentials stand-in: intentions are minted locally, the checkout URL
 * is the server's own clearly-labelled test page, and callbacks are signed with
 * a per-process secret through the same HMAC verification a live callback takes.
 */
export function createPaymobTestProvider(): PaymobTestProvider {
  const hmacSecret = randomBytes(32).toString("hex");
  let nextTransaction = randomInt(100_000_000, 900_000_000);
  const returnUrls = new Map<string, string>();
  const latestByOrder = new Map<string, PaymobTransactionObject>();
  return {
    id: "paymob-test",
    testMode: true,
    async createCheckout(request) {
      centsOf(request);
      returnUrls.set(request.checkoutId, request.returnUrl);
      return {
        url: `/billing/test-checkout/${encodeURIComponent(request.checkoutId)}`,
        providerOrderRef: String(randomInt(100_000_000, 900_000_000)),
      };
    },
    async verifyWebhook(rawBody, signature) {
      return verifyPaymobCallback(hmacSecret, [TEST_INTEGRATION_ID], rawBody, signature);
    },
    async inquireTransaction(request) {
      const latest = latestByOrder.get(request.providerOrderRef);
      if (!latest) return { status: ProviderInquiryStatus.None };
      return readInquiredTransaction(latest, [TEST_INTEGRATION_ID], request);
    },
    returnUrlFor(checkoutId) {
      return returnUrls.get(checkoutId) ?? null;
    },
    simulateCallback(checkout, outcome) {
      if (!checkout.providerOrderRef) throw new Error("test checkout has no provider order");
      const success = outcome === "success";
      nextTransaction += 1;
      const obj = {
        id: nextTransaction,
        pending: false,
        amount_cents: moneyToPaymobCents(checkout.amount),
        success,
        is_auth: false,
        is_capture: false,
        is_standalone_payment: true,
        is_voided: false,
        is_refunded: false,
        is_3d_secure: true,
        integration_id: TEST_INTEGRATION_ID,
        has_parent_transaction: false,
        order: { id: Number(checkout.providerOrderRef), merchant_order_id: checkout.id },
        created_at: new Date().toISOString().replace("Z", ""),
        currency: checkout.currency,
        error_occured: !success,
        owner: 1,
        source_data: { pan: success ? "2346" : "0002", type: "card", sub_type: "MasterCard" },
      };
      latestByOrder.set(checkout.providerOrderRef, obj);
      return { rawBody: JSON.stringify({ type: "TRANSACTION", obj }), signature: paymobSignature(hmacSecret, obj) };
    },
  };
}
