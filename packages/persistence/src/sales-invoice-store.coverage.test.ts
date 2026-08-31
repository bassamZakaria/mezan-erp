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
    unitCode: "",
    unitFactor: 1,
    discountType: "percent" as const,
    discountAmount: Money.zero(),
    ...overrides,
    baseQty: overrides.baseQty ?? overrides.qty ?? Qty.fromMajor("2"),
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
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 5 },
    arAccountId: "1300-1",
    taxAccountId: "2200",
    lines: [line()],
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

describe("SqliteSalesInvoiceStore — the fields a row may or may not carry", () => {
  it("round-trips an amount discount as an exact amount, not as a percentage", async () => {
    const repo = store();
    await repo.save(invoice({ discount: { type: "amount", amount: Money.fromMajor("25.50") } }));

    const fetched = await repo.findById("inv-1");
    expect(fetched?.discount).toEqual({ type: "amount", amount: Money.fromMajor("25.50") });
  });

  it("round-trips a line's own amount discount and its alternate unit", async () => {
    const repo = store();
    await repo.save(
      invoice({
        lines: [
          line({
            unitCode: "BOX",
            unitFactor: 12,
            qty: Qty.fromMajor("2"),
            baseQty: Qty.fromMajor("24"),
            discountType: "amount",
            discountAmount: Money.fromMajor("15.00"),
          }),
        ],
      }),
    );

    const fetched = await repo.findById("inv-1");
    const stored = fetched!.lines[0]!;
    expect(stored.unitCode).toBe("BOX");
    expect(stored.unitFactor).toBe(12);
    expect(stored.baseQty.toString()).toBe("24.000000");
    expect(stored.discountType).toBe("amount");
    expect(stored.discountAmount.toString()).toBe("15.000000");
  });

  it("reads a line with no unit back as the base unit, with a factor of one", async () => {
    const repo = store();
    await repo.save(invoice({ lines: [line({ unitCode: "", unitFactor: 1 })] }));

    const stored = (await repo.findById("inv-1"))!.lines[0]!;
    expect(stored.unitCode).toBe("");
    expect(stored.unitFactor).toBe(1);
    expect(stored.baseQty.toString()).toBe(stored.qty.toString());
  });

  it("round-trips the tax-exempt and tax-inclusive flags as real booleans", async () => {
    const repo = store();
    await repo.save(invoice({ customerTaxExempt: true, taxInclusive: true }));

    const fetched = await repo.findById("inv-1");
    expect(fetched?.customerTaxExempt).toBe(true);
    expect(fetched?.taxInclusive).toBe(true);
  });

  it("reports no applied promotion at all for an invoice that carries none", async () => {
    const repo = store();
    await repo.save(invoice());
    expect((await repo.findById("inv-1"))?.appliedPromotion).toBeNull();
  });

  it("round-trips an applied promotion with its per-line discounts", async () => {
    const repo = store();
    await repo.save(
      invoice({
        couponCode: "EID25",
        appliedPromotion: {
          promotionId: "promo-1",
          code: "EID25",
          nameAr: "خصم العيد",
          couponCode: "EID25",
          discountTotal: Money.fromMajor("30.00"),
          lineDiscounts: [{ lineId: "line-1", itemId: "item-1", amount: Money.fromMajor("30.00") }],
          appliedAt: "2026-08-22T11:00:00.000Z",
        },
      }),
    );

    const promotion = (await repo.findById("inv-1"))!.appliedPromotion!;
    expect(promotion.promotionId).toBe("promo-1");
    expect(promotion.code).toBe("EID25");
    expect(promotion.nameAr).toBe("خصم العيد");
    expect(promotion.discountTotal.toString()).toBe("30.000000");
    expect(promotion.lineDiscounts).toHaveLength(1);
    expect(promotion.lineDiscounts[0]!.amount.toString()).toBe("30.000000");
    expect(promotion.appliedAt).toBe("2026-08-22T11:00:00.000Z");
  });

  it("returns null for an invoice that was never saved", async () => {
    const repo = store();
    expect(await repo.findById("nope")).toBeNull();
  });
});

