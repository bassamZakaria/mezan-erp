import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";
import { tenantPublicOrigin, trustedPublicOrigin } from "./public-origin.js";

function request(headers: Record<string, string>): Request {
  return new Request("http://10.0.0.5:8080/api/signup", { headers });
}

describe("the origin a mailed link is built on", () => {
  it("is the configured public URL, whatever host the caller claims", () => {
    const env = parseEnv({ MEZAN_PUBLIC_URL: "https://app.mezan.example/", MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" });

    expect(trustedPublicOrigin(request({ host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" }), env)).toBe("https://app.mezan.example");
  });

  it("is one of the deployment's own tenant subdomains when the request came in on it", () => {
    const env = parseEnv({ MEZAN_PUBLIC_URL: "https://app.mezan.example", MEZAN_TENANT_DOMAIN: "mezan.example", MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" });

    expect(trustedPublicOrigin(request({ "x-forwarded-host": "Nile.Mezan.Example:443" }), env)).toBe("https://nile.mezan.example");
    expect(trustedPublicOrigin(request({ "x-forwarded-host": "nile.mezan.example.evil.example" }), env)).toBe("https://app.mezan.example");
    expect(trustedPublicOrigin(request({ "x-forwarded-host": "a.b.mezan.example" }), env)).toBe("https://app.mezan.example");
    expect(trustedPublicOrigin(request({ "x-forwarded-host": "evilmezan.example" }), env)).toBe("https://app.mezan.example");
  });

  it.each([
    ["a decimal address with a path", "2130706433/x?.mezan.example"],
    ["userinfo, a port and a query", "user@evil.example:1/?.mezan.example"],
    ["a bracketed v6 address", "[::1]/?.mezan.example"],
    ["a fragment", "evil.example/#.mezan.example"],
    ["a backslash", "evil.example\\.mezan.example"],
    ["a trailing dot", "nile.mezan.example."],
    ["a port that is not a number", "nile.mezan.example:evil"],
    ["a label that is not a tenant code", "a_b.mezan.example"],
    ["an empty label", ".mezan.example"],
  ])("never builds a link on a forwarded host that is not exactly a tenant subdomain: %s", (_, hostile) => {
    const proxied = { MEZAN_TENANT_DOMAIN: "mezan.example", MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" };

    expect(trustedPublicOrigin(request({ "x-forwarded-host": hostile }), parseEnv({ ...proxied, MEZAN_PUBLIC_URL: "https://app.mezan.example" }))).toBe("https://app.mezan.example");
    expect(trustedPublicOrigin(request({ "x-forwarded-host": hostile }), parseEnv(proxied))).toBeNull();
    expect(trustedPublicOrigin(request({ host: hostile }), parseEnv({ MEZAN_TENANT_DOMAIN: "mezan.example" }))).toBeNull();
  });

  it("writes the tenant subdomain itself, in lower case and with no port the caller chose", () => {
    const env = parseEnv({ MEZAN_TENANT_DOMAIN: "mezan.example", MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" });

    expect(trustedPublicOrigin(request({ "x-forwarded-host": "NILE.MEZAN.EXAMPLE" }), env)).toBe("https://nile.mezan.example");
    expect(trustedPublicOrigin(request({ "x-forwarded-host": "nile.mezan.example:8443" }), env)).toBe("https://nile.mezan.example");
    expect(tenantPublicOrigin(env, "nile/x?")).toBeNull();
  });

  it("reads the forwarded host only behind a trusted proxy", () => {
    const env = parseEnv({ MEZAN_TENANT_DOMAIN: "mezan.example" });

    expect(trustedPublicOrigin(request({ host: "10.0.0.5:8080", "x-forwarded-host": "nile.mezan.example" }), env)).toBeNull();
    expect(trustedPublicOrigin(request({ host: "nile.mezan.example" }), env)).toBe("https://nile.mezan.example");
  });

  it("is nothing at all when neither a public URL nor a tenant domain is configured", () => {
    expect(trustedPublicOrigin(request({ host: "evil.example", "x-forwarded-host": "evil.example" }), parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" }))).toBeNull();
  });

  it("falls back to the card checkout's public URL, which was the only configured origin before", () => {
    const env = parseEnv({ MEZAN_PAYMOB_TEST_MODE: "1", MEZAN_PAYMOB_PUBLIC_URL: "https://pay.mezan.example" });

    expect(trustedPublicOrigin(request({ host: "evil.example" }), env)).toBe("https://pay.mezan.example");
  });

  it("answers a tenant's own subdomain for a link written with no request in hand", () => {
    expect(tenantPublicOrigin(parseEnv({ MEZAN_TENANT_DOMAIN: "Mezan.Example" }), "nile")).toBe("https://nile.mezan.example");
    expect(tenantPublicOrigin(parseEnv({ MEZAN_PUBLIC_URL: "https://app.mezan.example", MEZAN_TENANT_DOMAIN: "mezan.example" }), "nile")).toBe("https://app.mezan.example");
    expect(tenantPublicOrigin(parseEnv({}), "nile")).toBeNull();
  });

  it("refuses a public URL that is not an http(s) origin", () => {
    expect(() => parseEnv({ MEZAN_PUBLIC_URL: "javascript:alert(1)" })).toThrow("MEZAN_PUBLIC_URL");
    expect(() => parseEnv({ MEZAN_PUBLIC_URL: "not a url" })).toThrow("MEZAN_PUBLIC_URL");
  });
});
