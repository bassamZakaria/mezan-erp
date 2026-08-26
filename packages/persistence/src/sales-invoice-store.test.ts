import { describe, it, expect, afterEach } from "vitest";
import { Money, Qty, type SalesInvoice, type SalesInvoiceLine } from "@mezan/domain";
import { createSqliteSalesInvoiceStore, type SqliteSalesInvoiceStoreHandle } from "./sales-invoice-store.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function line(overrides: Partial<SalesInvoiceLine> = {}): SalesInvoiceLine {
  return {
    lineId: "line-1",
    itemId: "item-1",
    itemNameAr: "منتج ١",
    isStock: true,
    qty: Qty.fromMajor("2"),
    unitPrice: Money.fromMajor("100"),
    discountPercent: 0,
    taxRatePercent: 14,
    revenueAccountId: "4000",
    cogsAccountId: "5000",
    inventoryAccountId: "1200",
    unitCost: null,
    unitCode: "", unitFactor: 1, discountType: "percent" as const, discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("1"),
  };
}

function invoice(overrides: Partial<SalesInvoice> = {}): SalesInvoice {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: null,
    status: "draft",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "عميل ١",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "wh-1",
    branchId: "branch-1",
    salespersonId: null,
    salespersonNameAr: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: "ملاحظات",
    internalNotes: "داخلي",
    discount: { type: "percent", percent: 5 },
    arAccountId: "1300-1",
    taxAccountId: "2200",
    lines: [line(), line({ lineId: "line-2", itemId: "item-2" })],
    amountPaid: Money.zero(),
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: null,
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
    ...overrides,
  };
}

function store(): SqliteSalesInvoiceStoreHandle {
  const s = createSqliteSalesInvoiceStore();
  closers.push(s);
  return s;
}

describe("SqliteSalesInvoiceStore — round trip", () => {
  it("save then findById returns an identical invoice", async () => {
    const repo = store();
    const inv = invoice();
    await repo.save(inv);

    const fetched = await repo.findById(inv.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.docNo).toBe(inv.docNo);
    expect(fetched?.status).toBe("draft");
    expect(fetched?.customerId).toBe("cust-1");
    expect(fetched?.customerTaxExempt).toBe(false);
    expect(fetched?.discount).toEqual({ type: "percent", percent: 5 });
    expect(fetched?.amountPaid.toString()).toBe(Money.zero().toString());
    expect(fetched?.lines).toHaveLength(2);
    expect(fetched?.lines[0]?.lineId).toBe("line-1");
    expect(fetched?.lines[0]?.qty.toString()).toBe(Qty.fromMajor("2").toString());
    expect(fetched?.lines[0]?.unitPrice.toString()).toBe(Money.fromMajor("100").toString());
    expect(fetched?.lines[0]?.unitCost).toBeNull();
    expect(fetched?.lines[1]?.itemId).toBe("item-2");
  });

  it("round-trips an amount-type discount", async () => {
    const repo = store();
    const inv = invoice({
      id: "inv-amt",
      discount: { type: "amount", amount: Money.fromMajor("25.50") },
    });
    await repo.save(inv);

    const fetched = await repo.findById(inv.id);
    expect(fetched?.discount.type).toBe("amount");
    if (fetched?.discount.type === "amount") {
      expect(fetched.discount.amount.toString()).toBe(Money.fromMajor("25.50").toString());
    }
  });
});

describe("SqliteSalesInvoiceStore — list with filter", () => {
  it("filters by status, customerId, and date range", async () => {
    const repo = store();
    await repo.save(invoice({ id: "inv-1", customerId: "cust-1", status: "draft", date: "2026-08-01" }));
    await repo.save(invoice({ id: "inv-2", customerId: "cust-1", status: "confirmed", date: "2026-08-10" }));
    await repo.save(invoice({ id: "inv-3", customerId: "cust-2", status: "confirmed", date: "2026-08-15" }));

    const byStatus = await repo.list({ status: "confirmed" });
    expect(byStatus.map((i) => i.id).sort()).toEqual(["inv-2", "inv-3"]);

    const byCustomer = await repo.list({ customerId: "cust-1" });
    expect(byCustomer.map((i) => i.id).sort()).toEqual(["inv-1", "inv-2"]);

    const byDateRange = await repo.list({ fromDate: "2026-08-05", toDate: "2026-08-12" });
    expect(byDateRange.map((i) => i.id)).toEqual(["inv-2"]);

    const all = await repo.list();
    expect(all.map((i) => i.date)).toEqual(["2026-08-01", "2026-08-10", "2026-08-15"]);
  });
});

describe("SqliteSalesInvoiceStore — update on confirm", () => {
  it("persists docNo, journalEntryId, status, and line unitCost after confirm", async () => {
    const repo = store();
    const draft = invoice({ id: "inv-confirm", status: "draft" });
    await repo.save(draft);

    const confirmed: SalesInvoice = {
      ...draft,
      status: "confirmed",
      docNo: "INV-000001",
      confirmedAt: "2026-08-22T11:00:00.000Z",
      journalEntryId: "je-1",
      lines: draft.lines.map((l) => ({ ...l, unitCost: Money.fromMajor("60") })),
    };
    await repo.update(confirmed);

    const fetched = await repo.findById("inv-confirm");
    expect(fetched?.status).toBe("confirmed");
    expect(fetched?.docNo).toBe("INV-000001");
    expect(fetched?.journalEntryId).toBe("je-1");
    expect(fetched?.confirmedAt).toBe("2026-08-22T11:00:00.000Z");
    expect(fetched?.lines).toHaveLength(2);
    expect(fetched?.lines[0]?.unitCost?.toString()).toBe(Money.fromMajor("60").toString());
    expect(fetched?.lines[1]?.unitCost?.toString()).toBe(Money.fromMajor("60").toString());
  });

  it("runs inside transaction() atomically", async () => {
    const repo = store();
    const inv = invoice({ id: "inv-txn" });
    await repo.transaction(async () => {
      await repo.save(inv);
    });
    expect(await repo.findById("inv-txn")).not.toBeNull();
  });
});
