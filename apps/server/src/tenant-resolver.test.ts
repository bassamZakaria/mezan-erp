import { describe, it, expect } from "vitest";
import { resolveTenantCode } from "./tenant-resolver.js";

const req = (headers: Record<string, string>) => new Request("http://ignored/api/x", { headers });

describe("resolveTenantCode", () => {
  it("reads the subdomain when a tenant domain is configured", () => {
    expect(resolveTenantCode(req({ host: "cyag.mezan.app" }), { tenantDomain: "mezan.app" })).toBe("cyag");
    expect(resolveTenantCode(req({ host: "CYAG.mezan.app:8080" }), { tenantDomain: "mezan.app" })).toBe("cyag");
  });
  it("prefers x-forwarded-host over host when trusted", () => {
    expect(
      resolveTenantCode(req({ host: "d1.cloudfront.net", "x-forwarded-host": "nile.mezan.app" }), {
        tenantDomain: "mezan.app",
        trustForwardedHost: true,
      }),
    ).toBe("nile");
  });
  it("takes the first host in a comma-separated x-forwarded-host when trusted", () => {
    expect(
      resolveTenantCode(req({ "x-forwarded-host": "cyag.mezan.app, proxy.internal" }), {
        tenantDomain: "mezan.app",
        trustForwardedHost: true,
      }),
    ).toBe("cyag");
  });
  it("ignores x-forwarded-host by default and reads Host instead", () => {
    expect(
      resolveTenantCode(req({ host: "nile.mezan.app", "x-forwarded-host": "cyag.mezan.app" }), { tenantDomain: "mezan.app" }),
    ).toBe("nile");
  });
  it("ignores the x-mezan-tenant header when allowTenantHeader is false", () => {
    expect(resolveTenantCode(req({ "x-mezan-tenant": "cyag" }), { allowTenantHeader: false })).toBeNull();
    expect(
      resolveTenantCode(req({ host: "mezan.app", "x-mezan-tenant": "nile" }), { tenantDomain: "mezan.app", allowTenantHeader: false }),
    ).toBeNull();
  });
  it("gives null for the bare domain, a deeper label, or a host outside the domain", () => {
    expect(resolveTenantCode(req({ host: "mezan.app" }), { tenantDomain: "mezan.app" })).toBeNull();
    expect(resolveTenantCode(req({ host: "a.b.mezan.app" }), { tenantDomain: "mezan.app" })).toBeNull();
    expect(resolveTenantCode(req({ host: "cyag.other.app" }), { tenantDomain: "mezan.app" })).toBeNull();
  });
  it("falls back to the x-mezan-tenant header, trimmed and lower-cased", () => {
    expect(resolveTenantCode(req({ host: "localhost:4101", "x-mezan-tenant": " Cyag " }), {})).toBe("cyag");
    expect(resolveTenantCode(req({ host: "mezan.app", "x-mezan-tenant": "nile" }), { tenantDomain: "mezan.app" })).toBe("nile");
  });
  it("lower-cases and trims inner whitespace-padded upper case in the header", () => {
    expect(resolveTenantCode(req({ "x-mezan-tenant": "  NiLe  " }), {})).toBe("nile");
  });
  it("rejects a code that is not a slug", () => {
    expect(resolveTenantCode(req({ "x-mezan-tenant": "no spaces" }), {})).toBeNull();
    expect(resolveTenantCode(req({ host: "bad_code.mezan.app" }), { tenantDomain: "mezan.app" })).toBeNull();
  });
});
