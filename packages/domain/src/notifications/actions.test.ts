import { describe, it, expect } from "vitest";
import { markNotificationRead, markAllNotificationsRead } from "./actions.js";
import { NotificationNotFoundError } from "./errors.js";
import type { Notification, NotificationListFilter, NotificationRepository } from "./types.js";

class FakeNotificationRepository implements NotificationRepository {
  readonly rows: Notification[] = [];
  async save(notification: Notification): Promise<void> {
    this.rows.push(notification);
  }
  async findById(id: string): Promise<Notification | null> {
    return this.rows.find((n) => n.id === id) ?? null;
  }
  async listForUser(userId: string, filter: NotificationListFilter = {}): Promise<readonly Notification[]> {
    let rows = this.rows.filter((n) => n.recipientUserId === userId);
    if (filter.status) rows = rows.filter((n) => n.status === filter.status);
    return rows;
  }
  async countUnread(userId: string): Promise<number> {
    return this.rows.filter((n) => n.recipientUserId === userId && n.status === "unread").length;
  }
  async markRead(id: string, userId: string, readAt: string): Promise<void> {
    const row = this.rows.find((n) => n.id === id && n.recipientUserId === userId);
    if (row) {
      (row as { status: string }).status = "read";
      (row as { readAt: string | null }).readAt = readAt;
    }
  }
  async markAllRead(userId: string, readAt: string): Promise<void> {
    for (const row of this.rows) {
      if (row.recipientUserId === userId && row.status === "unread") {
        (row as { status: string }).status = "read";
        (row as { readAt: string | null }).readAt = readAt;
      }
    }
  }
}

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    ruleId: "r1",
    recipientUserId: "u1",
    eventCode: "SALES_INVOICE_CONFIRMED",
    title: "عنوان",
    body: "نص",
    priority: "normal",
    channels: ["in_app"],
    channelStatus: { in_app: "delivered" },
    status: "unread",
    payload: {},
    createdAt: "2026-08-22T10:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

describe("markNotificationRead", () => {
  it("marks an unread notification read and returns the updated row", async () => {
    const repo = new FakeNotificationRepository();
    repo.rows.push(notification());
    const result = await markNotificationRead("n1", "u1", repo, () => "2026-08-22T11:00:00.000Z");
    expect(result.status).toBe("read");
    expect(result.readAt).toBe("2026-08-22T11:00:00.000Z");
  });

  it("is a no-op (does not call markRead again) on an already-read notification", async () => {
    const repo = new FakeNotificationRepository();
    repo.rows.push(notification({ status: "read", readAt: "2026-08-22T09:00:00.000Z" }));
    const result = await markNotificationRead("n1", "u1", repo, () => "2026-08-22T11:00:00.000Z");
    expect(result.readAt).toBe("2026-08-22T09:00:00.000Z");
  });

  it("throws NotificationNotFoundError when the id does not exist", async () => {
    const repo = new FakeNotificationRepository();
    await expect(markNotificationRead("missing", "u1", repo)).rejects.toBeInstanceOf(NotificationNotFoundError);
  });

  it("throws NotificationNotFoundError when the notification belongs to a different user (never leaks another user's row)", async () => {
    const repo = new FakeNotificationRepository();
    repo.rows.push(notification({ recipientUserId: "other-user" }));
    await expect(markNotificationRead("n1", "u1", repo)).rejects.toBeInstanceOf(NotificationNotFoundError);
  });
});

describe("markAllNotificationsRead", () => {
  it("marks every unread notification for the user read and leaves other users untouched", async () => {
    const repo = new FakeNotificationRepository();
    repo.rows.push(notification({ id: "n1", recipientUserId: "u1" }));
    repo.rows.push(notification({ id: "n2", recipientUserId: "u1" }));
    repo.rows.push(notification({ id: "n3", recipientUserId: "u2" }));
    await markAllNotificationsRead("u1", repo, () => "2026-08-22T12:00:00.000Z");
    expect((await repo.findById("n1"))?.status).toBe("read");
    expect((await repo.findById("n2"))?.status).toBe("read");
    expect((await repo.findById("n3"))?.status).toBe("unread");
  });

  it("does nothing when the user has no notifications", async () => {
    const repo = new FakeNotificationRepository();
    await expect(markAllNotificationsRead("nobody", repo)).resolves.toBeUndefined();
  });
});
