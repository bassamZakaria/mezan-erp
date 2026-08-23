import { describe, expect, it, afterEach } from "vitest";
import { createSqliteNotificationStore, type SqliteNotificationStoreHandle } from "./notification-store.js";
import type { Notification } from "@mezan/domain";

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

describe("SqliteNotificationRepository", () => {
  let handle: SqliteNotificationStoreHandle;

  afterEach(() => {
    handle?.close();
  });

  it("round-trips save/findById", async () => {
    handle = createSqliteNotificationStore();
    const n = makeNotification();
    await handle.save(n);
    expect(await handle.findById(n.id)).toEqual(n);
  });

  it("listForUser scopes strictly to the recipient and orders newest-first", async () => {
    handle = createSqliteNotificationStore();
    await handle.save(makeNotification({ id: "n1", recipientUserId: "u-1", createdAt: "2026-08-23T10:00:00.000Z" }));
    await handle.save(makeNotification({ id: "n2", recipientUserId: "u-1", createdAt: "2026-08-23T11:00:00.000Z" }));
    await handle.save(makeNotification({ id: "n3", recipientUserId: "u-2", createdAt: "2026-08-23T12:00:00.000Z" }));

    const rows = await handle.listForUser("u-1");
    expect(rows.map((r) => r.id)).toEqual(["n2", "n1"]);
  });

  it("listForUser filters by status and respects limit", async () => {
    handle = createSqliteNotificationStore();
    await handle.save(makeNotification({ id: "n1", status: "unread", createdAt: "2026-08-23T10:00:00.000Z" }));
    await handle.save(makeNotification({ id: "n2", status: "read", readAt: "2026-08-23T10:30:00.000Z", createdAt: "2026-08-23T10:15:00.000Z" }));
    await handle.save(makeNotification({ id: "n3", status: "unread", createdAt: "2026-08-23T10:20:00.000Z" }));

    expect((await handle.listForUser("u-1", { status: "unread" })).map((r) => r.id).sort()).toEqual(["n1", "n3"]);
    expect(await handle.listForUser("u-1", { limit: 1 })).toHaveLength(1);
  });

  it("countUnread counts only this user's unread rows", async () => {
    handle = createSqliteNotificationStore();
    await handle.save(makeNotification({ id: "n1", recipientUserId: "u-1", status: "unread" }));
    await handle.save(makeNotification({ id: "n2", recipientUserId: "u-1", status: "read", readAt: "x" }));
    await handle.save(makeNotification({ id: "n3", recipientUserId: "u-2", status: "unread" }));

    expect(await handle.countUnread("u-1")).toBe(1);
    expect(await handle.countUnread("u-2")).toBe(1);
    expect(await handle.countUnread("u-3")).toBe(0);
  });

  it("markRead flips status/readAt only for the owning user, and is idempotent", async () => {
    handle = createSqliteNotificationStore();
    await handle.save(makeNotification({ id: "n1", recipientUserId: "u-1", status: "unread" }));

    await handle.markRead("n1", "u-2", "2026-08-23T12:00:00.000Z"); // wrong user — no-op
    expect((await handle.findById("n1"))?.status).toBe("unread");

    await handle.markRead("n1", "u-1", "2026-08-23T12:00:00.000Z");
    const after = await handle.findById("n1");
    expect(after?.status).toBe("read");
    expect(after?.readAt).toBe("2026-08-23T12:00:00.000Z");

    await handle.markRead("n1", "u-1", "2026-08-23T13:00:00.000Z"); // already read — no-op
    expect((await handle.findById("n1"))?.readAt).toBe("2026-08-23T12:00:00.000Z");
  });

  it("markAllRead flips every unread row for that user only", async () => {
    handle = createSqliteNotificationStore();
    await handle.save(makeNotification({ id: "n1", recipientUserId: "u-1", status: "unread" }));
    await handle.save(makeNotification({ id: "n2", recipientUserId: "u-1", status: "unread" }));
    await handle.save(makeNotification({ id: "n3", recipientUserId: "u-2", status: "unread" }));

    await handle.markAllRead("u-1", "2026-08-23T12:00:00.000Z");

    expect(await handle.countUnread("u-1")).toBe(0);
    expect(await handle.countUnread("u-2")).toBe(1);
  });
});
