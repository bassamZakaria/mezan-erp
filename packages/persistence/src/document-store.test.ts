import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { Money } from "@mezan/domain";
import type { FrameworkDocument } from "@mezan/domain";
import {
  createSqliteDocumentStore,
  createStandaloneSqliteDocumentStore,
  ensureDocumentTable,
} from "./document-store.js";

interface TestLine {
  itemId: string;
  amount: Money;
}

function serializeLine(line: TestLine): unknown {
  return { itemId: line.itemId, amount: line.amount.toString() };
}

function deserializeLine(wire: unknown): TestLine {
  const w = wire as { itemId: string; amount: string };
  return { itemId: w.itemId, amount: Money.fromMajor(w.amount) };
}

function doc(overrides: Partial<FrameworkDocument<TestLine>> = {}): FrameworkDocument<TestLine> {
  return {
    id: "doc-1",
    docType: "TEST_DOC",
    docNo: null,
    date: "2026-01-15",
    memo: "test memo",
    status: "draft",
    lines: [{ itemId: "item-a", amount: Money.fromMajor("1250.123456") }],
    createdAt: "2026-01-15T10:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

describe("createSqliteDocumentStore", () => {
  it("round-trips a saved document exactly, including a money value carrying all six decimals", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.save(doc());
    const reloaded = await store.findById("doc-1");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.lines[0]?.amount.toString()).toBe("1250.123456");
    expect(reloaded?.lines[0]?.amount.scaled).toBe(Money.fromMajor("1250.123456").scaled);
    expect(reloaded?.memo).toBe("test memo");
    expect(reloaded?.status).toBe("draft");
  });

  it("findById returns null for a missing id", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    expect(await store.findById("nope")).toBeNull();
  });

  it("findById scopes by docType — a document saved under a different type is invisible", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const storeA = createSqliteDocumentStore<TestLine>(db, "TYPE_A", serializeLine, deserializeLine);
    const storeB = createSqliteDocumentStore<TestLine>(db, "TYPE_B", serializeLine, deserializeLine);
    await storeA.save(doc({ docType: "TYPE_A" }));
    expect(await storeB.findById("doc-1")).toBeNull();
    expect(await storeA.findById("doc-1")).not.toBeNull();
  });

  it("update() overwrites status, docNo and lines for an existing row", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.save(doc());
    await store.update(
      doc({
        docNo: "TDOC-000001",
        status: "confirmed",
        confirmedAt: "2026-01-16T00:00:00.000Z",
        lines: [{ itemId: "item-b", amount: Money.fromMajor("999.999999") }],
      }),
    );
    const reloaded = await store.findById("doc-1");
    expect(reloaded?.docNo).toBe("TDOC-000001");
    expect(reloaded?.status).toBe("confirmed");
    expect(reloaded?.lines[0]?.itemId).toBe("item-b");
    expect(reloaded?.lines[0]?.amount.toString()).toBe("999.999999");
  });

  it("list() orders by date then createdAt", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.save(doc({ id: "d2", date: "2026-01-10", createdAt: "2026-01-10T09:00:00.000Z" }));
    await store.save(doc({ id: "d1", date: "2026-01-05", createdAt: "2026-01-05T09:00:00.000Z" }));
    await store.save(doc({ id: "d3", date: "2026-01-10", createdAt: "2026-01-10T08:00:00.000Z" }));
    const all = await store.list();
    expect(all.map((d) => d.id)).toEqual(["d1", "d3", "d2"]);
  });

  it("list() filters by status, fromDate and toDate", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.save(doc({ id: "d1", date: "2026-01-05", status: "draft" }));
    await store.save(doc({ id: "d2", date: "2026-01-10", status: "confirmed" }));
    await store.save(doc({ id: "d3", date: "2026-01-20", status: "confirmed" }));

    expect((await store.list({ status: "confirmed" })).map((d) => d.id)).toEqual(["d2", "d3"]);
    expect((await store.list({ fromDate: "2026-01-08" })).map((d) => d.id)).toEqual(["d2", "d3"]);
    expect((await store.list({ toDate: "2026-01-10" })).map((d) => d.id)).toEqual(["d1", "d2"]);
    expect((await store.list({ fromDate: "2026-01-06", toDate: "2026-01-15" })).map((d) => d.id)).toEqual(["d2"]);
  });

  it("list() returns an empty array for a filter that matches nothing", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.save(doc());
    expect(await store.list({ status: "posted" })).toEqual([]);
  });

  it("only one non-null docNo may exist per docType (unique index)", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.save(doc({ id: "d1", docNo: "TDOC-000001" }));
    await expect(store.save(doc({ id: "d2", docNo: "TDOC-000001" }))).rejects.toThrow(/UNIQUE constraint/i);
  });

  it("multiple documents may share a null docNo (partial unique index)", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.save(doc({ id: "d1", docNo: null }));
    await store.save(doc({ id: "d2", docNo: null }));
    expect((await store.list()).map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });

  it("the same docNo may be reused across different docTypes", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const storeA = createSqliteDocumentStore<TestLine>(db, "TYPE_A", serializeLine, deserializeLine);
    const storeB = createSqliteDocumentStore<TestLine>(db, "TYPE_B", serializeLine, deserializeLine);
    await storeA.save(doc({ id: "a1", docType: "TYPE_A", docNo: "SHARED-1" }));
    await expect(storeB.save(doc({ id: "b1", docType: "TYPE_B", docNo: "SHARED-1" }))).resolves.toBeUndefined();
  });

  it("transaction() commits every write on success", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await store.transaction(async () => {
      await store.save(doc({ id: "d1" }));
      await store.save(doc({ id: "d2" }));
    });
    expect((await store.list()).map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });

  it("transaction() rolls back every write when it throws, leaving nothing behind", async () => {
    const db = new Database(":memory:");
    ensureDocumentTable(db);
    const store = createSqliteDocumentStore<TestLine>(db, "TEST_DOC", serializeLine, deserializeLine);
    await expect(
      store.transaction(async () => {
        await store.save(doc({ id: "d1" }));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.list()).toEqual([]);
  });
});

describe("createStandaloneSqliteDocumentStore", () => {
  it("opens its own connection and closes it", async () => {
    const store = createStandaloneSqliteDocumentStore<TestLine>("TEST_DOC", serializeLine, deserializeLine);
    try {
      await store.save(doc());
      expect(await store.findById("doc-1")).not.toBeNull();
    } finally {
      store.close();
    }
  });
});
