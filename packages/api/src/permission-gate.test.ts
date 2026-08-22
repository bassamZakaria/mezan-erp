import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createAuthContext, ALL_SCOPE } from "@mezan/domain";
import { createPermissionGate, headerAuthContextResolver, getAuthContext } from "./permission-gate.js";

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

describe("headerAuthContextResolver", () => {
  it("resolves permissions/scopes from headers, defaulting to no access", async () => {
    const gate = createPermissionGate(headerAuthContextResolver);
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
    const gate = createPermissionGate(headerAuthContextResolver);
    const app = new Hono();
    app.get("/settings", gate("admin.settings.edit"), (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://x/settings", { headers: { "x-permissions": "*" } }));
    expect(res.status).toBe(200);
  });
});
