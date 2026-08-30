import { describe, it, expect, afterEach } from "vitest";
import { createSqliteNotificationStore, type SqliteNotificationStoreHandle } from "@mezan/persistence";
import type { Notification } from "@mezan/domain";
import { createNotificationsRoutes } from "./notifications-routes.js";

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
