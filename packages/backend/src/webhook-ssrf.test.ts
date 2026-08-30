import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchWebhookTransport, type PinnedDestination, type WebhookDialer } from "./webhook-transport.js";

/**
 * S10 — server-side request forgery through a webhook URL.
 *
 * A webhook destination is written by a user and fetched by the machine that
 * holds the books. On a desktop install that machine sits inside the shop's
 * network and can reach what the author cannot: the router's admin page, a
 * NAS, another till, a cloud metadata endpoint. The fix is to refuse the
 * destination rather than to trust the author.
 *
 * The transport must never THROW — a blocked destination has to come back as
 * a recorded failed attempt, the same as a refused connection, or the
 * dispatcher loses the delivery instead of reporting it.
 */

/**
 * The socket, stubbed. Any real network call would make these tests slow,
 * flaky and dangerous — and stubbing HERE rather than at `fetch` is what lets
 * them assert the address the connection would have used, which is the fact
 * the DNS-rebinding fix turns on and the old `fetch` spy could not see.
 */
let dial = vi.fn<WebhookDialer>(async () => 200);
let transport = createFetchWebhookTransport((...args) => dial(...args));

afterEach(() => {
  dial = vi.fn<WebhookDialer>(async () => 200);
  transport = createFetchWebhookTransport((...args) => dial(...args));
});

function deliver(url: string) {
  return transport.send({
    url,
    headers: { "content-type": "application/json" },
    body: "{}",
    timeoutMs: 1_000,
  });
}

const INTERNAL = [
  ["loopback by name", "http://localhost/hook"],
  ["loopback by address", "http://127.0.0.1/hook"],
  ["loopback, anywhere in 127/8", "http://127.99.4.2/hook"],
  ["this host", "http://0.0.0.0/hook"],
  ["private 10/8", "http://10.0.0.5/hook"],
  ["private 172.16/12 — the low edge", "http://172.16.0.1/hook"],
  ["private 172.16/12 — the high edge", "http://172.31.255.254/hook"],
  ["private 192.168/16 — the router's admin page", "http://192.168.1.1/hook"],
  ["link-local, i.e. the cloud metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
  ["carrier-grade NAT — the low edge", "http://100.64.0.1/hook"],
  ["carrier-grade NAT — the high edge", "http://100.127.255.254/hook"],
  ["multicast", "http://239.255.255.250/hook"],
  ["IPv6 loopback", "http://[::1]/hook"],
  ["IPv6 unspecified", "http://[::]/hook"],
  ["IPv6 link-local", "http://[fe80::1]/hook"],
  ["IPv6 unique-local", "http://[fd00::1]/hook"],
  ["IPv4-mapped IPv6 loopback — the same address wearing a hat", "http://[::ffff:127.0.0.1]/hook"],
  ["IPv4-mapped IPv6 private", "http://[::ffff:192.168.1.1]/hook"],
] as const;

describe("a webhook may not be pointed inside the shop's own network (S10)", () => {
  it.each(INTERNAL)("refuses %s", async (_label, url) => {
    const result = await deliver(url);

    // Refused, and refused BEFORE the request went out. Asserting only the
    // result would pass against a transport that fetched the router and then
    // reported a failure.
    expect(dial).not.toHaveBeenCalled();
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage ?? "").not.toBe("");
  });

  it("refuses every non-http scheme, so a webhook cannot read a local file or reach a socket", async () => {
    for (const url of [
      "file:///etc/passwd",
      "file://C:/Windows/win.ini",
      "ftp://192.168.1.1/",
      "gopher://127.0.0.1:6379/_SET%20foo%20bar",
      "data:text/plain,hello",
      "javascript:alert(1)",
    ]) {
      const result = await deliver(url);
      expect(dial, url).not.toHaveBeenCalled();
      expect(result.statusCode, url).toBeNull();
    }
  });

  it("refuses a malformed URL rather than handing it to fetch", async () => {
    for (const url of ["", "not a url", "http://", "://missing-scheme"]) {
      const result = await deliver(url);
      expect(dial, url).not.toHaveBeenCalled();
      expect(result.statusCode, url).toBeNull();
    }
  });

  it("never throws — a blocked destination is a recorded failure, not a lost delivery", async () => {
    // The dispatcher's contract. If this threw, the attempt would vanish from
    // the delivery log instead of showing up as failed, and the operator
    // would never learn the webhook is misconfigured.
    await expect(deliver("http://192.168.1.1/hook")).resolves.toBeTruthy();
    await expect(deliver("file:///etc/passwd")).resolves.toBeTruthy();
  });

  it("says WHY it refused, in the operator's language", async () => {
    const internal = await deliver("http://10.0.0.5/hook");
    const scheme = await deliver("ftp://example.com/hook");

    // Two different refusals must not collapse into one opaque message; the
    // person fixing the webhook needs to know which mistake they made.
    expect(internal.errorMessage).not.toBe(scheme.errorMessage);
    expect(String(internal.errorMessage)).toContain("داخلي");
  });
});

describe("a public destination is still delivered to (the negative control)", () => {
  it("connects to a public address and returns its status", async () => {
    // Without this, every test above is satisfied by a transport that refuses
    // everything — which would silently disable the whole webhook feature.
    dial.mockResolvedValue(200);

    const result = await deliver("http://93.184.216.34/hook");

    expect(dial).toHaveBeenCalledTimes(1);
    expect(result.statusCode).toBe(200);
  });

  it("connects to the address it VETTED, not to the name it was given", async () => {
    // The rebinding fix, asserted directly. `lookup()` used to vet the
    // addresses and then `fetch` resolved the name again, independently — so
    // an author running their own authoritative DNS answered the check with a
    // public address and the connection with an internal one.
    await deliver("http://93.184.216.34/hook");

    const [, pinned] = dial.mock.calls[0] as [unknown, PinnedDestination, number];
    expect(pinned.address).toBe("93.184.216.34");
    expect(pinned.family).toBe(4);
  });

  it("reports a 302 as the 302 it is, rather than as a success", async () => {
    // A 3xx is not a delivery, and it is never followed: recording it as a
    // success would mark the webhook healthy while the payload went nowhere,
    // and following it is the other half of SSRF.
    dial.mockResolvedValue(302);

    const result = await deliver("http://93.184.216.34/hook");

    expect(result.statusCode).toBe(302);
    expect(result.errorMessage).toBe("HTTP 302");
  });

  it("still sends the body and headers it was given", async () => {
    await transport.send({
      url: "http://93.184.216.34/hook",
      headers: { "content-type": "application/json", "x-mezan-signature": "sha256=abc" },
      body: '{"event":"sales-invoice.posted"}',
      timeoutMs: 1_000,
    });

    const [sent] = dial.mock.calls[0] as [{ body: string; headers: Record<string, string> }, PinnedDestination, number];
    expect(sent.body).toBe('{"event":"sales-invoice.posted"}');
    expect(sent.headers).toMatchObject({ "x-mezan-signature": "sha256=abc" });
  });

  it("reports a network failure as a failed attempt, not as a throw", async () => {
    dial.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await deliver("http://93.184.216.34/hook");

    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toContain("ECONNREFUSED");
  });

  it("never reaches the socket for a refused destination", async () => {
    // The ordering that matters: the check runs inside send(), before the
    // connection, so every dispatcher retry re-checks rather than trusting a
    // verdict from the first attempt.
    await deliver("http://192.168.1.1/hook");
    expect(dial).not.toHaveBeenCalled();
  });
});
