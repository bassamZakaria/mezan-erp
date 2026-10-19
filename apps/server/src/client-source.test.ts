import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { cloudSource, isResolvedSource, originEnv, UNRESOLVED_SOURCE, type ClientSourceOptions, type CloudSource } from "./client-source.js";

async function sourceOf(headers: Record<string, string>, options: ClientSourceOptions, socket: string | null = "10.0.9.9"): Promise<CloudSource> {
  const app = new Hono();
  let source: CloudSource = UNRESOLVED_SOURCE;
  app.get("/", (c) => {
    source = cloudSource(c, options);
    return c.body(null, 204);
  });
  const env = socket === null ? undefined : { incoming: { socket: { remoteAddress: socket } } };
  await app.fetch(new Request("http://local/", { headers }), env);
  return source;
}

const NO_PROXY: ClientSourceOptions = { trustedProxyHops: 0 };
const ONE_PROXY: ClientSourceOptions = { trustedProxyHops: 1 };
const TWO_PROXIES: ClientSourceOptions = { trustedProxyHops: 2 };

describe("where a cloud request came from", () => {
  it("is the socket's peer when no proxy is trusted, whatever the headers claim", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5" }, NO_PROXY)).toBe("10.0.9.9");
  });

  it("is unresolved, never the host's own console, when there is no socket and no proxy is trusted", async () => {
    const source = await sourceOf({ "x-forwarded-for": "196.221.5.5" }, NO_PROXY, null);
    expect(source).toBe(UNRESOLVED_SOURCE);
    expect(isResolvedSource(source)).toBe(false);
  });

  it("is the hop the one trusted proxy appended, never a hop the client wrote ahead of it", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5, 41.33.10.10" }, ONE_PROXY)).toBe("41.33.10.10");
    expect(await sourceOf({ "x-forwarded-for": "41.33.10.10" }, ONE_PROXY)).toBe("41.33.10.10");
  });

  it("is the hop the first of two trusted proxies appended", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5, 41.33.10.10, 130.176.0.7" }, TWO_PROXIES)).toBe("41.33.10.10");
    expect(await sourceOf({ "x-forwarded-for": "41.33.10.10, 130.176.0.7" }, TWO_PROXIES)).toBe("41.33.10.10");
  });

  it("is unresolved when the chain is shorter than the proxies it was told to trust, and never the socket's peer", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5" }, TWO_PROXIES)).toBe(UNRESOLVED_SOURCE);
    expect(await sourceOf({}, ONE_PROXY)).toBe(UNRESOLVED_SOURCE);
    expect(await sourceOf({ "x-forwarded-for": "130.176.1.1" }, TWO_PROXIES, null)).toBe(UNRESOLVED_SOURCE);
  });

  it("is unresolved when the trusted hop is not an address", async () => {
    expect(await sourceOf({ "x-forwarded-for": "unknown, 130.176.0.7" }, TWO_PROXIES)).toBe(UNRESOLVED_SOURCE);
    expect(await sourceOf({ "x-forwarded-for": "_hidden, 130.176.0.7" }, TWO_PROXIES)).toBe(UNRESOLVED_SOURCE);
    expect(await sourceOf({ "x-forwarded-for": ", 130.176.0.7" }, TWO_PROXIES)).toBe(UNRESOLVED_SOURCE);
  });

  it("reads a trusted hop that carries a port or brackets", async () => {
    expect(await sourceOf({ "x-forwarded-for": "41.33.10.10:51234, 130.176.0.7" }, TWO_PROXIES)).toBe("41.33.10.10");
    expect(await sourceOf({ "x-forwarded-for": "[2001:db8::7]:51234, 130.176.0.7" }, TWO_PROXIES)).toBe(await sourceOf({ "x-forwarded-for": "2001:db8::7, 130.176.0.7" }, TWO_PROXIES));
    expect(await sourceOf({ "x-forwarded-for": "[2001:db8::7], 130.176.0.7" }, TWO_PROXIES)).not.toBe(UNRESOLVED_SOURCE);
  });

  it("names one IPv6 address one way however it was spelled", async () => {
    const short = await sourceOf({ "x-forwarded-for": "2001:db8::1, 130.176.0.7" }, TWO_PROXIES);
    const long = await sourceOf({ "x-forwarded-for": "2001:0DB8:0000:0000:0000:0000:0000:0001, 130.176.0.7" }, TWO_PROXIES);
    expect(short).toBe(long);
    expect(await sourceOf({ "x-forwarded-for": "::ffff:41.33.10.10, 130.176.0.7" }, TWO_PROXIES)).toBe("41.33.10.10");
  });

  it("hands a tenant backend the source as its request environment, the sentinel included", () => {
    expect(originEnv("41.33.10.10" as CloudSource).incoming.socket.remoteAddress).toBe("41.33.10.10");
    expect(originEnv(UNRESOLVED_SOURCE).incoming.socket.remoteAddress).toBe(UNRESOLVED_SOURCE);
  });
});

