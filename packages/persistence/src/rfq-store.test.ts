import { describe, it, expect } from "vitest";
import { Money, Qty, type PurchaseRfq, type RfqQuote } from "@mezan/domain";
import { createSqliteRfqStores } from "./rfq-store.js";

function rfq(overrides: Partial<PurchaseRfq> = {}): PurchaseRfq {
  return {
    id: "rfq-1",
    number: "RFQ-000001",
    date: "2026-08-21",
    requiredByDate: "2026-08-28",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    notes: "عاجل",
    lines: [
      { itemId: "item-A", description: null, qty: Qty.fromMajor("10"), notes: null },
      { itemId: "item-B", description: "بديل مقبول", qty: Qty.fromMajor("3.5"), notes: "بديل" },
    ],
    status: "draft",
    purchaseOrderId: null,
    createdBy: "user-1",
    createdAt: "2026-08-21T09:00:00.000Z",
    ...overrides,
  };
}

function quote(overrides: Partial<RfqQuote> = {}): RfqQuote {
  return {
    id: "quote-1",
    rfqId: "rfq-1",
    supplierId: "sup-1",
    lines: [
      { itemId: "item-A", unitPrice: Money.fromMajor("25.50"), notes: null },
      { itemId: "item-B", unitPrice: Money.fromMajor("100.00"), notes: "شامل الشحن" },
    ],
    notes: "عرض صالح لمدة أسبوع",
    submittedAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("SQLite RFQ stores", () => {
  it("shares one connection between rfqs and quotes", async () => {
    const stores = createSqliteRfqStores(":memory:");
    expect(stores.rfqs).toBeDefined();
    expect(stores.quotes).toBeDefined();
    stores.close();
  });

  it("round-trips an RFQ including Qty lines", async () => {
    const stores = createSqliteRfqStores(":memory:");
    await stores.rfqs.create(rfq());

    const found = await stores.rfqs.findById("rfq-1");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("rfq-1");
    expect(found?.number).toBe("RFQ-000001");
    expect(found?.date).toBe("2026-08-21");
    expect(found?.requiredByDate).toBe("2026-08-28");
    expect(found?.branchId).toBe("MAIN");
    expect(found?.warehouseId).toBe("MAIN-WH");
    expect(found?.notes).toBe("عاجل");
    expect(found?.status).toBe("draft");
    expect(found?.purchaseOrderId).toBeNull();
    expect(found?.createdBy).toBe("user-1");
    expect(found?.createdAt).toBe("2026-08-21T09:00:00.000Z");

    expect(found?.lines).toHaveLength(2);
    expect(found?.lines[0]?.itemId).toBe("item-A");
    expect(found?.lines[0]?.description).toBeNull();
    expect(found?.lines[0]?.qty.compare(Qty.fromMajor("10"))).toBe(0);
    expect(found?.lines[0]?.qty.toString()).toBe(Qty.fromMajor("10").toString());
    expect(found?.lines[1]?.itemId).toBe("item-B");
    expect(found?.lines[1]?.description).toBe("بديل مقبول");
    expect(found?.lines[1]?.qty.compare(Qty.fromMajor("3.5"))).toBe(0);
    expect(found?.lines[1]?.notes).toBe("بديل");

    stores.close();
  });

  it("findById returns null for a missing RFQ", async () => {
    const stores = createSqliteRfqStores(":memory:");
    expect(await stores.rfqs.findById("nope")).toBeNull();
    stores.close();
  });

  it("list() returns every created RFQ", async () => {
    const stores = createSqliteRfqStores(":memory:");
    await stores.rfqs.create(rfq({ id: "rfq-1", number: "RFQ-000001" }));
    await stores.rfqs.create(rfq({ id: "rfq-2", number: "RFQ-000002" }));
    const all = await stores.rfqs.list();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.id).sort()).toEqual(["rfq-1", "rfq-2"]);
    stores.close();
  });

  it("update() persists a status transition and purchaseOrderId", async () => {
    const stores = createSqliteRfqStores(":memory:");
    await stores.rfqs.create(rfq());

    const draft = await stores.rfqs.findById("rfq-1");
    const sent: PurchaseRfq = { ...draft!, status: "sent" };
    await stores.rfqs.update(sent);
    expect((await stores.rfqs.findById("rfq-1"))?.status).toBe("sent");

    const closed: PurchaseRfq = { ...sent, status: "closed", purchaseOrderId: "po-9" };
    await stores.rfqs.update(closed);
    const reloaded = await stores.rfqs.findById("rfq-1");
    expect(reloaded?.status).toBe("closed");
    expect(reloaded?.purchaseOrderId).toBe("po-9");

    stores.close();
  });

  it("round-trips a quote including Money unit prices", async () => {
    const stores = createSqliteRfqStores(":memory:");
    await stores.rfqs.create(rfq());
    await stores.quotes.create(quote());

    const found = await stores.quotes.findById("quote-1");
    expect(found).not.toBeNull();
    expect(found?.rfqId).toBe("rfq-1");
    expect(found?.supplierId).toBe("sup-1");
    expect(found?.notes).toBe("عرض صالح لمدة أسبوع");
    expect(found?.submittedAt).toBe("2026-08-22T10:00:00.000Z");
    expect(found?.lines).toHaveLength(2);
    expect(found?.lines[0]?.unitPrice.equals(Money.fromMajor("25.50"))).toBe(true);
    expect(found?.lines[1]?.unitPrice.equals(Money.fromMajor("100.00"))).toBe(true);
    expect(found?.lines[1]?.notes).toBe("شامل الشحن");

    stores.close();
  });

  it("findById on quotes returns null for a missing id", async () => {
    const stores = createSqliteRfqStores(":memory:");
    expect(await stores.quotes.findById("nope")).toBeNull();
    stores.close();
  });

  it("listByRfq returns only quotes for that RFQ", async () => {
    const stores = createSqliteRfqStores(":memory:");
    await stores.rfqs.create(rfq({ id: "rfq-1" }));
    await stores.rfqs.create(rfq({ id: "rfq-2", number: "RFQ-000002" }));

    await stores.quotes.create(quote({ id: "quote-1", rfqId: "rfq-1", supplierId: "sup-1" }));
    await stores.quotes.create(quote({ id: "quote-2", rfqId: "rfq-1", supplierId: "sup-2" }));
    await stores.quotes.create(quote({ id: "quote-3", rfqId: "rfq-2", supplierId: "sup-1" }));

    const forRfq1 = await stores.quotes.listByRfq("rfq-1");
    expect(forRfq1).toHaveLength(2);
    expect(forRfq1.map((q) => q.id).sort()).toEqual(["quote-1", "quote-2"]);

    const forRfq2 = await stores.quotes.listByRfq("rfq-2");
    expect(forRfq2).toHaveLength(1);
    expect(forRfq2[0]?.id).toBe("quote-3");

    stores.close();
  });
});
