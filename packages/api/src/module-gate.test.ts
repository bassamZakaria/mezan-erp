import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createEntitlements, ALL_SCOPE, createAuthContext } from "@mezan/domain";
import { createModuleGate, entitlementsBinding } from "./module-gate.js";
import { createPermissionGate } from "./permission-gate.js";

function appWithEntitlements(activeModules: string[]) {
  const entitlements = createEntitlements({
    plan: "ENTERPRISE",
    activeModules,
    features: {},
    seats: 5,
    expiresAt: null,
  });
  const gate = createModuleGate(() => entitlements);
  const app = new Hono();
  app.use("/pos/*", gate("pos"));
  app.get("/pos/sales", (c) => c.json({ ok: true }));
  app.get("/sales/invoices", (c) => c.json({ ok: true }));
  return app;
}

describe("module gate middleware", () => {
  it("allows calls into a licensed module", async () => {
    const app = appWithEntitlements(["sales", "pos"]);
    const res = await app.fetch(new Request("http://x/pos/sales"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects calls into an unlicensed module with 403", async () => {
    const app = appWithEntitlements(["sales"]);
    const res = await app.fetch(new Request("http://x/pos/sales"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "MODULE_NOT_LICENSED",
      module: "pos",
    });
  });

  it("leaves ungated routes untouched", async () => {
    const app = appWithEntitlements(["sales"]);
    const res = await app.fetch(new Request("http://x/sales/invoices"));
    expect(res.status).toBe(200);
  });

  it("rejects with 403 when no entitlements resolve", async () => {
    const gate = createModuleGate(() => null);
    const app = new Hono();
    app.use("/pos/*", gate("pos"));
    app.get("/pos/sales", (c) => c.json({ ok: true }));
    const res = await app.fetch(new Request("http://x/pos/sales"));
    expect(res.status).toBe(403);
  });
});

describe("entitlementsBinding", () => {
  it("sets the resolved entitlements on the request context", async () => {
    const entitlements = createEntitlements({
      plan: "core",
      activeModules: ["sales"],
      features: {},
      seats: 1,
      expiresAt: null,
    });
    const app = new Hono();
    app.use("*", entitlementsBinding(() => entitlements));
    app.get("/probe", (c) => c.json({ plan: c.get("entitlements")?.plan ?? null }));
    const res = await app.fetch(new Request("http://x/probe"));
    expect(await res.json()).toEqual({ plan: "core" });
  });

  it("leaves entitlements unset when the resolver returns nothing", async () => {
    const app = new Hono();
    app.use("*", entitlementsBinding(() => undefined));
    app.get("/probe", (c) => c.json({ plan: c.get("entitlements")?.plan ?? null }));
    const res = await app.fetch(new Request("http://x/probe"));
    expect(await res.json()).toEqual({ plan: null });
  });
});

describe("permission gate — module check via bound entitlements", () => {
  function appFor(activeModules: string[], permissions: string[] = ["*"]) {
    const entitlements = createEntitlements({
      plan: "core",
      activeModules,
      features: {},
      seats: 1,
      expiresAt: null,
    });
    const ctx = createAuthContext({ userId: "u1", permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const gate = createPermissionGate(() => ctx);
    const app = new Hono();
    app.use("*", entitlementsBinding(() => entitlements));
    app.get("/hr", gate("hr.employee.view"), (c) => c.json({ ok: true }));
    app.get("/sales", gate("sales.invoice.view"), (c) => c.json({ ok: true }));
    app.get("/admin", gate("admin.users.view"), (c) => c.json({ ok: true }));
    return app;
  }

  it("refuses an unlicensed module's permission with MODULE_NOT_LICENSED, even for the tenant admin", async () => {
    const app = appFor(["sales"]);
    const res = await app.fetch(new Request("http://x/hr"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "MODULE_NOT_LICENSED",
      module: "hr",
      message: "وحدة الموارد البشرية غير مفعّلة في باقتكم",
    });
  });

  it("passes a licensed module's permission", async () => {
    const app = appFor(["sales"]);
    const res = await app.fetch(new Request("http://x/sales"));
    expect(res.status).toBe(200);
  });

  it("passes an always-licensed module's permission", async () => {
    const app = appFor(["sales"]);
    const res = await app.fetch(new Request("http://x/admin"));
    expect(res.status).toBe(200);
  });

  it("refuses nothing on the module axis when no entitlements are bound at all", async () => {
    const ctx = createAuthContext({ userId: "u1", permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const gate = createPermissionGate(() => ctx);
    const app = new Hono();
    app.get("/hr", gate("hr.employee.view"), (c) => c.json({ ok: true }));
    const res = await app.fetch(new Request("http://x/hr"));
    expect(res.status).toBe(200);
  });
});
