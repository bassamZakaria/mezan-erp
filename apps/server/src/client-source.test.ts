import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientSource, originEnv, type ClientSourceOptions } from "./client-source.js";

async function sourceOf(headers: Record<string, string>, options: ClientSourceOptions, socket: string | null = "10.0.9.9"): Promise<string | null> {
  const app = new Hono();
  let seen: string | null = null;
  app.get("/", (c) => {
    seen = clientSource(c, options);
    return c.body(null, 204);
  });
  await app.fetch(new Request("http://local/", { headers }), originEnv(socket));
  return seen;
}

const NO_PROXY: ClientSourceOptions = { trustedProxyHops: 0, trustViewerAddress: false };
const ONE_PROXY: ClientSourceOptions = { trustedProxyHops: 1, trustViewerAddress: false };
const TWO_PROXIES: ClientSourceOptions = { trustedProxyHops: 2, trustViewerAddress: false };
const CLOUDFRONT: ClientSourceOptions = { trustedProxyHops: 2, trustViewerAddress: true };

describe("where a cloud request came from", () => {
  it("is the socket's peer when no proxy is trusted, whatever the headers claim", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5", "cloudfront-viewer-address": "196.221.5.5:443" }, NO_PROXY)).toBe("10.0.9.9");
  });

  it("is nobody's address when there is no socket and no proxy is trusted", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5" }, NO_PROXY, null)).toBeNull();
  });

  it("is the hop the one trusted proxy appended, never a hop the client wrote ahead of it", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5, 41.33.10.10" }, ONE_PROXY)).toBe("41.33.10.10");
    expect(await sourceOf({ "x-forwarded-for": "41.33.10.10" }, ONE_PROXY)).toBe("41.33.10.10");
  });

  it("is the hop the first of two trusted proxies appended", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5, 41.33.10.10, 130.176.0.7" }, TWO_PROXIES)).toBe("41.33.10.10");
    expect(await sourceOf({ "x-forwarded-for": "41.33.10.10, 130.176.0.7" }, TWO_PROXIES)).toBe("41.33.10.10");
  });

  it("falls back to the socket's peer when the chain is shorter than the proxies it was told to trust", async () => {
    expect(await sourceOf({ "x-forwarded-for": "196.221.5.5" }, TWO_PROXIES)).toBe("10.0.9.9");
    expect(await sourceOf({}, ONE_PROXY)).toBe("10.0.9.9");
  });

  it("falls back to the socket's peer when the trusted hop is not an address", async () => {
    expect(await sourceOf({ "x-forwarded-for": "unknown, 130.176.0.7" }, TWO_PROXIES)).toBe("10.0.9.9");
  });

  it("prefers the viewer address CloudFront set, without its port", async () => {
    const forwarded = { "x-forwarded-for": "196.221.5.5, 41.33.10.10, 130.176.0.7" };
    expect(await sourceOf({ ...forwarded, "cloudfront-viewer-address": "102.44.7.1:46532" }, CLOUDFRONT)).toBe("102.44.7.1");
    expect(await sourceOf({ ...forwarded, "cloudfront-viewer-address": "2001:db8::7:46532" }, CLOUDFRONT)).toBe("2001:db8::7");
    expect(await sourceOf({ ...forwarded, "cloudfront-viewer-address": "[2001:db8::7]:46532" }, CLOUDFRONT)).toBe("2001:db8::7");
  });

  it("reads the forwarded chain when the viewer address is absent or malformed", async () => {
    const forwarded = { "x-forwarded-for": "196.221.5.5, 41.33.10.10, 130.176.0.7" };
    expect(await sourceOf(forwarded, CLOUDFRONT)).toBe("41.33.10.10");
    expect(await sourceOf({ ...forwarded, "cloudfront-viewer-address": "not-an-address" }, CLOUDFRONT)).toBe("41.33.10.10");
  });

  it("ignores a viewer address it was not told to trust", async () => {
    expect(await sourceOf({ "x-forwarded-for": "41.33.10.10, 130.176.0.7", "cloudfront-viewer-address": "196.221.5.5:443" }, TWO_PROXIES)).toBe("41.33.10.10");
  });
});
