import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";

let kit: BackendKit;

beforeAll(async () => {
  kit = await bootBackendKit();
  const settings = (await kit.call("GET", "/settings")).body;
  expect((await kit.call("PUT", "/settings", { ...settings, taxCalculation: "INCLUSIVE" })).status).toBe(200);
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("on a tenant whose prices include VAT, a derived invoice keeps the pricing of the document it came from", () => {
  it("a converted quote bills exactly the quote's total", async () => {
    const quote = await kit.call("POST", "/sales-quotes", {
      id: "INC-Q", date: TODAY, expiryDate: "2026-09-30", customerId: "CUST-DEMO-1", customerNameAr: "عميل", branchId: "BR-MAIN",
      lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", qty: "1", unitPrice: "100", taxRateId: "VAT14" }],
    });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    expect(quote.body.totals.grandTotal).toBe("114.000000");
    for (const action of ["send", "accept"]) expect((await kit.call("POST", `/sales-quotes/INC-Q/${action}`, {})).status).toBe(200);
    const converted = await kit.call("POST", "/sales-quotes/INC-Q/convert-to-invoice", {
      id: "INC-Q-I", dueDate: "2026-09-30", warehouseId: "WH-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "A", isStock: false, revenueAccountId: "4100" }],
    });
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
    const invoice = (await kit.call("GET", "/sales-invoices/INC-Q-I")).body;
    expect([invoice.taxInclusive, invoice.totals.taxableTotal, invoice.totals.taxTotal, invoice.totals.grandTotal]).toEqual([false, "100.000000", "14.000000", "114.000000"]);
  });

  it("an invoice raised directly still reads its prices as VAT-inclusive", async () => {
    const draft = await kit.call("POST", "/sales-invoices", {
      id: "INC-DIRECT", date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
      arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "A", itemId: "ITEM-DEMO-10", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "114", revenueAccountId: "4100", taxRateId: "VAT14" }],
    });
    expect([draft.status, draft.body.taxInclusive, draft.body.totals.grandTotal]).toEqual([201, true, "114.000000"]);
  });

  it("a certificate's invoice bills the certificate's base and VAT as the certificate computed them", async () => {
    const before = (await kit.call("GET", "/contracting/certificates/MST-DEMO-4")).body;
    const approved = await kit.call("POST", "/contracting/certificates/MST-DEMO-4/approve", { approvedAt: "2026-09-08" });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const certificate = (await kit.call("GET", "/contracting/certificates/MST-DEMO-4")).body;
    const invoice = (await kit.call("GET", `/sales-invoices/${certificate.invoiceId}`)).body;
    expect(invoice.taxInclusive).toBe(false);
    expect([invoice.totals.taxableTotal, invoice.totals.taxTotal]).toEqual([before.computed.invoiceBase, before.computed.vat]);
    expect(invoice.totals.grandTotal).toBe("2260855.660000");
  });
});
