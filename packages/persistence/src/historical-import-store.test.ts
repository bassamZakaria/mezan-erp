import { describe, it, expect } from "vitest";
import { Money, Qty, type HistoricalPurchaseArchive } from "@mezan/domain";
import { createSqliteHistoricalPurchaseArchiveStore } from "./historical-import-store.js";

function archive(overrides: Partial<HistoricalPurchaseArchive> = {}): HistoricalPurchaseArchive {
  return {
    id: "HPI-1:0",
    docType: "PURCHASE_INVOICE",
    originalNumber: "INV-9001",
    supplierId: "sup-1",
    date: "2026-01-15",
    dueDate: "2026-02-15",
    lines: [
      { itemId: "item-A", description: null, qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("25.00") },
      { itemId: null, description: "شحن", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("50.00") },
    ],
    total: Money.fromMajor("300.00"),
    amountPaid: Money.fromMajor("100.00"),
    remainingBalance: Money.fromMajor("200.00"),
    settled: false,
    importBatchId: "HPI-1",
    createdBy: "user-1",
    createdAt: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}

describe("SQLite historical-purchase-archive store", () => {
  it("opens standalone", async () => {
    const store = createSqliteHistoricalPurchaseArchiveStore(":memory:");
    expect(await store.list()).toEqual([]);
    store.close();
  });

  it("round-trips every field, including the settled boolean <-> INTEGER mapping", async () => {
    const store = createSqliteHistoricalPurchaseArchiveStore(":memory:");
    await store.create(archive());

    const found = await store.findById("HPI-1:0");
    expect(found).not.toBeNull();
    expect(found?.docType).toBe("PURCHASE_INVOICE");
    expect(found?.originalNumber).toBe("INV-9001");
    expect(found?.supplierId).toBe("sup-1");
    expect(found?.date).toBe("2026-01-15");
    expect(found?.dueDate).toBe("2026-02-15");
    expect(found?.importBatchId).toBe("HPI-1");
    expect(found?.createdBy).toBe("user-1");
    expect(found?.createdAt).toBe("2026-08-21T09:00:00.000Z");

    expect(found?.total.equals(Money.fromMajor("300.00"))).toBe(true);
    expect(found?.amountPaid.equals(Money.fromMajor("100.00"))).toBe(true);
    expect(found?.remainingBalance.equals(Money.fromMajor("200.00"))).toBe(true);
    expect(found?.settled).toBe(false);

    expect(found?.lines).toHaveLength(2);
    expect(found?.lines[0]?.itemId).toBe("item-A");
    expect(found?.lines[0]?.qty.compare(Qty.fromMajor("10"))).toBe(0);
    expect(found?.lines[0]?.unitCost.equals(Money.fromMajor("25.00"))).toBe(true);
    expect(found?.lines[1]?.itemId).toBeNull();
    expect(found?.lines[1]?.description).toBe("شحن");

    // a SETTLED archive (paid in full) must round-trip `settled: true` back out of SQLite's 0/1 INTEGER.
    await store.create(
      archive({
        id: "HPI-1:1",
        originalNumber: "INV-9002",
        amountPaid: Money.fromMajor("300.00"),
        remainingBalance: Money.zero(),
        settled: true,
      }),
    );
    const settledFound = await store.findById("HPI-1:1");
    expect(settledFound?.settled).toBe(true);
    expect(settledFound?.remainingBalance.equals(Money.zero())).toBe(true);

    store.close();
  });

  it("findById returns null for a missing id", async () => {
    const store = createSqliteHistoricalPurchaseArchiveStore(":memory:");
    expect(await store.findById("nope")).toBeNull();
    store.close();
  });

  it("findByOriginalNumber finds an existing archive and returns null when absent", async () => {
    const store = createSqliteHistoricalPurchaseArchiveStore(":memory:");
    await store.create(archive());

    const found = await store.findByOriginalNumber("PURCHASE_INVOICE", "INV-9001");
    expect(found?.id).toBe("HPI-1:0");

    expect(await store.findByOriginalNumber("PURCHASE_INVOICE", "INV-DOES-NOT-EXIST")).toBeNull();

    store.close();
  });

  it("does not collide across doc types sharing the same original number", async () => {
    const store = createSqliteHistoricalPurchaseArchiveStore(":memory:");
    await store.create(archive({ id: "HPI-1:0", docType: "PURCHASE_INVOICE", originalNumber: "SHARED-001" }));
    await store.create(archive({ id: "HPI-1:1", docType: "PURCHASE_RETURN", originalNumber: "SHARED-001" }));

    expect(await store.findByOriginalNumber("PURCHASE_INVOICE", "SHARED-001")).not.toBeNull();
    expect((await store.findByOriginalNumber("PURCHASE_INVOICE", "SHARED-001"))?.id).toBe("HPI-1:0");
    expect((await store.findByOriginalNumber("PURCHASE_RETURN", "SHARED-001"))?.id).toBe("HPI-1:1");

    // the OTHER doc type for a number that only exists under one type must miss.
    expect(await store.findByOriginalNumber("PURCHASE_RETURN", "INV-ONLY-INVOICE")).toBeNull();

    store.close();
  });

  it("list() returns everything created, across import batches", async () => {
    const store = createSqliteHistoricalPurchaseArchiveStore(":memory:");
    await store.create(archive({ id: "HPI-1:0", originalNumber: "INV-9001", importBatchId: "HPI-1" }));
    await store.create(archive({ id: "HPI-2:0", originalNumber: "INV-9002", importBatchId: "HPI-2" }));

    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.importBatchId).sort()).toEqual(["HPI-1", "HPI-2"]);

    store.close();
  });

  it("rejects a second archive with the same (docType, originalNumber) via the unique index", async () => {
    const store = createSqliteHistoricalPurchaseArchiveStore(":memory:");
    await store.create(archive({ id: "HPI-1:0", docType: "PURCHASE_INVOICE", originalNumber: "DUP-001" }));

    await expect(
      store.create(archive({ id: "HPI-2:0", docType: "PURCHASE_INVOICE", originalNumber: "DUP-001" })),
    ).rejects.toThrow();

    store.close();
  });
});
