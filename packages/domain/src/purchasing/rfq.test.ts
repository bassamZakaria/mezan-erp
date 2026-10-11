import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  createRfq,
  sendRfq,
  cancelRfq,
  closeRfq,
  recordRfqQuote,
  compareRfqQuotes,
  convertRfqToPurchaseOrder,
  type PurchaseRfq,
  type PurchaseRfqRepository,
  type RfqQuote,
  type RfqQuoteRepository,
} from "./rfq.js";
import {
  RfqNotFoundError,
  InvalidRfqError,
  RfqNotDraftError,
  RfqNotSentError,
  RfqNotOpenError,
  RfqQuoteNotFoundError,
  DuplicatePurchaseDocumentError,
} from "./errors.js";
import { InMemoryPurchaseOrders, makeNumbering } from "./test-helpers.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";

const now = () => "2026-08-21T09:00:00.000Z";

class InMemoryRfqs implements PurchaseRfqRepository {
  readonly rows = new Map<string, PurchaseRfq>();
  async findById(id: string): Promise<PurchaseRfq | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<PurchaseRfq[]> {
    return [...this.rows.values()];
  }
  async create(rfq: PurchaseRfq): Promise<void> {
    this.rows.set(rfq.id, rfq);
  }
  async update(rfq: PurchaseRfq): Promise<void> {
    this.rows.set(rfq.id, rfq);
  }
}

class InMemoryRfqQuotes implements RfqQuoteRepository {
  readonly rows = new Map<string, RfqQuote>();
  async findById(id: string): Promise<RfqQuote | null> {
    return this.rows.get(id) ?? null;
  }
  async listByRfq(rfqId: string): Promise<RfqQuote[]> {
    return [...this.rows.values()].filter((q) => q.rfqId === rfqId);
  }
  async create(quote: RfqQuote): Promise<void> {
    this.rows.set(quote.id, quote);
  }
}

function rfqBase() {
  return {
    id: "rfq-1",
    date: "2026-08-21",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    createdBy: "user-1",
    lines: [
      { itemId: "item-A", qty: Qty.fromMajor("10") },
      { itemId: "item-B", qty: Qty.fromMajor("5") },
    ],
  };
}

describe("createRfq", () => {
  it("creates a draft RFQ with a sequential number", async () => {
    const rfqs = new InMemoryRfqs();
    const rfq = await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    expect(rfq.number).toBe("RFQ-000001");
    expect(rfq.status).toBe("draft");
    expect(rfq.purchaseOrderId).toBeNull();
    expect(rfq.lines).toHaveLength(2);
  });

  it("allocates gap-free sequential numbers", async () => {
    const rfqs = new InMemoryRfqs();
    const numbering = makeNumbering();
    const a = await createRfq({ ...rfqBase(), id: "rfq-a" }, { rfqs, numbering, now });
    const b = await createRfq({ ...rfqBase(), id: "rfq-b" }, { rfqs, numbering, now });
    expect([a.number, b.number]).toEqual(["RFQ-000001", "RFQ-000002"]);
  });

  it("rejects missing branch/warehouse/date and empty lines", async () => {
    const rfqs = new InMemoryRfqs();
    await expect(
      createRfq({ ...rfqBase(), branchId: "" }, { rfqs, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/branch/);
    await expect(
      createRfq({ ...rfqBase(), warehouseId: "" }, { rfqs, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/warehouse/);
    await expect(
      createRfq({ ...rfqBase(), date: "" }, { rfqs, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/date/);
    await expect(
      createRfq({ ...rfqBase(), lines: [] }, { rfqs, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/at least one line/);
  });

  it("rejects a zero or negative line qty", async () => {
    const rfqs = new InMemoryRfqs();
    await expect(
      createRfq(
        { ...rfqBase(), lines: [{ itemId: "item-A", qty: Qty.zero() }] },
        { rfqs, numbering: makeNumbering(), now },
      ),
    ).rejects.toThrow(/qty must be positive/);
  });

  it("rejects a duplicate id", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await expect(createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now })).rejects.toThrow(DuplicateRecordIdError);
  });
});

describe("sendRfq", () => {
  it("transitions draft → sent", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    const sent = await sendRfq("rfq-1", { rfqs });
    expect(sent.status).toBe("sent");
  });

  it("404s on a missing RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await expect(sendRfq("nope", { rfqs })).rejects.toThrow(RfqNotFoundError);
  });

  it("rejects sending a non-draft RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await sendRfq("rfq-1", { rfqs });
    await expect(sendRfq("rfq-1", { rfqs })).rejects.toThrow(RfqNotDraftError);
  });
});

describe("cancelRfq", () => {
  it("cancels a draft RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    const cancelled = await cancelRfq("rfq-1", { rfqs });
    expect(cancelled.status).toBe("cancelled");
  });

  it("cancels a sent RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await sendRfq("rfq-1", { rfqs });
    const cancelled = await cancelRfq("rfq-1", { rfqs });
    expect(cancelled.status).toBe("cancelled");
  });

  it("rejects cancelling a closed or already-cancelled RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await sendRfq("rfq-1", { rfqs });
    await closeRfq("rfq-1", { rfqs });
    await expect(cancelRfq("rfq-1", { rfqs })).rejects.toThrow(RfqNotOpenError);

    const rfqs2 = new InMemoryRfqs();
    await createRfq({ ...rfqBase(), id: "rfq-2" }, { rfqs: rfqs2, numbering: makeNumbering(), now });
    await cancelRfq("rfq-2", { rfqs: rfqs2 });
    await expect(cancelRfq("rfq-2", { rfqs: rfqs2 })).rejects.toThrow(RfqNotOpenError);
  });

  it("404s on a missing RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await expect(cancelRfq("nope", { rfqs })).rejects.toThrow(RfqNotFoundError);
  });
});

