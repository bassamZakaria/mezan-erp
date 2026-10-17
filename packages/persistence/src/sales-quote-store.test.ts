import { describe, it, expect, afterEach } from "vitest";
import { Money, Qty, type SalesQuote, type SalesQuoteLine } from "@mezan/domain";
import { createSqliteSalesQuoteStore, type SqliteSalesQuoteStoreHandle } from "./sales-quote-store.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function line(overrides: Partial<SalesQuoteLine> = {}): SalesQuoteLine {
  return {
    lineId: "line-1",
    itemId: "item-1",
    itemNameAr: "منتج ١",
    qty: Qty.fromMajor("2"),
    unitPrice: Money.fromMajor("100"),
    discountPercent: 0,
    taxRatePercent: 14,
    taxRateId: null,
    ...overrides,
  };
}

function quote(overrides: Partial<SalesQuote> = {}): SalesQuote {
  return {
    id: "qt-1",
    docType: "SALES_QUOTE",
    docNo: null,
    status: "draft",
    date: "2026-08-22",
    expiryDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "عميل ١",
    customerTaxExempt: false,
    branchId: "branch-1",
    opportunityId: null,
    currency: "EGP",
    notes: "ملاحظات",
    internalNotes: "داخلي",
    discount: { type: "percent", percent: 5 },
    priceListId: null,
    couponCode: null,
    lines: [line(), line({ lineId: "line-2", itemId: "item-2" })],
    createdAt: "2026-08-22T10:00:00.000Z",
    sentAt: null,
    respondedAt: null,
    convertedAt: null,
    convertedInvoiceId: null,
    ...overrides,
  };
}

function store(): SqliteSalesQuoteStoreHandle {
  const s = createSqliteSalesQuoteStore();
  closers.push(s);
  return s;
}

describe("SqliteSalesQuoteStore — round trip", () => {
  it("save then findById returns an identical quote", async () => {
    const repo = store();
    const q = quote();
    await repo.save(q);

    const fetched = await repo.findById(q.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.docNo).toBe(q.docNo);
    expect(fetched?.status).toBe("draft");
    expect(fetched?.customerId).toBe("cust-1");
    expect(fetched?.customerTaxExempt).toBe(false);
    expect(fetched?.discount).toEqual({ type: "percent", percent: 5 });
    expect(fetched?.lines).toHaveLength(2);
    expect(fetched?.lines[0]?.lineId).toBe("line-1");
    expect(fetched?.lines[0]?.qty.toString()).toBe(Qty.fromMajor("2").toString());
    expect(fetched?.lines[0]?.unitPrice.toString()).toBe(Money.fromMajor("100").toString());
    expect(fetched?.lines[1]?.itemId).toBe("item-2");
  });

  it("round-trips an amount-type discount, priceListId and couponCode", async () => {
    const repo = store();
    const q = quote({
      id: "qt-amt",
      discount: { type: "amount", amount: Money.fromMajor("25.50") },
      priceListId: "pl-1",
      couponCode: "SAVE10",
    });
    await repo.save(q);

    const fetched = await repo.findById(q.id);
    expect(fetched?.discount.type).toBe("amount");
    if (fetched?.discount.type === "amount") {
      expect(fetched.discount.amount.toString()).toBe(Money.fromMajor("25.50").toString());
    }
    expect(fetched?.priceListId).toBe("pl-1");
    expect(fetched?.couponCode).toBe("SAVE10");
  });
});

describe("SqliteSalesQuoteStore — list with filter", () => {
  it("filters by status, customerId, and date range", async () => {
    const repo = store();
    await repo.save(quote({ id: "qt-1", customerId: "cust-1", status: "draft", date: "2026-08-01" }));
    await repo.save(quote({ id: "qt-2", customerId: "cust-1", status: "sent", date: "2026-08-10" }));
    await repo.save(quote({ id: "qt-3", customerId: "cust-2", status: "sent", date: "2026-08-15" }));

    const byStatus = await repo.list({ status: "sent" });
    expect(byStatus.map((q) => q.id).sort()).toEqual(["qt-2", "qt-3"]);

    const byCustomer = await repo.list({ customerId: "cust-1" });
    expect(byCustomer.map((q) => q.id).sort()).toEqual(["qt-1", "qt-2"]);

    const byDateRange = await repo.list({ fromDate: "2026-08-05", toDate: "2026-08-12" });
    expect(byDateRange.map((q) => q.id)).toEqual(["qt-2"]);

    const all = await repo.list();
    expect(all.map((q) => q.date)).toEqual(["2026-08-01", "2026-08-10", "2026-08-15"]);
  });
});

describe("SqliteSalesQuoteStore — update on send/accept/convert", () => {
  it("persists docNo, status, sentAt/respondedAt/convertedAt after transitions", async () => {
    const repo = store();
    const draft = quote({ id: "qt-confirm", status: "draft" });
    await repo.save(draft);

    const sent: SalesQuote = {
      ...draft,
      status: "sent",
      docNo: "QT-000001",
      sentAt: "2026-08-22T11:00:00.000Z",
    };
    await repo.update(sent);

    let fetched = await repo.findById("qt-confirm");
    expect(fetched?.status).toBe("sent");
    expect(fetched?.docNo).toBe("QT-000001");
    expect(fetched?.sentAt).toBe("2026-08-22T11:00:00.000Z");

    const accepted: SalesQuote = {
      ...sent,
      status: "accepted",
      respondedAt: "2026-08-22T12:00:00.000Z",
    };
    await repo.update(accepted);
    fetched = await repo.findById("qt-confirm");
    expect(fetched?.status).toBe("accepted");
    expect(fetched?.respondedAt).toBe("2026-08-22T12:00:00.000Z");

    const converted: SalesQuote = {
      ...accepted,
      status: "converted",
      convertedAt: "2026-08-22T13:00:00.000Z",
      convertedInvoiceId: "inv-1",
    };
    await repo.update(converted);
    fetched = await repo.findById("qt-confirm");
    expect(fetched?.status).toBe("converted");
    expect(fetched?.convertedAt).toBe("2026-08-22T13:00:00.000Z");
    expect(fetched?.convertedInvoiceId).toBe("inv-1");
    expect(fetched?.lines).toHaveLength(2);
  });

  it("runs inside transaction() atomically", async () => {
    const repo = store();
    const q = quote({ id: "qt-txn" });
    await repo.transaction(async () => {
      await repo.save(q);
    });
    expect(await repo.findById("qt-txn")).not.toBeNull();
  });
});
