import { describe, it, expect } from "vitest";
import { resolveTenantCode } from "./tenant-resolver.js";

const req = (headers: Record<string, string>) => new Request("http://ignored/api/x", { headers });

describe("resolveTenantCode", () => {
  it("reads the subdomain when a tenant domain is configured", () => {
    expect(resolveTenantCode(req({ host: "cyag.mezan.app" }), { tenantDomain: "mezan.app" })).toBe("cyag");
    expect(resolveTenantCode(req({ host: "CYAG.mezan.app:8080" }), { tenantDomain: "mezan.app" })).toBe("cyag");
  });
  it("prefers x-forwarded-host over host", () => {
    expect(resolveTenantCode(req({ host: "d1.cloudfront.net", "x-forwarded-host": "nile.mezan.app" }), { tenantDomain: "mezan.app" })).toBe("nile");
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
  it("rejects a code that is not a slug", () => {
    expect(resolveTenantCode(req({ "x-mezan-tenant": "no spaces" }), {})).toBeNull();
    expect(resolveTenantCode(req({ host: "bad_code.mezan.app" }), { tenantDomain: "mezan.app" })).toBeNull();
  });
});