describe("closeRfq", () => {
  it("closes a sent RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await sendRfq("rfq-1", { rfqs });
    const closed = await closeRfq("rfq-1", { rfqs });
    expect(closed.status).toBe("closed");
  });

  it("rejects closing a draft, already-closed, or cancelled RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await expect(closeRfq("rfq-1", { rfqs })).rejects.toThrow(RfqNotSentError);

    await sendRfq("rfq-1", { rfqs });
    await closeRfq("rfq-1", { rfqs });
    await expect(closeRfq("rfq-1", { rfqs })).rejects.toThrow(RfqNotSentError);

    const rfqs2 = new InMemoryRfqs();
    await createRfq({ ...rfqBase(), id: "rfq-2" }, { rfqs: rfqs2, numbering: makeNumbering(), now });
    await cancelRfq("rfq-2", { rfqs: rfqs2 });
    await expect(closeRfq("rfq-2", { rfqs: rfqs2 })).rejects.toThrow(RfqNotSentError);
  });

  it("404s on a missing RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    await expect(closeRfq("nope", { rfqs })).rejects.toThrow(RfqNotFoundError);
  });
});

describe("recordRfqQuote", () => {
  async function sentRfq() {
    const rfqs = new InMemoryRfqs();
    const quotes = new InMemoryRfqQuotes();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await sendRfq("rfq-1", { rfqs });
    return { rfqs, quotes };
  }

  it("records a supplier quote against a sent RFQ", async () => {
    const { rfqs, quotes } = await sentRfq();
    const quote = await recordRfqQuote(
      {
        id: "q-1",
        rfqId: "rfq-1",
        supplierId: "sup-1",
        lines: [
          { itemId: "item-A", unitPrice: Money.fromMajor("20.00") },
          { itemId: "item-B", unitPrice: Money.fromMajor("15.00") },
        ],
      },
      { rfqs, quotes, now },
    );
    expect(quote.supplierId).toBe("sup-1");
    expect(quote.lines).toHaveLength(2);
    expect(quote.submittedAt).toBe(now());
  });

  it("rejects recording a quote against a non-sent RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    const quotes = new InMemoryRfqQuotes();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await expect(
      recordRfqQuote(
        { id: "q-1", rfqId: "rfq-1", supplierId: "sup-1", lines: [{ itemId: "item-A", unitPrice: Money.fromMajor("20.00") }] },
        { rfqs, quotes, now },
      ),
    ).rejects.toThrow(RfqNotSentError);
  });

  it("rejects a quote with no supplier, no lines, an item not on the RFQ, or a negative price", async () => {
    const { rfqs, quotes } = await sentRfq();
    await expect(
      recordRfqQuote(
        { id: "q-1", rfqId: "rfq-1", supplierId: "", lines: [{ itemId: "item-A", unitPrice: Money.fromMajor("20.00") }] },
        { rfqs, quotes, now },
      ),
    ).rejects.toThrow(InvalidRfqError);
    await expect(
      recordRfqQuote({ id: "q-2", rfqId: "rfq-1", supplierId: "sup-1", lines: [] }, { rfqs, quotes, now }),
    ).rejects.toThrow(/at least one quote line/);
    await expect(
      recordRfqQuote(
        { id: "q-3", rfqId: "rfq-1", supplierId: "sup-1", lines: [{ itemId: "item-ZZZ", unitPrice: Money.fromMajor("1.00") }] },
        { rfqs, quotes, now },
      ),
    ).rejects.toThrow(/not on this RFQ/);
    await expect(
      recordRfqQuote(
        { id: "q-4", rfqId: "rfq-1", supplierId: "sup-1", lines: [{ itemId: "item-A", unitPrice: Money.fromMajor("-1.00") }] },
        { rfqs, quotes, now },
      ),
    ).rejects.toThrow(/must not be negative/);
  });

  it("404s on a missing RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    const quotes = new InMemoryRfqQuotes();
    await expect(
      recordRfqQuote(
        { id: "q-1", rfqId: "nope", supplierId: "sup-1", lines: [{ itemId: "item-A", unitPrice: Money.fromMajor("1.00") }] },
        { rfqs, quotes, now },
      ),
    ).rejects.toThrow(RfqNotFoundError);
  });
});

