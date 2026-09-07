import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createEntitlements } from "@mezan/domain";
import { applyModuleGates, createModuleGate } from "./module-gate.js";

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

  it("refuses the bare collection route too, not just the wildcard below it", async () => {
    const res = await coreApp().fetch(new Request("http://x/manufacturing"));
    expect(res.status).toBe(403);
  });

  it("refuses HR and fixed assets on the same licence", async () => {
    for (const path of ["/hr/employees", "/assets/register"]) {
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
