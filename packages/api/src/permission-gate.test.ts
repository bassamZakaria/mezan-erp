import { afterEach, describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createAuthContext, ALL_SCOPE } from "@mezan/domain";
import { createPermissionGate, insecureHeaderAuthContextResolver, getAuthContext, isProductionRuntime } from "./permission-gate.js";

function appWithContext(permissions: string[]) {
  const ctx = createAuthContext({ userId: "u1", permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const gate = createPermissionGate(() => ctx);
  const app = new Hono();
  app.get("/settings", gate("admin.settings.view"), (c) => c.json({ ok: true, ctxUser: getAuthContext(c)?.userId }));
  return app;
}

describe("permission gate middleware", () => {
  it("allows a call when the resolved context holds the permission", async () => {
    const app = appWithContext(["admin.settings.view"]);
    const res = await app.fetch(new Request("http://x/settings"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ctxUser: "u1" });
  });

  it("allows a tenant admin (wildcard) unconditionally", async () => {
    const app = appWithContext(["*"]);
    const res = await app.fetch(new Request("http://x/settings"));
    expect(res.status).toBe(200);
  });

  it("rejects with 403 PERMISSION_DENIED when the permission is missing", async () => {
    const app = appWithContext([]);
    const res = await app.fetch(new Request("http://x/settings"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "PERMISSION_DENIED", permission: "admin.settings.view" });
  });
});

describe("insecureHeaderAuthContextResolver", () => {
  it("resolves permissions/scopes from headers, defaulting to no access", async () => {
    const gate = createPermissionGate(insecureHeaderAuthContextResolver);
    const app = new Hono();
    app.get("/settings", gate("admin.settings.view"), (c) => c.json({ ok: true }));

    const denied = await app.fetch(new Request("http://x/settings"));
    expect(denied.status).toBe(403);

    const granted = await app.fetch(
      new Request("http://x/settings", { headers: { "x-permissions": "admin.settings.view" } }),
    );
    expect(granted.status).toBe(200);
  });

  it("treats the wildcard permission as full admin access", async () => {
    const gate = createPermissionGate(insecureHeaderAuthContextResolver);
    const app = new Hono();
    app.get("/settings", gate("admin.settings.edit"), (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://x/settings", { headers: { "x-permissions": "*" } }));
    expect(res.status).toBe(200);
  });
});

describe("isProductionRuntime — the switch two fail-closed guards hang on", () => {
  const saved = { packaged: process.env["MEZAN_PACKAGED"], node: process.env["NODE_ENV"] };
  afterEach(() => {
    if (saved.packaged === undefined) delete process.env["MEZAN_PACKAGED"];
    else process.env["MEZAN_PACKAGED"] = saved.packaged;
    if (saved.node === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = saved.node;
  });

  it("is false in a dev or test process, so the header resolver still works there", () => {
    delete process.env["MEZAN_PACKAGED"];
    process.env["NODE_ENV"] = "test";
    expect(isProductionRuntime()).toBe(false);
    expect(() => insecureHeaderAuthContextResolver(fakeContext())).not.toThrow();
  });

  it("is true on a packaged desktop build, and the header resolver refuses to run", () => {
    // Read per call, not captured at import: the desktop main process sets
    // MEZAN_PACKAGED after this module is loaded, so a snapshot taken at import
    // time would be the wrong value on exactly the edition this guards.
    process.env["MEZAN_PACKAGED"] = "1";
    expect(isProductionRuntime()).toBe(true);
    expect(() => insecureHeaderAuthContextResolver(fakeContext())).toThrow(/production\/packaged/);
  });

  it("is true on a headless production build too", () => {
    delete process.env["MEZAN_PACKAGED"];
    process.env["NODE_ENV"] = "production";
    expect(isProductionRuntime()).toBe(true);
  });
});

function fakeContext() {
  return { req: { header: () => "*" } } as unknown as Parameters<typeof insecureHeaderAuthContextResolver>[0];
}
