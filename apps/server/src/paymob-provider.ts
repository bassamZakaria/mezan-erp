import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  moneyToPaymobCents,
  parsePaymobTransaction,
  paymobTransactionHmacMessage,
  type CardCheckout,
  type CheckoutRequest,
  type CheckoutSession,
  type PaymentProvider,
  type PaymobTransactionObject,
  type VerifiedProviderTransaction,
} from "@mezan/domain";

export interface PaymobLiveConfig {
  readonly baseUrl: string;
  readonly secretKey: string;
  readonly publicKey: string;
  readonly hmacSecret: string;
  readonly integrationIds: readonly number[];
}

export class PaymentProviderError extends Error {
  readonly code = "PAYMENT_PROVIDER_ERROR";
  constructor(readonly status: number | null, detail: string) {
    super(`Paymob intention request failed${status === null ? "" : ` (HTTP ${status})`}: ${detail}`);
    this.name = "PaymentProviderError";
  }
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

function verifyPaymobCallback(hmacSecret: string, rawBody: string, signature: string): VerifiedProviderTransaction | null {
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
  if (!signatureMatches(paymobSignature(hmacSecret, transaction), signature)) return null;
  return parsePaymobTransaction(transaction);
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

export function createPaymobProvider(config: PaymobLiveConfig, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const base = config.baseUrl.replace(/\/+$/, "");
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
          signal: AbortSignal.timeout(15_000),
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
      return verifyPaymobCallback(config.hmacSecret, rawBody, signature);
    },
  };
}

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
      return verifyPaymobCallback(hmacSecret, rawBody, signature);
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
        integration_id: 0,
        has_parent_transaction: false,
        order: { id: Number(checkout.providerOrderRef), merchant_order_id: checkout.id },
        created_at: new Date().toISOString().replace("Z", ""),
        currency: checkout.currency,
        error_occured: !success,
        owner: 0,
        source_data: { pan: success ? "2346" : "0002", type: "card", sub_type: "MasterCard" },
      };
      return { rawBody: JSON.stringify({ type: "TRANSACTION", obj }), signature: paymobSignature(hmacSecret, obj) };
    },
  };
}
