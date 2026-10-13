import { describe, expect, it, afterEach } from "vitest";
import { Money, Qty } from "@mezan/domain";
import { createSqliteSalesInvoiceStore, type SqliteSalesInvoiceStoreHandle } from "./sales-invoice-store.js";

/**
 * guards N-9 — every write to a document must move its row version, or a second
 * till holding the older one is undetectable and its edit vanishes silently.
 */

const closers: SqliteSalesInvoiceStoreHandle[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function invoice(id: string) {
  return {
    id,
    docType: "SALES_INVOICE" as const,
    docNo: "INV-000001",
    status: "draft" as const,
    date: "2026-09-01",
    dueDate: "2026-09-30",
    customerId: "cust-1",
    customerNameAr: "عميل",
    customerTaxExempt: false,
    projectId: null,
    taxInclusive: false,
    warehouseId: "wh-1",
    branchId: "br-1",
    salespersonId: null,
    salespersonNameAr: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    fxRate: null,
    notes: null,
    internalNotes: null,
    discount: { type: "percent" as const, percent: 0, amount: Money.zero() },
    arAccountId: "1105",
    taxAccountId: "2200",
    amountPaid: Money.zero(),
    createdAt: "2026-09-01T08:00:00.000Z",
    confirmedAt: null,
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    lines: [
      {
        lineId: "l1",
        itemId: "item-1",
        itemNameAr: "صنف",
        isStock: true,
        qty: Qty.fromMajor("1"),
        baseQty: Qty.fromMajor("1"),
        unitCode: "",
        unitFactor: 1,
        unitPrice: Money.fromMajor("100"),
        discountType: "percent" as const,
        discountPercent: 0,
        discountAmount: Money.zero(),
        taxRatePercent: 0,
        revenueAccountId: "4100",
        cogsAccountId: null,
        inventoryAccountId: null,
        unitCost: null,
        taxRateId: null,
        costCenterId: null,
      },
    ],
  };
}

describe("the document row version", () => {
  it("starts at 1 and moves on every update, whichever path made the change", async () => {
    const store = createSqliteSalesInvoiceStore();
    closers.push(store);
    const doc = invoice("inv-1");
    await store.save(doc);
    expect((await store.versions.read("inv-1"))!.version).toBe(1);

    await store.update({ ...doc, notes: "أول تعديل" });
    expect((await store.versions.read("inv-1"))!.version).toBe(2);

    await store.update({ ...doc, notes: "ثانٍ" });
    expect((await store.versions.read("inv-1"))!.version).toBe(3);
  });

  it("records who made the change that won, so the next stale caller can be told", async () => {
    const store = createSqliteSalesInvoiceStore();
    closers.push(store);
    await store.save(invoice("inv-2"));
    expect((await store.versions.read("inv-2"))!.lastModifiedBy).toBeNull();

    await store.versions.stampModifier("inv-2", "u-7");
    expect((await store.versions.read("inv-2"))!.lastModifiedBy).toBe("u-7");
  });

  it("reads null for a document that does not exist", async () => {
    const store = createSqliteSalesInvoiceStore();
    closers.push(store);
    expect(await store.versions.read("nope")).toBeNull();
  });

  // guards N-9 — a list serializer has to carry the version of EVERY row it
  // serves, and it may not pay a query per row to do it.
  it("reads a whole page of versions at once, skipping ids it does not hold", async () => {
    const store = createSqliteSalesInvoiceStore();
    closers.push(store);
    await store.save({ ...invoice("inv-a"), docNo: "INV-000010" });
    await store.save({ ...invoice("inv-b"), docNo: "INV-000011" });
    await store.update({ ...invoice("inv-b"), docNo: "INV-000011", notes: "moved" });

    const versions = await store.versions.readMany(["inv-a", "inv-b", "missing"]);
    expect(versions.get("inv-a")).toBe(1);
    expect(versions.get("inv-b")).toBe(2);
    expect(versions.has("missing")).toBe(false);
  });

  it("reads an empty page without touching the database", async () => {
    const store = createSqliteSalesInvoiceStore();
    closers.push(store);
    expect((await store.versions.readMany([])).size).toBe(0);
  });
});
