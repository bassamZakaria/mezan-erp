import { describe, it, expect } from "vitest";
import { createSqliteAccountRoutingStore, openSqliteConnection } from "@mezan/persistence";
import { createSessionRegistry, createSessionAuthContextResolver } from "./session-auth.js";
import { createAccountRoutingRoutes } from "./account-routing-routes.js";

function newApp() {
  const { sqlite } = openSqliteConnection(":memory:");
  const repo = createSqliteAccountRoutingStore(sqlite);
  const sessions = createSessionRegistry();
  const app = createAccountRoutingRoutes(repo, createSessionAuthContextResolver(sessions));
  return { app, repo, sessions, sqlite };
}

function grant(sessions: ReturnType<typeof createSessionRegistry>, permissions: string[]) {
  const token = sessions.issue({
    userId: "u1",
    permissions,
    roleCode: null,
    branchScope: "*",
    warehouseScope: "*",
  });
  return { headers: { authorization: `Bearer ${token}` } };
}

function req(path: string, init: RequestInit = {}) {
  return new Request(`http://local${path}`, init);
}

describe("account-routing router — permission gate", () => {
  it("401s an unauthenticated GET", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("SESSION_EXPIRED");
  });

  it("401s an unauthenticated PUT", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(401);
  });

  it("403s a caller without accounting.coa.view on GET", async () => {
    const { app, sessions } = newApp();
    const res = await app.fetch(req("/", grant(sessions, ["admin.settings.view"])));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission: string }).permission).toBe("accounting.coa.view");
  });

  it("403s a caller with only view permission on PUT", async () => {
    const { app, sessions } = newApp();
    const auth = grant(sessions, ["accounting.coa.view"]);
    const res = await app.fetch(
      req("/", { method: "PUT", headers: { ...auth.headers, "content-type": "application/json" }, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("account-routing router — GET /", () => {
  it("returns every slot resolved to its shipped default when nothing is overridden", async () => {
    const { app, sessions } = newApp();
    const res = await app.fetch(req("/", grant(sessions, ["accounting.coa.view"])));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { slots: Array<{ key: string; accountId: string; overridden: boolean }>; options: { latePenaltyTreatment: string } };
    const outputVat = body.slots.find((s) => s.key === "tax.output_vat")!;
    expect(outputVat.accountId).toBe("2200");
    expect(outputVat.overridden).toBe(false);
    expect(body.options.latePenaltyTreatment).toBe("revenue_deduction");
    expect(body.slots.length).toBeGreaterThan(20);
  });
});

describe("account-routing router — PUT /", () => {
  it("400s a malformed body (overrides value not string|null)", async () => {
    const { app, sessions } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "PUT",
        ...grant(sessions, ["accounting.coa.manage"]),
        headers: { ...grant(sessions, ["accounting.coa.manage"]).headers, "content-type": "application/json" },
        body: JSON.stringify({ overrides: { "tax.output_vat": 42 } }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, unknown> } };
    expect(Object.keys(body.details.fieldErrors)).toContain("overrides");
  });

  it("422s an unknown routing key", async () => {
    const { app, sessions } = newApp();
    const auth = grant(sessions, ["accounting.coa.manage"]);
    const res = await app.fetch(
      req("/", {
        method: "PUT",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ overrides: { "not.a.real.slot": "9999" } }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("UNKNOWN_ROUTING_KEY");
  });

  it("sets an override, and a read-back through GET reflects it", async () => {
    const { app, sessions } = newApp();
    const auth = grant(sessions, ["accounting.coa.manage"]);
    const putRes = await app.fetch(
      req("/", {
        method: "PUT",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ overrides: { "tax.output_vat": "2299" }, options: { latePenaltyTreatment: "expense" } }),
      }),
    );
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { slots: Array<{ key: string; accountId: string; overridden: boolean }>; options: { latePenaltyTreatment: string } };
    const overridden = putBody.slots.find((s) => s.key === "tax.output_vat")!;
    expect(overridden.accountId).toBe("2299");
    expect(overridden.overridden).toBe(true);
    expect(putBody.options.latePenaltyTreatment).toBe("expense");

    const getRes = await app.fetch(req("/", grant(sessions, ["accounting.coa.view"])));
    const getBody = (await getRes.json()) as { slots: Array<{ key: string; accountId: string }> };
    expect(getBody.slots.find((s) => s.key === "tax.output_vat")!.accountId).toBe("2299");
  });

  it("a null override clears a previously set override back to the default", async () => {
    const { app, sessions } = newApp();
    const auth = grant(sessions, ["accounting.coa.manage"]);
    await app.fetch(
      req("/", {
        method: "PUT",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ overrides: { "tax.output_vat": "2299" } }),
      }),
    );
    const clearRes = await app.fetch(
      req("/", {
        method: "PUT",
        headers: { ...auth.headers, "content-type": "application/json" },
        body: JSON.stringify({ overrides: { "tax.output_vat": null } }),
      }),
    );
    const body = (await clearRes.json()) as { slots: Array<{ key: string; accountId: string; overridden: boolean }> };
    const slot = body.slots.find((s) => s.key === "tax.output_vat")!;
    expect(slot.accountId).toBe("2200");
    expect(slot.overridden).toBe(false);
  });
});
