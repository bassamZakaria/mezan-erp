import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createFetchWebhookTransport, createHmacWebhookSigner } from "./webhook-transport.js";

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

describe("the fetch transport", () => {
  it("POSTs the body and headers it was handed, without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createFetchWebhookTransport().send(request);

    expect(result).toEqual({ statusCode: 200, errorMessage: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(request.url);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(request.body);
    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual(request.headers);
  });

  it("reports a non-2xx as a failed attempt with the status in the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    expect(await createFetchWebhookTransport().send(request)).toEqual({
      statusCode: 500,
      errorMessage: "HTTP 500",
    });
  });

  it("treats a redirect as a failure rather than following it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 302 })));
    expect(await createFetchWebhookTransport().send(request)).toEqual({
      statusCode: 302,
      errorMessage: "HTTP 302",
    });
  });

  it("accepts every 2xx, and only 2xx, as delivered", async () => {
    for (const status of [200, 201, 204, 299]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      expect((await createFetchWebhookTransport().send(request)).errorMessage).toBeNull();
    }
    for (const status of [300, 400, 401, 404, 500]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      expect((await createFetchWebhookTransport().send(request)).errorMessage).toBe(`HTTP ${status}`);
    }
  });

  it("never throws on a refused connection — it comes back as a failed attempt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    expect(await createFetchWebhookTransport().send(request)).toEqual({
      statusCode: null,
      errorMessage: "fetch failed",
    });
  });

  it("keeps the underlying cause, which is where the real reason lives", async () => {
    const error = new Error("fetch failed");
    (error as { cause?: unknown }).cause = new Error("ECONNREFUSED 127.0.0.1:9");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

    expect(await createFetchWebhookTransport().send(request)).toEqual({
      statusCode: null,
      errorMessage: "fetch failed: ECONNREFUSED 127.0.0.1:9",
    });
  });

  it("does not repeat a cause that says the same thing as its error", async () => {
    const error = new Error("boom");
    (error as { cause?: unknown }).cause = new Error("boom");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    expect((await createFetchWebhookTransport().send(request)).errorMessage).toBe("boom");
  });

  it("describes a thrown non-error rather than rendering [object Object]", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("something odd"));
    expect((await createFetchWebhookTransport().send(request)).errorMessage).toBe("something odd");
  });

  it("aborts a request that outruns its timeout and reports it as a failed attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted.")));
          }),
      ),
    );

    const result = await createFetchWebhookTransport().send({ ...request, timeoutMs: 5 });
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain("abort");
  });

  it("drains the response body so the socket goes back to the pool", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, arrayBuffer }));
    await createFetchWebhookTransport().send(request);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("still reports the status when draining the body fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200, arrayBuffer: () => Promise.reject(new Error("stream closed")) }),
    );
    expect(await createFetchWebhookTransport().send(request)).toEqual({ statusCode: 200, errorMessage: null });
  });
});
