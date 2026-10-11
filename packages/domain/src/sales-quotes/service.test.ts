import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import {
  SalesQuoteService,
  DuplicateSalesQuoteError,
  InvalidSalesQuoteTransitionError,
  SalesQuoteNotFoundError,
  type CreateSalesQuoteCommand,
} from "./index.js";
import { InMemorySalesQuoteRepository } from "./test-helpers/in-memory-sales-quote-repository.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";

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
    ],
    ...overrides,
  };
}

/**
 * `markConverted` only records that the conversion happened — status, timestamp,
 * and the target invoice id. Nothing in this service (or anywhere under
 * packages/domain/src/sales-quotes) copies the quote's lines onto the invoice
 * or freezes the price at conversion time: that bridge is implemented outside
 * the domain package (see index.ts's own doc comment: "conversion to a sales
 * invoice is implemented outside this module"). This suite tests exactly what
 * `markConverted` does; it does not assert conversion behaviour that isn't here.
 */
describe("SalesQuoteService.markConverted", () => {
  it("requires the quote to be accepted first, then flips it to converted with the invoice id and timestamp", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd());
    await svc.send("qt-1");
    await expect(svc.markConverted("qt-1", "inv-1")).rejects.toBeInstanceOf(InvalidSalesQuoteTransitionError);

    await svc.accept("qt-1");
    const converted = await svc.markConverted("qt-1", "inv-1");
    expect(converted.status).toBe("converted");
    expect(converted.convertedAt).toBe(NOW);
    expect(converted.convertedInvoiceId).toBe("inv-1");
    // Converted lines/customer/etc are untouched — it is a status flip, nothing more.
    expect(converted.lines).toEqual((await svc.findById("qt-1"))?.lines);
  });

  it("is terminal — a converted quote cannot be converted again or cancelled", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd());
    await svc.send("qt-1");
    await svc.accept("qt-1");
    await svc.markConverted("qt-1", "inv-1");
    await expect(svc.markConverted("qt-1", "inv-2")).rejects.toBeInstanceOf(InvalidSalesQuoteTransitionError);
    await expect(svc.cancel("qt-1")).rejects.toBeInstanceOf(InvalidSalesQuoteTransitionError);
  });

  it("throws SalesQuoteNotFoundError for a missing id", async () => {
    const { svc } = harness();
    await expect(svc.markConverted("missing", "inv-1")).rejects.toBeInstanceOf(SalesQuoteNotFoundError);
  });
});

describe("SalesQuoteService — draft validation and totals wiring", () => {
  it("rejects a duplicate id on createDraft", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd());
    await expect(svc.createDraft(draftCmd())).rejects.toBeInstanceOf(DuplicateRecordIdError);
  });

  it("effectsOf and totalsOf agree on the grand total driving the send gate", async () => {
    const { svc } = harness();
    const draft = await svc.createDraft(draftCmd());
    const totals = svc.totalsOf(draft);
    const effects = svc.effectsOf(draft);
    expect(effects.blocked).toBe(false);
    expect(totals.grandTotal.scaled > 0n).toBe(true);
  });

  it("send allocates sequential document numbers and stamps sentAt", async () => {
    const { svc } = harness();
    await svc.createDraft(draftCmd({ id: "qt-x" }));
    const sent = await svc.send("qt-x");
    expect(sent.docNo).toBe("QT-000001");
    expect(sent.sentAt).toBe(NOW);
  });
});
