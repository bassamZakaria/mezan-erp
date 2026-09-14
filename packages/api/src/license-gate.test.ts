import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  createWriteGate,
  WRITABLE_LICENSE_STATE,
  type LicenseStateView,
} from "./license-gate.js";

const READ_ONLY: LicenseStateView = {
  state: "READ_ONLY",
  canWrite: false,
  usable: true,
  reason: "EXPIRED_PAST_GRACE",
};

const UNLICENSED: LicenseStateView = {
  state: "UNLICENSED",
  canWrite: false,
  usable: true,
  reason: "NO_SUBSCRIPTION",
};

function appWith(state: LicenseStateView): Hono {
  const app = new Hono();
  app.use("*", createWriteGate(() => state));
  app.get("/sales-invoices", (c) => c.json({ ok: true }));
  app.post("/sales-invoices", (c) => c.json({ created: true }, 201));
  app.post("/auth/login", (c) => c.json({ token: "t" }));
  app.post("/license/activate", (c) => c.json({ activated: true }));
  app.post("/bootstrap/admin", (c) => c.json({ created: true }, 201));
  return app;
}

describe("createWriteGate (license read-only enforcement)", () => {
  it("lets every read (GET) through even when the license cannot write", async () => {
    const res = await appWith(READ_ONLY).request("/sales-invoices");
    expect(res.status).toBe(200);
  });

  it("refuses a mutating request with 403 LICENSE_READ_ONLY when read-only", async () => {
    const res = await appWith(READ_ONLY).request("/sales-invoices", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; state: string; message: string };
    expect(body.error).toBe("LICENSE_READ_ONLY");
    expect(body.state).toBe("READ_ONLY");
    // Operator-facing message is Arabic, not a raw enum.
    expect(body.message).toContain("القراءة فقط");
  });

  it("still allows sign-in while read-only, or the lockout traps the user out of their own data", async () => {
    const res = await appWith(READ_ONLY).request("/auth/login", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("still allows license activation while read-only, so the lockout can be lifted", async () => {
    const res = await appWith(READ_ONLY).request("/license/activate", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("still allows /bootstrap/admin while READ_ONLY or UNLICENSED, so a never-licensed tenant can still be provisioned", async () => {
    const readOnlyRes = await appWith(READ_ONLY).request("/bootstrap/admin", { method: "POST" });
    expect(readOnlyRes.status).toBe(201);
    const unlicensedRes = await appWith(UNLICENSED).request("/bootstrap/admin", { method: "POST" });
    expect(unlicensedRes.status).toBe(201);
  });

  it("passes mutations through untouched when the license can write", async () => {
    const res = await appWith(WRITABLE_LICENSE_STATE).request("/sales-invoices", {
      method: "POST",
    });
    expect(res.status).toBe(201);
  });
});
