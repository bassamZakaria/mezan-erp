import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createEntitlements, ALL_SCOPE, createAuthContext } from "@mezan/domain";
import { applyModuleGates, createModuleGate, entitlementsBinding } from "./module-gate.js";
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

  it("words the refusal by the licence on an install that has no subscription plan", async () => {
    const app = appWithEntitlements(["sales"]);
    const res = await app.fetch(new Request("http://x/pos/sales"));
    expect(((await res.json()) as { message: string }).message).toBe("وحدة نقاط البيع غير مُفعّلة في ترخيص هذه النسخة. تواصل مع الدعم لإضافتها إلى الاشتراك.");
  });

  it("words the refusal by the subscription plan on a tenant that has one", async () => {
    const entitlements = createEntitlements({ plan: "business", planNameAr: "الأعمال", planNameEn: "Business", activeModules: ["sales"], features: {}, seats: 5, expiresAt: null });
    const app = new Hono();
    app.use("/pos/*", createModuleGate(() => entitlements)("pos"));
    app.get("/pos/sales", (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://x/pos/sales"));

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("MODULE_NOT_LICENSED");
    expect(body.message).toBe("وحدة نقاط البيع ليست ضمن باقة «الأعمال». يمكنكم إضافتها بترقية الباقة من صفحة الاشتراك.");
    expect(body.messageEn).toBe('The Point of sale module is not in the "Business" plan. You can add it by upgrading the plan from the subscription page.');
    expect(body.message).not.toContain("ترخيص");
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

/**
 * guards L-12: `createModuleGate` had ZERO call sites. It was exported, tested
 * in isolation, and gated nothing — the API served all nineteen modules
 * regardless of the licence, so a Core-priced install ran manufacturing, HR and
 * fixed assets in full.
 */
describe("applyModuleGates over the real route prefixes", () => {
  function coreApp() {
    const entitlements = createEntitlements({
      plan: "CORE",
      activeModules: ["sales", "purchases", "inventory", "accounting", "treasury"],
      features: {},
      seats: 2,
      expiresAt: null,
    });
    const app = new Hono();
    applyModuleGates(app, () => entitlements);
    for (const path of [
      "/manufacturing/work-orders",
      "/manufacturing",
      "/hr/employees",
      "/assets/register",
      "/sales-invoices",
      "/sales-invoices/INV-1",
      "/settings",
      "/users",
      "/license/state",
      "/auth/login",
      "/documents",
      "/reports/trial-balance",
    ]) {
      app.get(path, (c) => c.json({ ok: true }));
      app.post(path, (c) => c.json({ ok: true }));
    }
    return app;
  }

  it("refuses a Core licence on a manufacturing route, in Arabic", async () => {
    const res = await coreApp().fetch(new Request("http://x/manufacturing/work-orders"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; module: string; message: string };
    expect(body.error).toBe("MODULE_NOT_LICENSED");
    expect(body.module).toBe("manufacturing");
    expect(body.message).toContain("التصنيع");
    expect(body.message).toMatch(/[؀-ۿ]/);
  });

  it("gives the same refusal in English, naming the module", async () => {
    const res = await coreApp().fetch(new Request("http://x/manufacturing/work-orders"));
    const body = (await res.json()) as { messageEn: string };
    expect(body.messageEn).toBe("The Manufacturing module is not enabled in this copy's licence. Contact support to add it to the subscription.");
  });

  it("names the licensed part and its module in English", async () => {
    const res = await coreApp().fetch(new Request("http://x/hr/payroll/runs"));
    const body = (await res.json()) as { messageEn: string };
    expect(body.messageEn).toMatch(/^The .+ part of Human resources is not enabled in this copy's licence\./);
  });

  it("refuses the bare collection route too, not just the wildcard below it", async () => {
    const res = await coreApp().fetch(new Request("http://x/manufacturing"));
    expect(res.status).toBe(403);
  });

  it("refuses HR payroll and fixed assets on the same licence", async () => {
    // The HR staff list (/hr/employees) is free on every plan; payroll is not.
    for (const path of ["/hr/payroll/runs", "/assets/register"]) {
      expect((await coreApp().fetch(new Request(`http://x${path}`))).status).toBe(403);
    }
  });

  it("serves the modules the licence DID buy", async () => {
    for (const path of ["/sales-invoices", "/sales-invoices/INV-1"]) {
      expect((await coreApp().fetch(new Request(`http://x${path}`))).status).toBe(200);
    }
  });

  /**
   * Platform surface is never module-gated: a licence that locked an owner out
   * of settings, users or the licence screen itself would lock them out of the
   * one screen that explains why.
   */
  it("never gates settings, users, documents, reports, auth or /license", async () => {
    for (const path of [
      "/settings",
      "/users",
      "/license/state",
      "/auth/login",
      "/documents",
      "/reports/trial-balance",
    ]) {
      expect((await coreApp().fetch(new Request(`http://x${path}`))).status).toBe(200);
    }
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
    app.get("/hr", gate("hr.payroll.view"), (c) => c.json({ ok: true }));
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
      module: "hr.payroll",
      message: "جزء الرواتب من الموارد البشرية غير مفعّل في باقتكم",
      messageEn: "The Payroll part of Human resources is not enabled in your plan.",
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
