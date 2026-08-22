import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createEntitlements } from "@mezan/domain";
import { createModuleGate } from "./module-gate.js";

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
