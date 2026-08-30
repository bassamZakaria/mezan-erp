import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { Money } from "@mezan/domain";
import type { FrameworkDocument } from "@mezan/domain";
import { createSqliteFrameworkDocumentStore, type FrameworkDocumentStoreOptions } from "./framework-document-store.js";

interface TestLine {
  itemId: string;
  amount: Money;
}

const opts: FrameworkDocumentStoreOptions<TestLine> = {
  tableName: "test_fw_doc",
  docType: "TEST_FW_DOC",
  lineToWire: (line) => ({ itemId: line.itemId, amount: line.amount.toString() }),
  lineFromWire: (wire) => {
    const w = wire as { itemId: string; amount: string };
    return { itemId: w.itemId, amount: Money.fromMajor(w.amount) };
  },
};

function doc(overrides: Partial<FrameworkDocument<TestLine>> = {}): FrameworkDocument<TestLine> {
  return {
    id: "doc-1",
    docType: "TEST_FW_DOC",
    docNo: null,
    date: "2026-01-15",
    memo: "test memo",
    status: "draft",
    lines: [{ itemId: "item-a", amount: Money.fromMajor("42.000001") }],
    createdAt: "2026-01-15T10:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

describe("createSqliteFrameworkDocumentStore", () => {
  it("round-trips a saved document exactly, including a money value carrying all six decimals", async () => {
    const db = new Database(":memory:");
    const store = createSqliteFrameworkDocumentStore<TestLine>(db, opts);
    await store.save(doc());
    const reloaded = await store.findById("doc-1");
    expect(reloaded?.lines[0]?.amount.toString()).toBe("42.000001");
    expect(reloaded?.lines[0]?.amount.scaled).toBe(Money.fromMajor("42.000001").scaled);
    expect(reloaded?.docType).toBe("TEST_FW_DOC");
  });

  it("findById returns null for a missing id", async () => {
    const db = new Database(":memory:");
    const store = createSqliteFrameworkDocumentStore<TestLine>(db, opts);
    expect(await store.findById("nope")).toBeNull();
  });

  it("update() overwrites status and lines for an existing row", async () => {
    const db = new Database(":memory:");
    const store = createSqliteFrameworkDocumentStore<TestLine>(db, opts);
    await store.save(doc());
    await store.update(doc({ status: "confirmed", lines: [{ itemId: "item-b", amount: Money.fromMajor("1.5") }] }));
    const reloaded = await store.findById("doc-1");
    expect(reloaded?.status).toBe("confirmed");
    expect(reloaded?.lines[0]?.itemId).toBe("item-b");
  });

  it("list() orders by date then createdAt", async () => {
    const db = new Database(":memory:");
    const store = createSqliteFrameworkDocumentStore<TestLine>(db, opts);
    await store.save(doc({ id: "d2", date: "2026-01-10", createdAt: "2026-01-10T09:00:00.000Z" }));
    await store.save(doc({ id: "d1", date: "2026-01-05", createdAt: "2026-01-05T09:00:00.000Z" }));
    const all = await store.list();
    expect(all.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("list() filters by status/fromDate/toDate and returns nothing for a non-matching filter", async () => {
    const db = new Database(":memory:");
    const store = createSqliteFrameworkDocumentStore<TestLine>(db, opts);
    await store.save(doc({ id: "d1", date: "2026-01-05", status: "draft" }));
    await store.save(doc({ id: "d2", date: "2026-01-10", status: "confirmed" }));
    expect((await store.list({ status: "confirmed" })).map((d) => d.id)).toEqual(["d2"]);
    expect((await store.list({ fromDate: "2026-01-08" })).map((d) => d.id)).toEqual(["d2"]);
    expect((await store.list({ toDate: "2026-01-06" })).map((d) => d.id)).toEqual(["d1"]);
    expect(await store.list({ status: "posted" })).toEqual([]);
  });

  it("transaction() commits on success and rolls back everything on throw", async () => {
    const db = new Database(":memory:");
    const store = createSqliteFrameworkDocumentStore<TestLine>(db, opts);
    await store.transaction(async () => {
      await store.save(doc({ id: "d1" }));
    });
    expect(await store.findById("d1")).not.toBeNull();

    await expect(
      store.transaction(async () => {
        await store.save(doc({ id: "d2" }));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.findById("d2")).toBeNull();
  });

  it("two document types sharing one connection get independent tables", async () => {
    const db = new Database(":memory:");
    const storeA = createSqliteFrameworkDocumentStore<TestLine>(db, opts);
    const storeB = createSqliteFrameworkDocumentStore<TestLine>(db, { ...opts, tableName: "test_fw_doc_b", docType: "OTHER" });
    await storeA.save(doc({ id: "d1" }));
    expect(await storeB.findById("d1")).toBeNull();
    expect(await storeA.findById("d1")).not.toBeNull();
  });
});