describe("compareRfqQuotes", () => {
  it("builds a per-item/per-supplier grid, picks the cheapest, and only totals full-basket suppliers", async () => {
    const rfqs = new InMemoryRfqs();
    const quotes = new InMemoryRfqQuotes();
    await createRfq(rfqBase(), { rfqs, numbering: makeNumbering(), now });
    await sendRfq("rfq-1", { rfqs });

    // sup-1 quotes both lines; sup-2 quotes only item-A (partial basket).
    await recordRfqQuote(
      {
        id: "q-1",
        rfqId: "rfq-1",
        supplierId: "sup-1",
        lines: [
          { itemId: "item-A", unitPrice: Money.fromMajor("20.00") },
          { itemId: "item-B", unitPrice: Money.fromMajor("15.00") },
        ],
      },
      { rfqs, quotes, now },
    );
    await recordRfqQuote(
      { id: "q-2", rfqId: "rfq-1", supplierId: "sup-2", lines: [{ itemId: "item-A", unitPrice: Money.fromMajor("18.00") }] },
      { rfqs, quotes, now },
    );

    const rfq = (await rfqs.findById("rfq-1")) as NonNullable<Awaited<ReturnType<typeof rfqs.findById>>>;
    const allQuotes = await quotes.listByRfq("rfq-1");
    const comparison = compareRfqQuotes(rfq, allQuotes);

    expect([...comparison.supplierIds].sort()).toEqual(["sup-1", "sup-2"]);
    const rowA = comparison.rows.find((r) => r.itemId === "item-A")!;
    expect(rowA.cheapestSupplierId).toBe("sup-2"); // 18.00 < 20.00
    const rowB = comparison.rows.find((r) => r.itemId === "item-B")!;
    expect(rowB.cheapestSupplierId).toBe("sup-1"); // only sup-1 quoted it

    // only sup-1 quoted EVERY line — sup-2's partial basket is excluded from totals.
    expect([...comparison.totalsBySupplier.keys()]).toEqual(["sup-1"]);
    expect(comparison.totalsBySupplier.get("sup-1")?.toString()).toBe("275.000000"); // 10*20 + 5*15
  });
});

