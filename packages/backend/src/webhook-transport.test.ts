import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createFetchWebhookTransport, createHmacWebhookSigner, type PinnedDestination, type WebhookDialer } from "./webhook-transport.js";

const request = {
  // A literal PUBLIC address, not a hostname. Since S10 the transport resolves
  // the destination before fetching and refuses anything internal, so a name
  // that does not resolve (`hook.example`) is now rejected before `fetch` is
  // ever reached — these tests would be asserting the DNS failure rather than
  // the transport. An IP literal skips the lookup entirely.
  url: "https://93.184.216.34/mezan",
  headers: { "content-type": "application/json", "x-mezan-signature": "sig" },
  body: '{"event":"invoice.confirmed"}',
  timeoutMs: 5_000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the HMAC signer", () => {
  it("signs exactly as HMAC-SHA256 over the payload, in hex", () => {
    const signer = createHmacWebhookSigner();
    const expected = createHmac("sha256", "s3cret").update("payload", "utf8").digest("hex");
    expect(signer.sign("s3cret", "payload")).toBe(expected);
    expect(signer.sign("s3cret", "payload")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives a different signature for a different secret and for a different payload", () => {
    const signer = createHmacWebhookSigner();
    const base = signer.sign("s3cret", "payload");
    expect(signer.sign("other", "payload")).not.toBe(base);
    expect(signer.sign("s3cret", "payload ")).not.toBe(base);
  });

  it("signs an Arabic payload by its UTF-8 bytes", () => {
    const signer = createHmacWebhookSigner();
    const arabic = '{"memo":"فاتورة مبيعات"}';
    expect(signer.sign("s3cret", arabic)).toBe(createHmac("sha256", "s3cret").update(arabic, "utf8").digest("hex"));
  });
});

describe("the pinned-socket transport", () => {
  /**
   * These used to stub global `fetch`, which could not see the ONE fact the
   * DNS-rebinding fix turns on: which address the connection actually goes to.
   * `fetch` cannot be told, which is why the transport no longer uses it. The
   * dialer seam takes the already-vetted destination, so a test can stand in
   * for the socket without being able to skip the destination check.
   */
  function dialerReturning(status: number) {
    return vi.fn<WebhookDialer>(async () => status);
  }

  it("POSTs the body and headers it was handed, to the address it vetted", async () => {
    const dial = dialerReturning(200);
    const result = await createFetchWebhookTransport(dial).send(request);

    expect(result).toEqual({ statusCode: 200, errorMessage: null });
    const [sent, pinned, timeoutMs] = dial.mock.calls[0] as [typeof request, PinnedDestination, number];
    expect(sent.body).toBe(request.body);
    expect(sent.headers).toEqual(request.headers);
    // The literal it was given, carried through to the connection — not a name
    // for the socket to resolve a second time.
    expect(pinned.address).toBe("93.184.216.34");
    expect(pinned.url.href).toBe(request.url);
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(request.timeoutMs);
  });

  it("reports a non-2xx as a failed attempt with the status in the message", async () => {
    expect(await createFetchWebhookTransport(dialerReturning(500)).send(request)).toEqual({
      statusCode: 500,
      errorMessage: "HTTP 500",
    });
  });

  it("treats a redirect as a failure rather than following it", async () => {
    // The other half of SSRF: a public destination answering `302
    // http://192.168.1.1/`. The transport never follows one — a redirect is
    // reported as the status it is.
    expect(await createFetchWebhookTransport(dialerReturning(302)).send(request)).toEqual({
      statusCode: 302,
      errorMessage: "HTTP 302",
    });
  });

  it("accepts every 2xx, and only 2xx, as delivered", async () => {
    for (const status of [200, 201, 204, 299]) {
      expect((await createFetchWebhookTransport(dialerReturning(status)).send(request)).errorMessage).toBeNull();
    }
    for (const status of [300, 400, 401, 404, 500]) {
      expect((await createFetchWebhookTransport(dialerReturning(status)).send(request)).errorMessage).toBe(`HTTP ${status}`);
    }
  });

  it("never throws on a refused connection — it comes back as a failed attempt", async () => {
    const dial = vi.fn<WebhookDialer>(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    expect(await createFetchWebhookTransport(dial).send(request)).toEqual({
      statusCode: null,
      errorMessage: "connect ECONNREFUSED",
    });
  });

  it("keeps the underlying cause, which is where the real reason lives", async () => {
    const error = new Error("request failed");
    (error as { cause?: unknown }).cause = new Error("ECONNREFUSED 127.0.0.1:9");
    const dial = vi.fn<WebhookDialer>(async () => {
      throw error;
    });
    expect(await createFetchWebhookTransport(dial).send(request)).toEqual({
      statusCode: null,
      errorMessage: "request failed: ECONNREFUSED 127.0.0.1:9",
    });
  });

  it("does not repeat a cause that says the same thing as its error", async () => {
    const error = new Error("boom");
    (error as { cause?: unknown }).cause = new Error("boom");
    const dial = vi.fn<WebhookDialer>(async () => {
      throw error;
    });
    expect((await createFetchWebhookTransport(dial).send(request)).errorMessage).toBe("boom");
  });

  it("describes a thrown non-error rather than rendering [object Object]", async () => {
    const dial = vi.fn<WebhookDialer>(async () => {
      throw "something odd";
    });
    expect((await createFetchWebhookTransport(dial).send(request)).errorMessage).toBe("something odd");
  });

  it("gives the request only what is left of the timeout after resolution", async () => {
    // The abort timer used to be armed BEFORE the DNS lookup, which ignores an
    // AbortSignal entirely, so a stalling resolver hung the dispatcher well
    // past `timeoutMs`. Resolution and request share one budget now.
    const dial = vi.fn<WebhookDialer>(async (_req, _pinned, timeoutMs) => {
      expect(timeoutMs).toBeLessThanOrEqual(5);
      throw new Error("timed out");
    });
    const result = await createFetchWebhookTransport(dial).send({ ...request, timeoutMs: 5 });
    expect(result.statusCode).toBeNull();
    expect(dial).toHaveBeenCalledTimes(1);
  });

  it("refuses an internal destination before the socket is ever reached", async () => {
    const dial = dialerReturning(200);
    const result = await createFetchWebhookTransport(dial).send({ ...request, url: "http://192.168.1.1/hook" });
    expect(result.statusCode).toBeNull();
    expect(dial).not.toHaveBeenCalled();
  });
});
