import { describe, expect, it } from "vitest";
import { CustomerMessageStatus, DunningChannel, DunningReminderStatus, Money, type DunningReminder } from "@mezan/domain";
import { createSqliteCollectionsStore } from "./collections-store.js";

const reminder: DunningReminder = {
  id: "R1",
  itemKey: "receivable:INV-1",
  stepId: "step-1",
  stepLevel: 1,
  customerId: "C1",
  documentId: "INV-1",
  reference: "INV-1",
  channel: DunningChannel.Email,
  subject: "s",
  body: "b",
  amount: Money.fromMajor("100.5"),
  daysOverdue: 8,
  dueDate: "2026-10-09",
  status: DunningReminderStatus.Prepared,
  voidReason: null,
  failureReason: null,
  messageId: null,
  preparedOn: "2026-10-17",
  preparedAt: "2026-10-17T08:00:00.000Z",
  preparedBy: "u1",
  sentAt: null,
  sentBy: null,
  outcome: null,
};

describe("collections store", () => {
  it("inserts a reminder once per (item, step)", async () => {
    const store = createSqliteCollectionsStore();
    expect(await store.reminders.insertIfAbsent(reminder)).toBe(true);
    expect(await store.reminders.insertIfAbsent({ ...reminder, id: "R2" })).toBe(false);
    expect((await store.reminders.list()).map((r) => r.id)).toEqual(["R1"]);
    expect((await store.reminders.findById("R1"))?.amount.toString()).toBe(Money.fromMajor("100.5").toString());
  });

  it("lets only the drain that claimed a customer message settle it", async () => {
    const store = createSqliteCollectionsStore();
    await store.outbox.enqueue({ id: "M1", customerId: "C1", subject: "s", body: "b", status: CustomerMessageStatus.Queued, failureReason: null, createdAt: "2026-10-17T08:00:00.000Z", sentAt: null });
    const first = await store.outbox.claim("M1", "2026-10-17T08:01:00.000Z");
    expect(first).not.toBeNull();
    expect(await store.outbox.claim("M1", "2026-10-17T08:01:01.000Z")).toBeNull();
    expect(await store.outbox.settle("M1", CustomerMessageStatus.Sent, "wrong", { sentAt: null, failureReason: null })).toBe(false);
    expect(await store.outbox.settle("M1", CustomerMessageStatus.Sent, first!, { sentAt: "2026-10-17T08:02:00.000Z", failureReason: null })).toBe(true);
    expect((await store.outbox.findById("M1"))?.status).toBe(CustomerMessageStatus.Sent);
  });

  it("puts a stuck sending message back in the queue", async () => {
    const store = createSqliteCollectionsStore();
    await store.outbox.enqueue({ id: "M1", customerId: "C1", subject: "s", body: "b", status: CustomerMessageStatus.Queued, failureReason: null, createdAt: "2026-10-17T08:00:00.000Z", sentAt: null });
    await store.outbox.claim("M1", "2026-10-17T08:01:00.000Z");
    expect(await store.outbox.requeueStaleSending("2026-10-17T08:30:00.000Z")).toBe(1);
    expect((await store.outbox.listQueued(10)).map((m) => m.id)).toEqual(["M1"]);
  });
});
