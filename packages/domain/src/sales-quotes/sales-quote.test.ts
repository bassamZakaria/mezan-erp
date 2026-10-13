import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import {
  SalesQuoteService,
  computeQuoteTotals,
  canSalesQuoteTransition,
  isQuoteExpired,
  InvalidSalesQuoteError,
  InvalidSalesQuoteTransitionError,
  SalesQuoteNotFoundError,
  type CreateSalesQuoteCommand,
  type SalesQuoteLine,
} from "./index.js";
import { InMemorySalesQuoteRepository } from "./test-helpers/in-memory-sales-quote-repository.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";
import { TaxRateNotFoundError, TaxRatePercentMismatchError, type TaxRate } from "../tax-rates/index.js";

const NOW = "2026-08-22T10:00:00.000Z";

function harness() {
  const repo = new InMemorySalesQuoteRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());
  const svc = new SalesQuoteService({
    repo,
    numbering: { next: () => numbering.next("SALES_QUOTE") },
    now: () => NOW,
    actor: "u1",
  });
  return { svc, repo };
}

function line(overrides: Partial<SalesQuoteLine> & { lineId: string; itemId: string }): SalesQuoteLine {
  return {
    itemNameAr: overrides.itemId,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("0"),
    discountPercent: 0,
    taxRatePercent: 0,
    taxRateId: null,
    ...overrides,
  };
}

function draftCmd(overrides: Partial<CreateSalesQuoteCommand> = {}): CreateSalesQuoteCommand {
  return {
    id: "qt-1",
    date: "2026-08-22",
    expiryDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    branchId: "BR1",
    lines: [
      { lineId: "L1", itemId: "ITEM-A", itemNameAr: "صنف أ", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25"), taxRatePercent: 14 },
      { lineId: "L2", itemId: "SVC-1", itemNameAr: "خدمة تركيب", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("50"), discountPercent: 10, taxRatePercent: 14 },
    ],
    ...overrides,
  };
}

/* ================================================================== */
/* 1. Totals + rounding                                                */
/* ================================================================== */

describe("computeQuoteTotals — totals, discounts, tax, rounding", () => {
  it("computes line extension, line discount, tax and grand total to the cent", () => {
    const totals = computeQuoteTotals(
      [
        line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25"), taxRatePercent: 14 }),
        line({ lineId: "L2", itemId: "S", qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("50"), discountPercent: 10, taxRatePercent: 14 }),
      ],
      { type: "amount", amount: Money.zero() },
    );
    expect(totals.grossTotal.toString()).toBe("350.000000");
    expect(totals.lineDiscountTotal.toString()).toBe("10.000000");
    expect(totals.subtotal.toString()).toBe("340.000000");
    expect(totals.taxableTotal.toString()).toBe("340.000000");
    expect(totals.taxTotal.toString()).toBe("47.600000"); // 250*14% + 90*14%
    expect(totals.grandTotal.toString()).toBe("387.600000");
  });

  it("rounds tax HALF_UP at the minor unit", () => {
    // 33.33 * 14% = 4.6662 → 4.67
    const totals = computeQuoteTotals(
      [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("33.33"), taxRatePercent: 14 })],
      { type: "amount", amount: Money.zero() },
    );
    expect(totals.lines[0]?.tax.toString()).toBe("4.670000");
    expect(totals.grandTotal.toString()).toBe("38.000000");
  });

  it("allocates a quote-level discount across lines by largest remainder, reconciling to the cent", () => {
    const totals = computeQuoteTotals(
      [
        line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
        line({ lineId: "L2", itemId: "B", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
        line({ lineId: "L3", itemId: "C", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
      ],
      { type: "amount", amount: Money.fromMajor("10") },
    );
    const allocated = totals.lines.map((l) => l.invoiceDiscount.toString());
    expect(allocated).toEqual(["3.340000", "3.330000", "3.330000"]);
    expect(Money.sum(totals.lines.map((l) => l.invoiceDiscount)).toString()).toBe("10.000000");
    expect(totals.taxableTotal.toString()).toBe("290.000000");
    expect(totals.grandTotal.toString()).toBe("290.000000");
  });

  it("applies a percentage quote discount on the post-line-discount subtotal", () => {
    const totals = computeQuoteTotals(
      [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("200"), taxRatePercent: 0 })],
      { type: "percent", percent: 5 },
    );
    expect(totals.invoiceDiscountTotal.toString()).toBe("10.000000");
    expect(totals.grandTotal.toString()).toBe("190.000000");
  });

  it("forces tax to zero for a tax-exempt customer", () => {
    const totals = computeQuoteTotals(
      [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 14 })],
      { type: "amount", amount: Money.zero() },
      { taxExempt: true },
    );
    expect(totals.taxTotal.toString()).toBe("0.000000");
    expect(totals.grandTotal.toString()).toBe("100.000000");
  });
});

