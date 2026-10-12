import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  createPurchaseOrder,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
  purchaseOrderLineTotal,
  purchaseOrderSubtotal,
  purchaseOrderTotal,
  lineOutstandingQty,
  isFullyReceived,
  deriveReceivedStatus,
  applyReceiptToOrder,
  revertReceiptFromOrder,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "./purchase-order.js";
import { InvalidPurchaseDocumentError, PurchaseOrderNotFoundError } from "./errors.js";
import { InMemoryPurchaseOrders, makeNumbering } from "./test-helpers.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";

const now = () => "2026-08-21T09:00:00.000Z";

function poBase() {
  return {
    id: "po-1",
    supplierId: "sup-1",
    date: "2026-08-21",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    createdBy: "user-1",
    lines: [
      { itemId: "item-A", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25.00") },
      { itemId: "item-B", qty: Qty.fromMajor("5"), unitPrice: Money.fromMajor("12.00") },
    ],
  };
}

function line(overrides: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine {
  return {
    itemId: "item-A",
    description: null,
    qty: Qty.fromMajor("10"),
    unitPrice: Money.fromMajor("25.00"),
    receivedQty: Qty.zero(),
    ...overrides,
  };
}

function order(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po-1",
    number: "PO-000001",
    supplierId: "sup-1",
    date: "2026-08-21",
    expectedDeliveryDate: null,
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    lines: [line()],
    status: "sent",
    createdBy: "user-1",
    createdAt: now(),
    ...overrides,
  };
}

describe("purchaseOrderLineTotal / subtotal / total", () => {
  it("extends qty x unit price per line and sums for the subtotal", () => {
    expect(purchaseOrderLineTotal({ qty: Qty.fromMajor("3"), unitPrice: Money.fromMajor("7.50") }).toString()).toBe(
      "22.500000",
    );
    const subtotal = purchaseOrderSubtotal({
      lines: [
        { qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25") },
        { qty: Qty.fromMajor("5"), unitPrice: Money.fromMajor("12") },
      ],
    });
    expect(subtotal.toString()).toBe("310.000000");
    expect(purchaseOrderTotal({ lines: [] }).toString()).toBe("0.000000");
  });
});

describe("lineOutstandingQty", () => {
  it("is ordered minus received", () => {
    expect(lineOutstandingQty(line({ qty: Qty.fromMajor("10"), receivedQty: Qty.fromMajor("4") })).toString()).toBe(
      "6.000000",
    );
  });

  it("never goes negative even if received somehow exceeds ordered", () => {
    expect(lineOutstandingQty(line({ qty: Qty.fromMajor("5"), receivedQty: Qty.fromMajor("9") })).isZero()).toBe(true);
  });

  it("is zero at the exact boundary", () => {
    expect(lineOutstandingQty(line({ qty: Qty.fromMajor("5"), receivedQty: Qty.fromMajor("5") })).isZero()).toBe(true);
  });
});

describe("isFullyReceived / deriveReceivedStatus", () => {
  it("false with any outstanding qty, true once every line clears", () => {
    const lines = [line({ receivedQty: Qty.fromMajor("10") }), line({ itemId: "item-B", receivedQty: Qty.zero() })];
    expect(isFullyReceived({ lines })).toBe(false);
    expect(deriveReceivedStatus(lines)).toBe("partially_received");
    const closed = lines.map((l) => ({ ...l, receivedQty: l.qty }));
    expect(isFullyReceived({ lines: closed })).toBe(true);
    expect(deriveReceivedStatus(closed)).toBe("fully_received");
  });

  it("stays 'sent' when nothing has been received yet", () => {
    expect(deriveReceivedStatus([line({ receivedQty: Qty.zero() })])).toBe("sent");
  });
});

describe("createPurchaseOrder", () => {
  it("creates a draft, numbered and validated, with zero received qty on every line", async () => {
    const orders = new InMemoryPurchaseOrders();
    const po = await createPurchaseOrder(poBase(), { orders, numbering: makeNumbering(), now });
    expect(po.number).toBe("PO-000001");
    expect(po.status).toBe("draft");
    expect(po.currency).toBe("EGP");
    expect(po.lines.every((l) => l.receivedQty.isZero())).toBe(true);
  });

  it("rejects a missing supplier/warehouse/branch/date", async () => {
    const orders = new InMemoryPurchaseOrders();
    await expect(
      createPurchaseOrder({ ...poBase(), supplierId: "" }, { orders, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/supplier is required/);
    await expect(
      createPurchaseOrder({ ...poBase(), warehouseId: "" }, { orders, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/warehouse is required/);
    await expect(
      createPurchaseOrder({ ...poBase(), branchId: "" }, { orders, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/branch is required/);
    await expect(
      createPurchaseOrder({ ...poBase(), date: "" }, { orders, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/date is required/);
  });

  it("rejects a zero/negative line qty or a negative unit price", async () => {
    const orders = new InMemoryPurchaseOrders();
    await expect(
      createPurchaseOrder(
        { ...poBase(), lines: [{ itemId: "item-A", qty: Qty.zero(), unitPrice: Money.fromMajor("1") }] },
        { orders, numbering: makeNumbering(), now },
      ),
    ).rejects.toThrow(/qty must be positive/);
    await expect(
      createPurchaseOrder(
        { ...poBase(), lines: [{ itemId: "item-A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("-1") }] },
        { orders, numbering: makeNumbering(), now },
      ),
    ).rejects.toThrow(/unit price must not be negative/);
  });

  it("rejects a duplicate purchase-order id", async () => {
    const orders = new InMemoryPurchaseOrders();
    const numbering = makeNumbering();
    await createPurchaseOrder(poBase(), { orders, numbering, now });
    await expect(createPurchaseOrder(poBase(), { orders, numbering, now })).rejects.toThrow(DuplicateRecordIdError);
  });

  it("rejects a blank item id on a line", async () => {
    const orders = new InMemoryPurchaseOrders();
    await expect(
      createPurchaseOrder(
        { ...poBase(), lines: [{ itemId: "  ", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("1") }] },
        { orders, numbering: makeNumbering(), now },
      ),
    ).rejects.toThrow(/an item is required/);
  });
});

describe("confirmPurchaseOrder", () => {
  it("draft -> sent, audits the confirm", async () => {
    const orders = new InMemoryPurchaseOrders();
    const audit = new (class {
      readonly events: unknown[] = [];
      async append(e: unknown) {
        this.events.push(e);
      }
      async query() {
        return [];
      }
    })();
    await createPurchaseOrder(poBase(), { orders, numbering: makeNumbering(), now });
    const sent = await confirmPurchaseOrder("po-1", { orders, audit: audit as never });
    expect(sent.status).toBe("sent");
    expect(audit.events).toHaveLength(1);
  });

  it("404s an unknown order", async () => {
    const orders = new InMemoryPurchaseOrders();
    await expect(confirmPurchaseOrder("nope", { orders })).rejects.toThrow(PurchaseOrderNotFoundError);
  });

  it("refuses confirming a non-draft order", async () => {
    const orders = new InMemoryPurchaseOrders();
    await createPurchaseOrder(poBase(), { orders, numbering: makeNumbering(), now });
    await confirmPurchaseOrder("po-1", { orders });
    await expect(confirmPurchaseOrder("po-1", { orders })).rejects.toThrow(InvalidPurchaseDocumentError);
  });
});

describe("cancelPurchaseOrder", () => {
  it("cancels a draft or sent order", async () => {
    const orders = new InMemoryPurchaseOrders();
    await createPurchaseOrder(poBase(), { orders, numbering: makeNumbering(), now });
    const cancelled = await cancelPurchaseOrder("po-1", { orders });
    expect(cancelled.status).toBe("cancelled");
  });

  it("refuses cancelling a fully_received order", async () => {
    const orders = new InMemoryPurchaseOrders();
    orders.rows.set("po-1", order({ status: "fully_received" }));
    await expect(cancelPurchaseOrder("po-1", { orders })).rejects.toThrow(InvalidPurchaseDocumentError);
  });

  it("refuses cancelling an already-cancelled order", async () => {
    const orders = new InMemoryPurchaseOrders();
    orders.rows.set("po-1", order({ status: "cancelled" }));
    await expect(cancelPurchaseOrder("po-1", { orders })).rejects.toThrow(InvalidPurchaseDocumentError);
  });

  it("404s an unknown order", async () => {
    const orders = new InMemoryPurchaseOrders();
    await expect(cancelPurchaseOrder("nope", { orders })).rejects.toThrow(PurchaseOrderNotFoundError);
  });
});

describe("applyReceiptToOrder / revertReceiptFromOrder", () => {
  it("distributes a received qty across multiple lines of the same item, capping at each line's ordered qty", () => {
    const twoLines = order({
      status: "sent",
      lines: [
        line({ itemId: "item-A", qty: Qty.fromMajor("5") }),
        line({ itemId: "item-A", qty: Qty.fromMajor("5") }),
      ],
    });
    const updated = applyReceiptToOrder(twoLines, [{ itemId: "item-A", qty: Qty.fromMajor("7") }]);
    expect(updated.lines[0]?.receivedQty.toString()).toBe("5.000000");
    expect(updated.lines[1]?.receivedQty.toString()).toBe("2.000000");
    expect(updated.status).toBe("partially_received");
  });

  it("ignores received quantities for items not on the order", () => {
    const single = order({ lines: [line({ itemId: "item-A" })] });
    const updated = applyReceiptToOrder(single, [{ itemId: "item-Z", qty: Qty.fromMajor("1") }]);
    expect(updated.lines[0]?.receivedQty.isZero()).toBe(true);
  });

  it("revertReceiptFromOrder undoes a prior apply, restoring receivedQty and status", () => {
    const applied = applyReceiptToOrder(order({ lines: [line({ qty: Qty.fromMajor("10") })] }), [
      { itemId: "item-A", qty: Qty.fromMajor("10") },
    ]);
    expect(applied.status).toBe("fully_received");
    const reverted = revertReceiptFromOrder(applied, [{ itemId: "item-A", qty: Qty.fromMajor("10") }]);
    expect(reverted.lines[0]?.receivedQty.isZero()).toBe(true);
    expect(reverted.status).toBe("sent");
  });

  it("revertReceiptFromOrder never drives receivedQty negative", () => {
    const applied = applyReceiptToOrder(order({ lines: [line({ qty: Qty.fromMajor("10") })] }), [
      { itemId: "item-A", qty: Qty.fromMajor("4") },
    ]);
    const reverted = revertReceiptFromOrder(applied, [{ itemId: "item-A", qty: Qty.fromMajor("99") }]);
    expect(reverted.lines[0]?.receivedQty.isZero()).toBe(true);
  });

  it("leaves an independently-cancelled order's status untouched", () => {
    const cancelled = order({ status: "cancelled", lines: [line({ receivedQty: Qty.fromMajor("3") })] });
    const reverted = revertReceiptFromOrder(cancelled, [{ itemId: "item-A", qty: Qty.fromMajor("3") }]);
    expect(reverted.status).toBe("cancelled");
    expect(reverted.lines[0]?.receivedQty.isZero()).toBe(true);
  });
});
