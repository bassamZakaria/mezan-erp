import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createSqliteNotificationStore, type SqliteNotificationStoreHandle } from "@mezan/persistence";
import { ALL_SCOPE, createAuthContext, createEntitlements, type Notification } from "@mezan/domain";
import { createNotificationsRoutes } from "./notifications-routes.js";
import { entitlementsBinding } from "./module-gate.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteNotificationStoreHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n-1",
    ruleId: "rule-1",
    recipientUserId: "u-1",
    eventCode: "SALES_INVOICE_CONFIRMED",
    title: "تم تأكيد فاتورة مبيعات",
    body: "رقم المستند: INV-000123",
    priority: "normal",
    channels: ["in_app"],
    channelStatus: { in_app: "delivered" },
    status: "unread",
    payload: { documentNumber: "INV-000123" },
    createdAt: "2026-08-23T10:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

function newApp() {
  const repo = createSqliteNotificationStore();
  handles.push(repo);
  const app = createNotificationsRoutes(repo, insecureHeaderAuthContextResolver);
  return { app, repo };
}

function req(path: string, userId: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-user-id", userId);
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("notifications router — scoped to the caller", () => {
  it("lists only the calling user's notifications", async () => {
    const { app, repo } = newApp();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "u-1" }));
    await repo.save(makeNotification({ id: "n2", recipientUserId: "u-2" }));

    const res = await app.fetch(req("/", "u-1"));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["n1"]);
  });

  it("filters by status and limit query params", async () => {
    const { app, repo } = newApp();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "u-1", status: "unread", createdAt: "2026-08-23T10:00:00.000Z" }));
    await repo.save(
      makeNotification({ id: "n2", recipientUserId: "u-1", status: "read", readAt: "x", createdAt: "2026-08-23T09:00:00.000Z" }),
    );

    const unread = (await (await app.fetch(req("/?status=unread", "u-1"))).json()) as { id: string }[];
    expect(unread.map((r) => r.id)).toEqual(["n1"]);

    const limited = (await (await app.fetch(req("/?limit=1", "u-1"))).json()) as unknown[];
    expect(limited).toHaveLength(1);
  });

  it("reports the correct unread count", async () => {
    const { app, repo } = newApp();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "u-1", status: "unread" }));
    await repo.save(makeNotification({ id: "n2", recipientUserId: "u-1", status: "unread" }));
    await repo.save(makeNotification({ id: "n3", recipientUserId: "u-2", status: "unread" }));

    const res = await app.fetch(req("/unread-count", "u-1"));
    expect((await res.json()) as { count: number }).toEqual({ count: 2 });
  });

  it("marks one notification read, scoped to the caller", async () => {
    const { app, repo } = newApp();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "u-1" }));

    const wrongUserRes = await app.fetch(req("/n1/read", "u-2", { method: "POST" }));
    expect(wrongUserRes.status).toBe(404);

    const res = await app.fetch(req("/n1/read", "u-1", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("read");
  });

  it("404s marking an unknown notification read", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/does-not-exist/read", "u-1", { method: "POST" }));
    expect(res.status).toBe(404);
  });

  it("marks every unread notification read for the caller only", async () => {
    const { app, repo } = newApp();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "u-1", status: "unread" }));
    await repo.save(makeNotification({ id: "n2", recipientUserId: "u-1", status: "unread" }));
    await repo.save(makeNotification({ id: "n3", recipientUserId: "u-2", status: "unread" }));

    const res = await app.fetch(req("/read-all", "u-1", { method: "POST" }));
    expect(res.status).toBe(204);

    expect((await repo.countUnread("u-1"))).toBe(0);
    expect((await repo.countUnread("u-2"))).toBe(1);
  });
});

/**
 * The bell panel's routes take the caller's identity as the WHOLE
 * authorization — which is correct, and is exactly why an unidentified caller
 * must be turned away rather than served as `"anonymous"` (D132). A resolver
 * reporting `authenticated: false` is what a real session store returns for an
 * expired or unknown session.
 */
