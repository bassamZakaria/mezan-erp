import { describe, it, expect, afterEach } from "vitest";
import { createSqliteNotificationRuleStore, type SqliteNotificationRuleStoreHandle } from "@mezan/persistence";
import { createNotificationRulesRoutes } from "./notification-rules-routes.js";

const handles: SqliteNotificationRuleStoreHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteNotificationRuleStore();
  handles.push(repo);
  const app = createNotificationRulesRoutes(repo);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const manage = "notifications.rule.view,notifications.rule.manage";

const payload = {
  id: "rule-1",
  name: "فاتورة مبيعات مؤكدة",
  eventCode: "SALES_INVOICE_CONFIRMED",
  recipientType: "permission",
  recipientValue: "sales.invoice.view",
  priority: "normal",
  channels: ["in_app"],
};

describe("POST / — schema rejection, never a 500", () => {
  it("400s when a required field is missing", async () => {
    const { app } = newApp();
    const { name: _name, ...withoutName } = payload;
    const res = await app.fetch(
      req("/", { method: "POST", permissions: manage, headers: { "content-type": "application/json" }, body: JSON.stringify(withoutName) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("mints an id itself when the caller omits one", async () => {
    const { app } = newApp();
    const { id: _id, ...withoutId } = payload;
    const res = await app.fetch(
      req("/", { method: "POST", permissions: manage, headers: { "content-type": "application/json" }, body: JSON.stringify(withoutId) }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    expect(created.id).toEqual(expect.any(String));
    expect(created.id.length).toBeGreaterThan(0);
  });
});

describe("PUT /:id — schema rejection and unknown-id refusal", () => {
  it("400s on a body the update schema rejects", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/rule-1", {
        method: "PUT",
        permissions: manage,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, priority: "not-a-real-priority" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("404s — never 500s — updating a rule id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/does-not-exist", {
        method: "PUT",
        permissions: manage,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("activate/deactivate/delete on an unknown rule id all 404, never 500", () => {
  it("404s activating an unknown rule", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/does-not-exist/activate", { method: "POST", permissions: manage }));
    expect(res.status).toBe(404);
  });

  it("404s deactivating an unknown rule", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/does-not-exist/deactivate", { method: "POST", permissions: manage }));
    expect(res.status).toBe(404);
  });

  it("404s deleting an unknown rule", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/does-not-exist", { method: "DELETE", permissions: manage }));
    expect(res.status).toBe(404);
  });
});

describe("GET /triggers", () => {
  it("annotates the catalog with which channels this build actually implements", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/triggers", { permissions: "notifications.rule.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { triggers: unknown[]; implementedChannels: string[] };
    expect(Array.isArray(body.triggers)).toBe(true);
    expect(body.implementedChannels).toContain("in_app");
  });
});