/* ================================================================== */
/* 2. Lifecycle                                                        */
/* ================================================================== */

describe("SalesQuoteService lifecycle", () => {
  it("create → send → accept → markConverted", async () => {
    const { svc } = harness();
    const draft = await svc.createDraft(draftCmd());
    expect(draft.status).toBe("draft");
    expect(draft.docNo).toBeNull();

    const sent = await svc.send("qt-1");
    expect(sent.status).toBe("sent");
    expect(sent.docNo).toBe("QT-000001");
    expect(sent.sentAt).toBe(NOW);

    const accepted = await svc.accept("qt-1");
    expect(accepted.status).toBe("accepted");
    expect(accepted.respondedAt).toBe(NOW);

    const converted = await svc.markConverted("qt-1", "inv-99");
    expect(converted.status).toBe("converted");
    expect(converted.convertedAt).toBe(NOW);
    expect(converted.convertedInvoiceId).toBe("inv-99");
  });

  it("create → send → reject", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd({ id: "qt-2" }));
    await svc.send("qt-2");
    const rejected = await svc.reject("qt-2");
    expect(rejected.status).toBe("rejected");
    expect(rejected.respondedAt).toBe(NOW);
  });

  it("create → cancel (from draft)", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd({ id: "qt-3" }));
    const cancelled = await svc.cancel("qt-3");
    expect(cancelled.status).toBe("cancelled");
  });

  it("cancel is permitted from sent and accepted too", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd({ id: "qt-4" }));
    await svc.send("qt-4");
    const cancelledFromSent = await svc.cancel("qt-4");
    expect(cancelledFromSent.status).toBe("cancelled");

    await svc.createDraft(draftCmd({ id: "qt-5" }));
    await svc.send("qt-5");
    await svc.accept("qt-5");
    const cancelledFromAccepted = await svc.cancel("qt-5");
    expect(cancelledFromAccepted.status).toBe("cancelled");
  });

  it("allocates sequential doc numbers across multiple sends", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd({ id: "qt-a" }));
    await svc.createDraft(draftCmd({ id: "qt-b" }));
    const a = await svc.send("qt-a");
    const b = await svc.send("qt-b");
    expect(a.docNo).toBe("QT-000001");
    expect(b.docNo).toBe("QT-000002");
  });

  it("rejects invalid transitions", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd({ id: "qt-6" }));
    // draft cannot go straight to accepted
    await expect(svc.accept("qt-6")).rejects.toBeInstanceOf(InvalidSalesQuoteTransitionError);

    await svc.send("qt-6");
    await svc.accept("qt-6");
    // accepted -> rejected is not permitted
    await expect(svc.reject("qt-6")).rejects.toBeInstanceOf(InvalidSalesQuoteTransitionError);

    await svc.markConverted("qt-6", "inv-1");
    // converted is terminal
    await expect(svc.cancel("qt-6")).rejects.toBeInstanceOf(InvalidSalesQuoteTransitionError);
  });

  it("rejects a duplicate id on createDraft", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd({ id: "qt-dup" }));
    await expect(svc.createDraft(draftCmd({ id: "qt-dup" }))).rejects.toBeInstanceOf(DuplicateRecordIdError);
  });

  it("rejects validation failures on createDraft", async () => {
    const { svc } = harness();
    await expect(svc.createDraft(draftCmd({ customerId: "" }))).rejects.toBeInstanceOf(InvalidSalesQuoteError);
    await expect(svc.createDraft(draftCmd({ branchId: "" }))).rejects.toBeInstanceOf(InvalidSalesQuoteError);
    await expect(svc.createDraft(draftCmd({ lines: [] }))).rejects.toBeInstanceOf(InvalidSalesQuoteError);
    await expect(
      svc.createDraft(
        draftCmd({ lines: [line({ lineId: "L1", itemId: "A", qty: Qty.zero() })] }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesQuoteError);
    await expect(
      svc.createDraft(
        draftCmd({ lines: [line({ lineId: "L1", itemId: "A", discountPercent: 150 })] }),
      ),
    ).rejects.toBeInstanceOf(InvalidSalesQuoteError);
  });

  it("blocks sending a quote whose total is zero", async () => {
    const { svc } = harness();
    await svc.createDraft(
      draftCmd({
        id: "qt-zero",
        lines: [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.zero() })],
      }),
    );
    await expect(svc.send("qt-zero")).rejects.toBeInstanceOf(InvalidSalesQuoteError);
  });

  it("throws SalesQuoteNotFoundError on mutating a missing id", async () => {
    const { svc } = harness();
    await expect(svc.send("missing")).rejects.toBeInstanceOf(SalesQuoteNotFoundError);
    await expect(svc.accept("missing")).rejects.toBeInstanceOf(SalesQuoteNotFoundError);
    await expect(svc.reject("missing")).rejects.toBeInstanceOf(SalesQuoteNotFoundError);
    await expect(svc.cancel("missing")).rejects.toBeInstanceOf(SalesQuoteNotFoundError);
    await expect(svc.markConverted("missing", "inv-1")).rejects.toBeInstanceOf(SalesQuoteNotFoundError);
  });
});