describe("an unidentified caller (D132)", () => {
  function newAppWithoutSession() {
    const repo = createSqliteNotificationStore();
    handles.push(repo);
    const app = createNotificationsRoutes(repo, () =>
      createAuthContext({
        userId: "anonymous",
        permissions: [],
        branchScope: ALL_SCOPE,
        warehouseScope: ALL_SCOPE,
        authenticated: false,
      }),
    );
    return { app, repo };
  }

  it("is refused 401 on POST /:id/read, and the notification stays unread", async () => {
    const { app, repo } = newAppWithoutSession();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "anonymous", status: "unread" }));

    const res = await app.fetch(new Request("http://local/n1/read", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("SESSION_EXPIRED");
    // The side effect is the point: a 401 that still marked it read would be
    // the same bug wearing a better status code.
    expect(await repo.countUnread("anonymous")).toBe(1);
  });

  it("is refused 401 on POST /read-all, and every notification stays unread", async () => {
    const { app, repo } = newAppWithoutSession();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "anonymous", status: "unread" }));
    await repo.save(makeNotification({ id: "n2", recipientUserId: "anonymous", status: "unread" }));

    const res = await app.fetch(new Request("http://local/read-all", { method: "POST" }));

    expect(res.status).toBe(401);
    expect(await repo.countUnread("anonymous")).toBe(2);
  });

  it("is refused 401 on the reads too, so an expired session cannot be mistaken for an empty inbox", async () => {
    const { app, repo } = newAppWithoutSession();
    await repo.save(makeNotification({ id: "n1", recipientUserId: "anonymous", status: "unread" }));

    expect((await app.fetch(new Request("http://local/"))).status).toBe(401);
    expect((await app.fetch(new Request("http://local/unread-count"))).status).toBe(401);
  });

  it("still serves an authenticated caller — the gate asks for a session, not for a permission", async () => {
    const repo = createSqliteNotificationStore();
    handles.push(repo);
    const app = createNotificationsRoutes(repo, () =>
      createAuthContext({ userId: "u-1", permissions: [], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }),
    );
    await repo.save(makeNotification({ id: "n1", recipientUserId: "u-1", status: "unread" }));

    const read = await app.fetch(new Request("http://local/n1/read", { method: "POST" }));
    expect(read.status).toBe(200);
    expect(((await read.json()) as { status: string }).status).toBe("read");
    expect(await repo.countUnread("u-1")).toBe(0);
  });
});

describe("POST /notifications/drain — sending what is waiting (ROADMAP §3.3)", () => {
  function drainApp(drain?: () => Promise<{ attempted: number; sent: number; stillQueued: number; failed: number; skipped: number }>) {
    const repo = createSqliteNotificationStore();
    handles.push(repo);
    return createNotificationsRoutes(repo, insecureHeaderAuthContextResolver, { drain });
  }

  function post(path: string, permissions: string) {
    return new Request(`http://local${path}`, {
      method: "POST",
      headers: new Headers({ "x-user-id": "u-1", "x-permissions": permissions }),
    });
  }

  it("refuses a caller who cannot edit the settings — draining reaches the tenant's customers", async () => {
    const app = drainApp(async () => ({ attempted: 0, sent: 0, stillQueued: 0, failed: 0, skipped: 0 }));
    const res = await app.fetch(post("/drain", "notifications.view"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission: string }).permission).toBe("admin.settings.edit");
  });

  it("drains for a caller who can, and reports what happened", async () => {
    const app = drainApp(async () => ({ attempted: 3, sent: 2, stillQueued: 1, failed: 0, skipped: 0 }));
    const res = await app.fetch(post("/drain", "admin.settings.edit"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ attempted: 3, sent: 2, stillQueued: 1, failed: 0, skipped: 0 });
  });

  it("answers 503 with no transport wired, not 404 — the button exists either way", async () => {
    // A 404 would read as "wrong URL" when the truth is "nothing is wired".
    const app = drainApp(undefined);
    const res = await app.fetch(post("/drain", "admin.settings.edit"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("NOTIFICATION_TRANSPORT_UNAVAILABLE");
  });
});

/** `notifications` is a licensable module (docs/superpowers/plans/2026-09-14-saas-slice-a-routing.md, Task A2b). */
describe("notifications router — module gate", () => {
  function newBoundApp(activeModules: string[]) {
    const repo = createSqliteNotificationStore();
    handles.push(repo);
    const entitlements = createEntitlements({ plan: "core", activeModules, features: {}, seats: 1, expiresAt: null });
    const wrapper = new Hono();
    wrapper.use("*", entitlementsBinding(() => entitlements));
    wrapper.route("/", createNotificationsRoutes(repo, insecureHeaderAuthContextResolver));
    return wrapper;
  }

  it("refuses 403 MODULE_NOT_LICENSED when notifications is not in the plan", async () => {
    const app = newBoundApp(["sales"]);
    const res = await app.fetch(req("/", "u-1"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "MODULE_NOT_LICENSED", module: "notifications" });
  });

  it("passes through when notifications is licensed", async () => {
    const app = newBoundApp(["notifications"]);
    const res = await app.fetch(req("/", "u-1"));
    expect(res.status).toBe(200);
  });
});
