import { describe, it, expect } from "vitest";
import { NotificationDispatcher, type DispatchOutcome, type NotificationTransport } from "./dispatcher.js";
import type { Notification, NotificationRepository } from "./types.js";

const NOW = "2026-09-14T12:00:00.000Z";

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    ruleId: "r1",
    recipientUserId: "u1",
    eventCode: "SALES_INVOICE_CONFIRMED",
    title: "فاتورة جديدة",
    body: "تم تأكيد الفاتورة INV-000001",
    priority: "normal",
    channels: ["in_app", "email"],
    channelStatus: { in_app: "delivered", email: "queued" },
    status: "unread",
    payload: {},
    createdAt: NOW,
    readAt: null,
    ...over,
  } as Notification;
}

function store(rows: Notification[]) {
  const saved: Notification[] = [];
  const repo = {
    async save(n: Notification) {
      saved.push(n);
      const at = rows.findIndex((r) => r.id === n.id);
      if (at >= 0) rows[at] = n;
    },
    async findById(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async listForUser() {
      return rows;
    },
    async countUnread() {
      return 0;
    },
    async markRead() {},
    async markAllRead() {},
    async listQueued(limit: number) {
      return rows.filter((r) => Object.values(r.channelStatus).includes("queued")).slice(0, limit);
    },
  } as unknown as NotificationRepository & { listQueued(limit: number): Promise<readonly Notification[]> };
  return { repo, saved, rows };
}

function transport(outcome: DispatchOutcome, seen: string[] = []): NotificationTransport {
  return {
    channel: "email",
    async send(n) {
      seen.push(n.id);
      return outcome;
    },
  };
}

function dispatcher(rows: Notification[], t: NotificationTransport | null, now = NOW) {
  const s = store(rows);
  return {
    ...s,
    run: () =>
      new NotificationDispatcher({
        notifications: s.repo,
        transports: t ? [t] : [],
        recipientEmail: async () => "owner@shop.test",
        now: () => now,
      }).drain(),
  };
}

describe("NotificationDispatcher — draining the outbound queue (ROADMAP §3.3)", () => {
  it("sends a queued email and marks the channel sent", async () => {
    const rows = [notification()];
    const d = dispatcher(rows, transport({ kind: "sent" }));
    const result = await d.run();

    expect(result).toMatchObject({ attempted: 1, sent: 1, failed: 0, stillQueued: 0 });
    expect(rows[0]?.channelStatus.email).toBe("sent");
    // The in-app row it was delivered through is untouched.
    expect(rows[0]?.channelStatus.in_app).toBe("delivered");
  });

  it("LEAVES a message queued when the shop is offline, because offline is not a failure", async () => {
    // This is the decision the whole module exists to encode: a shop with no
    // internet is this product's normal state. Marking it failed would discard
    // mail that is perfectly deliverable ten minutes later.
    const rows = [notification()];
    const d = dispatcher(rows, transport({ kind: "offline", reason: "no route to host" }));
    const result = await d.run();

    expect(result).toMatchObject({ attempted: 1, sent: 0, failed: 0, stillQueued: 1 });
    expect(rows[0]?.channelStatus.email).toBe("queued");
  });

  it("retries the same message on the next drain, unchanged", async () => {
    const rows = [notification()];
    const seen: string[] = [];
    const offline = dispatcher(rows, transport({ kind: "offline", reason: "offline" }, seen));
    await offline.run();
    await offline.run();
    expect(seen).toEqual(["n1", "n1"]);
    expect(rows[0]?.channelStatus.email).toBe("queued");
  });

  it("fails a message the server REJECTED, because retrying cannot fix it", async () => {
    const rows = [notification()];
    const d = dispatcher(rows, transport({ kind: "rejected", reason: "550 no such mailbox" }));
    const result = await d.run();

    expect(result).toMatchObject({ sent: 0, failed: 1, stillQueued: 0 });
    expect(rows[0]?.channelStatus.email).toBe("failed");
  });

  it("abandons a message that went stale rather than delivering it late", async () => {
    // A "فاتورة جديدة" notice three weeks late is noise, and a month of backlog
    // arriving the moment a shop reconnects is worse than nothing.
    const rows = [notification({ createdAt: "2026-09-01T12:00:00.000Z" })];
    const seen: string[] = [];
    const d = dispatcher(rows, transport({ kind: "sent" }, seen));
    const result = await d.run();

    expect(result).toMatchObject({ failed: 1, attempted: 0 });
    expect(rows[0]?.channelStatus.email).toBe("failed");
    // It was never handed to the transport at all.
    expect(seen).toEqual([]);
  });

  it("keeps a message that is old but still inside the window", async () => {
    const rows = [notification({ createdAt: "2026-09-12T13:00:00.000Z" })];
    const d = dispatcher(rows, transport({ kind: "sent" }));
    expect((await d.run()).sent).toBe(1);
  });

  it("skips a channel with no transport instead of failing it", async () => {
    // A push channel nobody has wired is not a delivery failure; it is a
    // channel this build does not have, and failing it would tell the tenant
    // their message was rejected.
    const rows = [notification({ channelStatus: { in_app: "delivered", push: "queued" } })];
    const d = dispatcher(rows, transport({ kind: "sent" }));
    const result = await d.run();

    expect(result).toMatchObject({ skipped: 1, attempted: 0, failed: 0 });
    expect(rows[0]?.channelStatus.push).toBe("queued");
  });

  it("never touches a notification with nothing queued", async () => {
    const rows = [notification({ channelStatus: { in_app: "delivered" } })];
    const d = dispatcher(rows, transport({ kind: "sent" }));
    expect(await d.run()).toMatchObject({ attempted: 0, sent: 0, failed: 0, stillQueued: 0 });
    expect(d.saved).toEqual([]);
  });

  it("writes nothing back when every channel merely stayed queued", async () => {
    const rows = [notification()];
    const d = dispatcher(rows, transport({ kind: "offline", reason: "offline" }));
    await d.run();
    expect(d.saved).toEqual([]);
  });

  it("caps one drain at the batch size, so a month offline is not one enormous send", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => notification({ id: `n${i}` }));
    const seen: string[] = [];
    const s = store(rows);
    const result = await new NotificationDispatcher({
      notifications: s.repo,
      transports: [transport({ kind: "sent" }, seen)],
      recipientEmail: async () => "owner@shop.test",
      now: () => NOW,
    }).drain();

    expect(result.sent).toBe(50);
    expect(seen).toHaveLength(50);
  });
});
