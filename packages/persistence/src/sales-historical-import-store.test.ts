import { describe, it, expect } from "vitest";
import { Money, Qty, type HistoricalSalesArchive } from "@mezan/domain";
import { createSqliteHistoricalSalesArchiveStore } from "./sales-historical-import-store.js";

function archive(overrides: Partial<HistoricalSalesArchive> = {}): HistoricalSalesArchive {
  return {
    id: "HSI-1:0",
    docType: "SALES_INVOICE",
    originalNumber: "INV-9001",
    customerId: "cust-1",
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
    importBatchId: "HSI-1",
    createdBy: "user-1",
    createdAt: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}

describe("SQLite historical-sales-archive store", () => {
  it("opens standalone", async () => {
    const store = createSqliteHistoricalSalesArchiveStore(":memory:");
    expect(await store.list()).toEqual([]);
    store.close();
  });

  it("round-trips every field, including the settled boolean <-> INTEGER mapping", async () => {
    const store = createSqliteHistoricalSalesArchiveStore(":memory:");
    await store.create(archive());

    const found = await store.findById("HSI-1:0");
    expect(found).not.toBeNull();
    expect(found?.docType).toBe("SALES_INVOICE");
    expect(found?.originalNumber).toBe("INV-9001");
    expect(found?.customerId).toBe("cust-1");
    expect(found?.date).toBe("2026-01-15");
    expect(found?.dueDate).toBe("2026-02-15");
    expect(found?.importBatchId).toBe("HSI-1");
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
        id: "HSI-1:1",
        originalNumber: "INV-9002",
        amountPaid: Money.fromMajor("300.00"),
        remainingBalance: Money.zero(),
        settled: true,
      }),
    );
    const settledFound = await store.findById("HSI-1:1");
    expect(settledFound?.settled).toBe(true);
    expect(settledFound?.remainingBalance.equals(Money.zero())).toBe(true);

    store.close();
  });

  it("findById returns null for a missing id", async () => {
    const store = createSqliteHistoricalSalesArchiveStore(":memory:");
    expect(await store.findById("nope")).toBeNull();
    store.close();
  });

  it("findByOriginalNumber finds an existing archive and returns null when absent", async () => {
    const store = createSqliteHistoricalSalesArchiveStore(":memory:");
    await store.create(archive());

    const found = await store.findByOriginalNumber("SALES_INVOICE", "INV-9001");
    expect(found?.id).toBe("HSI-1:0");

    expect(await store.findByOriginalNumber("SALES_INVOICE", "INV-DOES-NOT-EXIST")).toBeNull();

    store.close();
  });

  it("does not collide across doc types sharing the same original number", async () => {
    const store = createSqliteHistoricalSalesArchiveStore(":memory:");
    await store.create(archive({ id: "HSI-1:0", docType: "SALES_INVOICE", originalNumber: "SHARED-001" }));
    await store.create(archive({ id: "HSI-1:1", docType: "SALES_RETURN", originalNumber: "SHARED-001" }));

    expect(await store.findByOriginalNumber("SALES_INVOICE", "SHARED-001")).not.toBeNull();
    expect((await store.findByOriginalNumber("SALES_INVOICE", "SHARED-001"))?.id).toBe("HSI-1:0");
    expect((await store.findByOriginalNumber("SALES_RETURN", "SHARED-001"))?.id).toBe("HSI-1:1");

    // the OTHER doc type for a number that only exists under one type must miss.
    expect(await store.findByOriginalNumber("SALES_RETURN", "INV-ONLY-INVOICE")).toBeNull();

    store.close();
  });

  it("list() returns everything created, across import batches", async () => {
    const store = createSqliteHistoricalSalesArchiveStore(":memory:");
    await store.create(archive({ id: "HSI-1:0", originalNumber: "INV-9001", importBatchId: "HSI-1" }));
    await store.create(archive({ id: "HSI-2:0", originalNumber: "INV-9002", importBatchId: "HSI-2" }));

    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.importBatchId).sort()).toEqual(["HSI-1", "HSI-2"]);

    store.close();
  });

  it("rejects a second archive with the same (docType, originalNumber) via the unique index", async () => {
    const store = createSqliteHistoricalSalesArchiveStore(":memory:");
    await store.create(archive({ id: "HSI-1:0", docType: "SALES_INVOICE", originalNumber: "DUP-001" }));

    await expect(
      store.create(archive({ id: "HSI-2:0", docType: "SALES_INVOICE", originalNumber: "DUP-001" })),
    ).rejects.toThrow();

    store.close();
  });
});