describe("SqliteSalesInvoiceStore — the list's filters and scopes", () => {
  async function seeded() {
    const repo = store();
    await repo.save(invoice({ id: "inv-1", docNo: "INV-000001", status: "confirmed", branchId: "BR1", warehouseId: "WH1" }));
    await repo.save(
      invoice({
        id: "inv-2",
        docNo: "INV-000002",
        status: "draft",
        date: "2026-09-05",
        customerId: "cust-2",
        customerNameAr: "شركة النور",
        branchId: "BR2",
        warehouseId: "WH2",
        salespersonId: "sp-1",
      }),
    );
    await repo.save(invoice({ id: "inv-3", docNo: "INV-000003", branchId: "BR1", warehouseId: "WH1" }));
    return repo;
  }

  it("narrows by status, customer, salesperson, branch, warehouse and both date bounds", async () => {
    const repo = await seeded();
    const ids = async (filter: Parameters<typeof repo.list>[0]) => (await repo.list(filter)).map((i) => i.id);

    expect(await ids({ status: "draft" })).toEqual(expect.arrayContaining(["inv-2", "inv-3"]));
    expect(await ids({ customerId: "cust-2" })).toEqual(["inv-2"]);
    expect(await ids({ salespersonId: "sp-1" })).toEqual(["inv-2"]);
    expect((await ids({ branchId: "BR1" })).sort()).toEqual(["inv-1", "inv-3"]);
    expect(await ids({ warehouseId: "WH2" })).toEqual(["inv-2"]);
    expect(await ids({ fromDate: "2026-09-01" })).toEqual(["inv-2"]);
    expect(await ids({ toDate: "2026-08-31" })).toEqual(expect.arrayContaining(["inv-1", "inv-3"]));
    expect(await ids({ branchId: "BR2" })).toEqual(["inv-2"]);
  });

  it("searches the document number and the customer's name, case-insensitively", async () => {
    const repo = await seeded();
    expect((await repo.list({ search: "inv-000002" })).map((i) => i.id)).toEqual(["inv-2"]);
    expect((await repo.list({ search: "النور" })).map((i) => i.id)).toEqual(["inv-2"]);
    expect(await repo.list({ search: "   " })).toHaveLength(3);
    expect(await repo.list({ search: "nothing-matches" })).toEqual([]);
  });

  it("narrows to the branches a scope names, and to nothing at all for an empty scope", async () => {
    const repo = await seeded();

    const scoped = await repo.list({ branchScope: ["BR1"] });
    expect(scoped.map((i) => i.id).sort()).toEqual(["inv-1", "inv-3"]);

    // An empty scope means the caller may see nothing attributable — not
    // everything, which is how a scope stops scoping.
    expect(await repo.list({ branchScope: [] })).toEqual([]);
  });

  it("scopes by warehouse the same way", async () => {
    const repo = await seeded();
    expect((await repo.list({ warehouseScope: ["WH2"] })).map((i) => i.id)).toEqual(["inv-2"]);
  });

  it("pages the rows and counts the whole filtered set", async () => {
    const repo = await seeded();
    expect(await repo.list({ limit: 2 })).toHaveLength(2);
    expect(await repo.list({ limit: 2, offset: 2 })).toHaveLength(1);
    expect(await repo.count()).toBe(3);
    expect(await repo.count({ status: "confirmed" })).toBe(1);
  });

  it("carries every line back on a paged list, not just on the single-invoice read", async () => {
    const repo = store();
    await repo.save(invoice({ lines: [line(), line({ lineId: "line-2", itemId: "item-2" })] }));

    const [only] = await repo.list();
    expect(only!.lines).toHaveLength(2);
    expect(only!.lines.map((l) => l.lineId)).toEqual(["line-1", "line-2"]);
  });
});