describe("convertRfqToPurchaseOrder", () => {
  async function sentRfqWithQuote() {
    const rfqs = new InMemoryRfqs();
    const quotes = new InMemoryRfqQuotes();
    const orders = new InMemoryPurchaseOrders();
    const numbering = makeNumbering();
    await createRfq(rfqBase(), { rfqs, numbering, now });
    await sendRfq("rfq-1", { rfqs });
    await recordRfqQuote(
      {
        id: "q-1",
        rfqId: "rfq-1",
        supplierId: "sup-1",
        lines: [
          { itemId: "item-A", unitPrice: Money.fromMajor("20.00") },
          { itemId: "item-B", unitPrice: Money.fromMajor("15.00") },
        ],
      },
      { rfqs, quotes, now },
    );
    return { rfqs, quotes, orders, numbering };
  }

  it("converts the chosen quote into a real PO and closes the RFQ", async () => {
    const { rfqs, quotes, orders, numbering } = await sentRfqWithQuote();
    const result = await convertRfqToPurchaseOrder(
      { rfqId: "rfq-1", purchaseOrderId: "po-1", supplierId: "sup-1", createdBy: "user-1" },
      { rfqs, quotes, orders, numbering, now },
    );

    expect(result.order.id).toBe("po-1");
    expect(result.order.supplierId).toBe("sup-1");
    expect(result.order.lines.map((l) => l.itemId)).toEqual(["item-A", "item-B"]);
    expect(result.order.lines[0]?.unitPrice.toString()).toBe("20.000000");
    expect(result.order.lines[1]?.unitPrice.toString()).toBe("15.000000");
    expect(result.rfq.status).toBe("closed");
    expect(result.rfq.purchaseOrderId).toBe("po-1");

    const persisted = await orders.findById("po-1");
    expect(persisted?.id).toBe("po-1");
  });

  it("rejects converting a non-sent RFQ", async () => {
    const rfqs = new InMemoryRfqs();
    const quotes = new InMemoryRfqQuotes();
    const orders = new InMemoryPurchaseOrders();
    const numbering = makeNumbering();
    await createRfq(rfqBase(), { rfqs, numbering, now });
    await expect(
      convertRfqToPurchaseOrder(
        { rfqId: "rfq-1", purchaseOrderId: "po-1", supplierId: "sup-1" },
        { rfqs, quotes, orders, numbering, now },
      ),
    ).rejects.toThrow(RfqNotSentError);
  });

  it("rejects converting when the chosen supplier never quoted", async () => {
    const { rfqs, quotes, orders, numbering } = await sentRfqWithQuote();
    await expect(
      convertRfqToPurchaseOrder(
        { rfqId: "rfq-1", purchaseOrderId: "po-1", supplierId: "sup-99" },
        { rfqs, quotes, orders, numbering, now },
      ),
    ).rejects.toThrow(RfqQuoteNotFoundError);
  });

  it("rejects converting when the chosen supplier's quote only covers some lines", async () => {
    const rfqs = new InMemoryRfqs();
    const quotes = new InMemoryRfqQuotes();
    const orders = new InMemoryPurchaseOrders();
    const numbering = makeNumbering();
    await createRfq(rfqBase(), { rfqs, numbering, now });
    await sendRfq("rfq-1", { rfqs });
    // partial quote: only item-A, not item-B.
    await recordRfqQuote(
      { id: "q-1", rfqId: "rfq-1", supplierId: "sup-1", lines: [{ itemId: "item-A", unitPrice: Money.fromMajor("20.00") }] },
      { rfqs, quotes, now },
    );
    await expect(
      convertRfqToPurchaseOrder(
        { rfqId: "rfq-1", purchaseOrderId: "po-1", supplierId: "sup-1" },
        { rfqs, quotes, orders, numbering, now },
      ),
    ).rejects.toThrow(InvalidRfqError);
  });
});
