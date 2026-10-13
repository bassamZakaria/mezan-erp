import { describe, expect, it } from "vitest";
import { ProviderInquiryStatus } from "@mezan/domain";
import { PAYMOB_NOT_FOUND_SHAPES, readPaymobInquiryAnswer } from "./paymob-inquiry.js";

const API_KEY = process.env.MEZAN_PAYMOB_SANDBOX_API_KEY ?? "";
const BASE = (process.env.MEZAN_PAYMOB_SANDBOX_BASE_URL ?? "https://accept.paymob.com").replace(/\/+$/, "");
const INTEGRATION_ID = Number(process.env.MEZAN_PAYMOB_SANDBOX_INTEGRATION_ID ?? "0");
const PAID_ORDER_ID = process.env.MEZAN_PAYMOB_SANDBOX_PAID_ORDER_ID ?? "";
const AN_ORDER_THAT_CANNOT_EXIST = "1";
const TIMEOUT_MS = 20_000;

async function token(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/tokens`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: API_KEY }), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error(`Paymob refused the sandbox API key (HTTP ${res.status})`);
  return body.token;
}

async function inquire(orderId: string): Promise<{ status: number; body: unknown }> {
  const auth = await token();
  const res = await fetch(`${BASE}/api/ecommerce/orders/transaction_inquiry`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({ auth_token: auth, order_id: orderId }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

describe.skipIf(API_KEY === "")("Paymob's sandbox answers the inquiry the way the reader expects", () => {
  it("answers an order with no transaction in a recognised not-found shape", async () => {
    const answer = await inquire(AN_ORDER_THAT_CANNOT_EXIST);

    const recognised = PAYMOB_NOT_FOUND_SHAPES.find((shape) => shape.status === answer.status && shape.matches(answer.body));
    expect(recognised?.name, `Paymob answered HTTP ${answer.status} ${JSON.stringify(answer.body)} — add it as a fixture and a shape, or the sweep will flag every abandoned checkout`).toBeDefined();
  }, TIMEOUT_MS * 3);

  it.skipIf(PAID_ORDER_ID === "" || INTEGRATION_ID === 0)("answers a paid order with a transaction the reader accepts", async () => {
    const answer = await inquire(PAID_ORDER_ID);

    const read = readPaymobInquiryAnswer(answer.status, answer.body, [INTEGRATION_ID], { providerOrderRef: PAID_ORDER_ID, merchantRef: "" });
    expect(read.status, `Paymob answered HTTP ${answer.status} ${JSON.stringify(answer.body).slice(0, 400)}`).toBe(ProviderInquiryStatus.Found);
  }, TIMEOUT_MS * 3);
});
