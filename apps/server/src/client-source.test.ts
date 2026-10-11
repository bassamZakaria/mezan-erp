import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { cloudSource, isResolvedSource, originEnv, UNRESOLVED_SOURCE, type ClientSourceOptions, type CloudSource } from "./client-source.js";

interface Seen {
  readonly source: CloudSource;
  readonly mismatches: number;
}

async function seen(headers: Record<string, string>, options: ClientSourceOptions, socket: string | null = "10.0.9.9"): Promise<Seen> {
  const app = new Hono();
  const onViewerMismatch = vi.fn();
  let source: CloudSource = UNRESOLVED_SOURCE;
  app.get("/", (c) => {
    source = cloudSource(c, { ...options, onViewerMismatch });
    return c.body(null, 204);
  });
  const env = socket === null ? undefined : { incoming: { socket: { remoteAddress: socket } } };
  await app.fetch(new Request("http://local/", { headers }), env);
  return { source, mismatches: onViewerMismatch.mock.calls.length };
}

const sourceOf = async (headers: Record<string, string>, options: ClientSourceOptions, socket: string | null = "10.0.9.9") =>
  (await seen(headers, options, socket)).source;

const NO_PROXY: ClientSourceOptions = { trustedProxyHops: 0, trustViewerAddress: false, compareViewerAddress: false };
const ONE_PROXY: ClientSourceOptions = { trustedProxyHops: 1, trustViewerAddress: false, compareViewerAddress: false };
const TWO_PROXIES: ClientSourceOptions = { trustedProxyHops: 2, trustViewerAddress: false, compareViewerAddress: false };
const CLOUDFRONT: ClientSourceOptions = { trustedProxyHops: 2, trustViewerAddress: true, compareViewerAddress: true };
const BEHIND_SECRET: ClientSourceOptions = { trustedProxyHops: 2, trustViewerAddress: false, compareViewerAddress: true };

describe("where a cloud request came from", () => {
  it("is the socket's peer when no proxy is trusted, whatever the headers claim", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5", "cloudfront-viewer-address": "196.221.5.5:443" }, NO_PROXY)).toBe("10.0.9.9");
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

  it("prefers the viewer address CloudFront set, without its port", async () => {
    const forwarded = { "x-forwarded-for": "196.221.5.5, 41.33.10.10, 130.176.0.7" };
    expect(await sourceOf({ ...forwarded, "cloudfront-viewer-address": "102.44.7.1:46532" }, CLOUDFRONT)).toBe("102.44.7.1");
    const v6 = await sourceOf({ ...forwarded, "cloudfront-viewer-address": "2001:db8::7:46532" }, CLOUDFRONT);
    expect(v6).toBe(await sourceOf({ ...forwarded, "cloudfront-viewer-address": "[2001:db8::7]:46532" }, CLOUDFRONT));
    expect(v6).not.toBe(UNRESOLVED_SOURCE);
  });

  it("reads the forwarded chain when the viewer address is absent or malformed", async () => {
    const forwarded = { "x-forwarded-for": "196.221.5.5, 41.33.10.10, 130.176.0.7" };
    expect(await sourceOf(forwarded, CLOUDFRONT)).toBe("41.33.10.10");
    expect(await sourceOf({ ...forwarded, "cloudfront-viewer-address": "not-an-address" }, CLOUDFRONT)).toBe("41.33.10.10");
  });

  it("ignores a viewer address it was not told to trust", async () => {
    expect(await sourceOf({ "x-forwarded-for": "41.33.10.10, 130.176.0.7", "cloudfront-viewer-address": "196.221.5.5:443" }, TWO_PROXIES)).toBe("41.33.10.10");
  });

  it("reports a hop count that disagrees with the address CloudFront saw, and stays quiet when they agree", async () => {
    const agree = await seen({ "x-forwarded-for": "41.33.10.10, 130.176.0.7", "cloudfront-viewer-address": "41.33.10.10:443" }, BEHIND_SECRET);
    expect(agree).toEqual({ source: "41.33.10.10", mismatches: 0 });
    const wrongHops = await seen({ "x-forwarded-for": "41.33.10.10, 130.176.0.7, 10.1.1.1", "cloudfront-viewer-address": "41.33.10.10:443" }, BEHIND_SECRET);
    expect(wrongHops).toEqual({ source: "130.176.0.7", mismatches: 1 });
    const short = await seen({ "x-forwarded-for": "130.176.0.7", "cloudfront-viewer-address": "41.33.10.10:443" }, BEHIND_SECRET);
    expect(short).toEqual({ source: UNRESOLVED_SOURCE, mismatches: 1 });
  });

  it("hands a tenant backend the source as its request environment, the sentinel included", () => {
    expect(originEnv("41.33.10.10" as CloudSource).incoming.socket.remoteAddress).toBe("41.33.10.10");
    expect(originEnv(UNRESOLVED_SOURCE).incoming.socket.remoteAddress).toBe(UNRESOLVED_SOURCE);
  });
});
