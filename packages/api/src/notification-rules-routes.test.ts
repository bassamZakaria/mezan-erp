import { describe, it, expect, afterEach } from "vitest";
import { createSqliteNotificationRuleStore, type SqliteNotificationRuleStoreHandle } from "@mezan/persistence";
import { createNotificationRulesRoutes } from "./notification-rules-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteNotificationRuleStoreHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteNotificationRuleStore();
  handles.push(repo);
  const app = createNotificationRulesRoutes(repo, insecureHeaderAuthContextResolver);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const payload = {
  id: "rule-1",
  name: "فاتورة مبيعات مؤكدة",
  eventCode: "SALES_INVOICE_CONFIRMED",
  recipientType: "permission",
  recipientValue: "sales.invoice.view",
  priority: "normal",
  channels: ["in_app"],
};

describe("notification-rules router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("notifications.rule.view");
  });

  it("allows GET / with notifications.rule.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "notifications.rule.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "notifications.rule.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("notification-rules router — CRUD", () => {
  it("creates, lists, gets, updates, deactivates and deletes a rule", async () => {
    const { app } = newApp();
    const perms = "notifications.rule.view,notifications.rule.manage";

    const createRes = await app.fetch(
      req("/", { method: "POST", permissions: perms, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; active: boolean };
    expect(created.id).toBe("rule-1");
    expect(created.active).toBe(true);

    const listRes = await app.fetch(req("/", { permissions: perms }));
    expect(((await listRes.json()) as unknown[]).length).toBe(1);

    const getRes = await app.fetch(req("/rule-1", { permissions: perms }));
    expect(getRes.status).toBe(200);

    const updateRes = await app.fetch(
      req("/rule-1", {
        method: "PUT",
        permissions: perms,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, name: "اسم محدث" }),
      }),
    );
    expect(updateRes.status).toBe(200);
    expect(((await updateRes.json()) as { name: string }).name).toBe("اسم محدث");

    const deactivateRes = await app.fetch(req("/rule-1/deactivate", { method: "POST", permissions: perms }));
    expect(((await deactivateRes.json()) as { active: boolean }).active).toBe(false);

    const activateRes = await app.fetch(req("/rule-1/activate", { method: "POST", permissions: perms }));
    expect(((await activateRes.json()) as { active: boolean }).active).toBe(true);

    const deleteRes = await app.fetch(req("/rule-1", { method: "DELETE", permissions: perms }));
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await app.fetch(req("/rule-1", { permissions: perms }));
    expect(getAfterDelete.status).toBe(404);
  });

  it("rejects an unknown event code with 422", async () => {
    const { app } = newApp();
    const perms = "notifications.rule.view,notifications.rule.manage";
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: perms,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, eventCode: "NOT_A_REAL_EVENT" }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "INVALID_NOTIFICATION_RULE" });
  });

  it("exposes the full 39-event catalog at GET /events", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/events", { permissions: "notifications.rule.view" }));
    expect(res.status).toBe(200);
    const events = (await res.json()) as { code: string }[];
    expect(events.length).toBe(39);
    expect(events.map((e) => e.code)).toContain("SALES_INVOICE_CONFIRMED");
  });

  it("filters list by active and eventCode query params", async () => {
    const { app } = newApp();
    const perms = "notifications.rule.view,notifications.rule.manage";
    await app.fetch(
      req("/", { method: "POST", permissions: perms, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
    );
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: perms,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, id: "rule-2", eventCode: "LOW_STOCK_DETECTED", active: false }),
      }),
    );

    const activeOnly = (await (await app.fetch(req("/?active=true", { permissions: perms }))).json()) as unknown[];
    expect(activeOnly).toHaveLength(1);

    const byEvent = (await (await app.fetch(req("/?eventCode=LOW_STOCK_DETECTED", { permissions: perms }))).json()) as unknown[];
    expect(byEvent).toHaveLength(1);
  });
});