describe("a deployment that names the header its edge writes the caller's address in", () => {
  const EDGE_HEADER: ClientSourceOptions = { ...ONE_PROXY, trustedAddressHeader: "cf-connecting-ip" };

  it("counts the address in that header, not the forwarded chain", async () => {
    expect(await sourceOf({ "cf-connecting-ip": "196.221.5.5", "x-forwarded-for": "6.6.6.6, 172.70.1.1" }, EDGE_HEADER)).toBe("196.221.5.5");
    const sameAddressFromTheChain = await sourceOf({ "x-forwarded-for": "2a01:db8:5::77" }, ONE_PROXY);
    expect(isResolvedSource(sameAddressFromTheChain)).toBe(true);
    expect(await sourceOf({ "cf-connecting-ip": "2A01:DB8:5::77", "x-forwarded-for": "6.6.6.6" }, EDGE_HEADER)).toBe(sameAddressFromTheChain);
  });

  it("drops a port from the address the named header carries", async () => {
    const viewer: ClientSourceOptions = { ...TWO_PROXIES, trustedAddressHeader: "x-client-address" };
    expect(await sourceOf({ "x-client-address": "196.221.5.5:46532", "x-forwarded-for": "6.6.6.6, 130.176.1.1" }, viewer)).toBe("196.221.5.5");
    expect(await sourceOf({ "x-client-address": "[2a01:db8:5::77]:443", "x-forwarded-for": "6.6.6.6, 130.176.1.1" }, viewer))
      .toBe(await sourceOf({ "x-forwarded-for": "2a01:db8:5::77" }, ONE_PROXY));
  });

  it("is unresolved when the named header is missing, empty, a list or not an address — it never falls back to what the caller wrote", async () => {
    for (const headers of [
      { "x-forwarded-for": "196.221.5.5" },
      { "cf-connecting-ip": "", "x-forwarded-for": "196.221.5.5" },
      { "cf-connecting-ip": "196.221.5.5, 6.6.6.6", "x-forwarded-for": "196.221.5.5" },
      { "cf-connecting-ip": "localhost", "x-forwarded-for": "196.221.5.5" },
    ] as Record<string, string>[]) {
      expect(await sourceOf(headers, EDGE_HEADER), JSON.stringify(headers)).toBe(UNRESOLVED_SOURCE);
    }
  });

  it("ignores every such header the deployment did not name, with a proxy trusted or without", async () => {
    const spoofed = { "cf-connecting-ip": "6.6.6.6", "true-client-ip": "6.6.6.6", "x-real-ip": "6.6.6.6", "x-forwarded-for": "196.221.5.5" };
    expect(await sourceOf(spoofed, ONE_PROXY)).toBe("196.221.5.5");
    expect(await sourceOf(spoofed, NO_PROXY)).toBe("10.0.9.9");
    expect(await sourceOf(spoofed, { ...ONE_PROXY, trustedAddressHeader: "x-edge-address" })).toBe(UNRESOLVED_SOURCE);
    expect(await sourceOf(spoofed, { ...NO_PROXY, trustedAddressHeader: "cf-connecting-ip" })).toBe("10.0.9.9");
  });
});
