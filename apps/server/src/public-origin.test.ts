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