/* ================================================================== */
/* 3. Status transitions + expiry                                      */
/* ================================================================== */

describe("sales-quote lifecycle transitions", () => {
  it("permits the canonical transitions and forbids illegal ones", () => {
    expect(canSalesQuoteTransition("draft", "sent")).toBe(true);
    expect(canSalesQuoteTransition("draft", "cancelled")).toBe(true);
    expect(canSalesQuoteTransition("sent", "accepted")).toBe(true);
    expect(canSalesQuoteTransition("sent", "rejected")).toBe(true);
    expect(canSalesQuoteTransition("accepted", "converted")).toBe(true);

    expect(canSalesQuoteTransition("draft", "accepted")).toBe(false);
    expect(canSalesQuoteTransition("rejected", "accepted")).toBe(false);
    expect(canSalesQuoteTransition("converted", "cancelled")).toBe(false);
  });
});

describe("isQuoteExpired", () => {
  it("is true only for a live (sent/accepted) quote past its expiry date", async () => {
    const { svc } = harness();
    const draft = await svc.createDraft(draftCmd({ id: "qt-exp", expiryDate: "2026-08-01" }));
    expect(isQuoteExpired(draft, "2026-08-22")).toBe(false); // still draft

    const sent = await svc.send("qt-exp");
    expect(isQuoteExpired(sent, "2026-08-22")).toBe(true);
    expect(isQuoteExpired(sent, "2026-07-01")).toBe(false);
  });
});

describe("SalesQuoteService.createDraft — the tax rate's identity (D79)", () => {
  const rate = (id: string, percent: number): TaxRate => ({
    id, code: id, name: id, rate: percent, calculationType: "exclusive", isDefault: false,
    outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active",
  });
  const MASTER = [rate("VAT14", 14), rate("EXEMPT", 0), rate("EXPORT", 0)];

  function service() {
    const numbering = new NextNumberService(new InMemorySequenceStore());
    return new SalesQuoteService({
      repo: new InMemorySalesQuoteRepository(),
      numbering: { next: () => numbering.next("SALES_QUOTE") },
      taxRates: { list: async () => MASTER },
      now: () => NOW,
      actor: "u1",
    });
  }
  const quoted = (lineId: string, tax: { taxRateId?: string; taxRatePercent?: number }) => ({
    lineId, itemId: "ITEM-A", itemNameAr: "صنف أ", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), ...tax,
  });

  it("stores the picked rate's id, with the percent read off the rate", async () => {
    const quote = await service().createDraft(draftCmd({ lines: [quoted("L1", { taxRateId: "EXPORT" }), quoted("L2", { taxRatePercent: 14 }), quoted("L3", { taxRatePercent: 0 })] }));
    expect(quote.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["EXPORT", 0], ["VAT14", 14], [null, 0]]);
  });

  it("refuses a rate id no tax rate has, and a percent that is not the rate's own", async () => {
    await expect(service().createDraft(draftCmd({ lines: [quoted("L1", { taxRateId: "TAX-1" })] }))).rejects.toBeInstanceOf(TaxRateNotFoundError);
    await expect(service().createDraft(draftCmd({ lines: [quoted("L1", { taxRateId: "EXEMPT", taxRatePercent: 14 })] }))).rejects.toBeInstanceOf(TaxRatePercentMismatchError);
  });

  it("never stamps a taxed rate's id on a line a tax-exempt customer is quoted at 0%", async () => {
    const quote = await service().createDraft(draftCmd({ customerTaxExempt: true, lines: [quoted("L1", { taxRateId: "VAT14" })] }));
    expect(quote.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
  });

  it("quotes a tax-exempt customer under the 0% rate on the customer's card (D79 round 4)", async () => {
    const quote = await service().createDraft(draftCmd({ customerTaxExempt: true, customerTaxExemptionRateId: "EXEMPT", lines: [quoted("L1", { taxRateId: "VAT14" }), quoted("L2", {})] }));
    expect(quote.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["EXEMPT", 0], ["EXEMPT", 0]]);
  });
});
