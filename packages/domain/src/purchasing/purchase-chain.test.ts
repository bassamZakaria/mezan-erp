import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  createPurchaseOrder,
  confirmPurchaseOrder,
  cancelPurchaseOrder,
  purchaseOrderSubtotal,
  lineOutstandingQty,
} from "./purchase-order.js";
import {
  createGoodsReceipt,
  confirmGoodsReceipt,
  goodsReceiptTotalCost,
} from "./goods-receipt.js";
import {
  createPurchaseInvoice,
  confirmPurchaseInvoice,
  buildInvoiceLinesFromReceipt,
  purchaseInvoiceTax,
  purchaseInvoiceTotal,
} from "./purchase-invoice.js";
import type { PurchaseGlAccounts } from "./types.js";
import {
  InMemoryPurchaseOrders,
  InMemoryGoodsReceipts,
  InMemoryPurchaseInvoices,
  RecordingGlPort,
  makeNumbering,
  makeStockService,
} from "./test-helpers.js";

const now = () => "2026-08-21T09:00:00.000Z";
const WH = "MAIN-WH";
const ACCOUNTS: PurchaseGlAccounts = {
  inventoryAccountId: "1300-inventory",
  payableAccountId: "2100-ap",
  taxAccountId: "1360-input-vat",
  freightAccountId: "5200-freight",
};

function serializePosting(p: { lines: readonly { accountId: string; debit: Money; credit: Money }[] }) {
  return p.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit.toString(),
    credit: l.credit.toString(),
  }));
}

function poBase() {
  return {
    id: "po-1",
    supplierId: "sup-1",
    date: "2026-08-21",
    branchId: "MAIN",
    warehouseId: WH,
    createdBy: "user-1",
    lines: [
      { itemId: "item-A", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25.00") },
      { itemId: "item-B", qty: Qty.fromMajor("5"), unitPrice: Money.fromMajor("12.00") },
    ],
  };
}

describe("Purchase Order", () => {
  it("creates a draft with a PO number and computed subtotal", async () => {
    const orders = new InMemoryPurchaseOrders();
    const po = await createPurchaseOrder(poBase(), { orders, numbering: makeNumbering(), now });
    expect(po.number).toBe("PO-000001");
    expect(po.status).toBe("draft");
    expect(purchaseOrderSubtotal(po).toString()).toBe("310.000000");
    expect(po.lines[0]?.receivedQty.toString()).toBe("0.000000");
  });

  it("allocates gap-free sequential numbers", async () => {
    const orders = new InMemoryPurchaseOrders();
    const numbering = makeNumbering();
    const a = await createPurchaseOrder({ ...poBase(), id: "po-a" }, { orders, numbering, now });
    const b = await createPurchaseOrder({ ...poBase(), id: "po-b" }, { orders, numbering, now });
    expect([a.number, b.number]).toEqual(["PO-000001", "PO-000002"]);
  });

  it("confirms draft → sent, and rejects confirming a non-draft", async () => {
    const orders = new InMemoryPurchaseOrders();
    await createPurchaseOrder(poBase(), { orders, numbering: makeNumbering(), now });
    const sent = await confirmPurchaseOrder("po-1", { orders });
    expect(sent.status).toBe("sent");
    await expect(confirmPurchaseOrder("po-1", { orders })).rejects.toThrow();
  });

  it("cancels a draft/sent order", async () => {
    const orders = new InMemoryPurchaseOrders();
    await createPurchaseOrder(poBase(), { orders, numbering: makeNumbering(), now });
    const cancelled = await cancelPurchaseOrder("po-1", { orders });
    expect(cancelled.status).toBe("cancelled");
  });

  it("rejects an empty or invalid order", async () => {
    const orders = new InMemoryPurchaseOrders();
    await expect(
      createPurchaseOrder({ ...poBase(), lines: [] }, { orders, numbering: makeNumbering(), now }),
    ).rejects.toThrow(/at least one line/);
  });
});

describe("Goods Receipt", () => {
  async function sentOrder() {
    const orders = new InMemoryPurchaseOrders();
    const numbering = makeNumbering();
    await createPurchaseOrder(poBase(), { orders, numbering, now });
    await confirmPurchaseOrder("po-1", { orders });
    return { orders, numbering };
  }

  it("auto-fills lines from the PO's outstanding quantities (create-from-PO)", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const gr = await createGoodsReceipt(
      { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" },
      { receipts, orders, numbering },
    );
    expect(gr.number).toBe("GR-000001");
    expect(gr.status).toBe("draft");
    expect(gr.supplierId).toBe("sup-1");
    expect(gr.lines.map((l) => l.qty.toString())).toEqual(["10.000000", "5.000000"]);
    expect(gr.lines[0]?.unitCost.toString()).toBe("25.000000");
    expect(goodsReceiptTotalCost(gr).toString()).toBe("310.000000");
  });

  it("posts stock IN on confirm and advances the PO to fully received", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await createGoodsReceipt(
      { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" },
      { receipts, orders, numbering },
    );
    const confirmed = await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    expect(confirmed.status).toBe("confirmed");

    const balA = await stock.getBalanceDetail("item-A", WH);
    expect(balA.onHand.toString()).toBe("10.000000");
    expect(balA.averageCost.toString()).toBe("25.000000");
    const balB = await stock.getBalanceDetail("item-B", WH);
    expect(balB.onHand.toString()).toBe("5.000000");

    const po = await orders.findById("po-1");
    expect(po?.status).toBe("fully_received");
    expect(po?.lines.every((l) => lineOutstandingQty(l).isZero())).toBe(true);
  });

  it("supports partial receipts → partially_received", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await createGoodsReceipt(
      {
        id: "gr-1",
        purchaseOrderId: "po-1",
        date: "2026-08-22",
        lines: [{ itemId: "item-A", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("25.00") }],
      },
      { receipts, orders, numbering },
    );
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    const po = await orders.findById("po-1");
    expect(po?.status).toBe("partially_received");
    expect(po?.lines[0]?.receivedQty.toString()).toBe("4.000000");
    expect((await stock.getBalanceDetail("item-A", WH)).onHand.toString()).toBe("4.000000");
  });

  it("blocks over-receipt only when the strictness gate is on", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const over = {
      id: "gr-1",
      purchaseOrderId: "po-1",
      date: "2026-08-22",
      lines: [{ itemId: "item-A", qty: Qty.fromMajor("99"), unitCost: Money.fromMajor("25.00") }],
    };
    await expect(
      createGoodsReceipt(over, { receipts, orders, numbering, policy: { requireReceiptForInvoice: false, blockOverReceipt: true } }),
    ).rejects.toThrow(/PURCHASE_OVER_RECEIPT|outstanding/);
    // default policy (gate off) allows it
    const gr = await createGoodsReceipt(over, { receipts, orders, numbering });
    expect(gr.status).toBe("draft");
  });

  it("cannot confirm a non-draft receipt", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await createGoodsReceipt(
      { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" },
      { receipts, orders, numbering },
    );
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    await expect(confirmGoodsReceipt("gr-1", { receipts, orders, stock })).rejects.toThrow();
  });
});

describe("Purchase Invoice", () => {
  async function receivedChain() {
    const orders = new InMemoryPurchaseOrders();
    const receipts = new InMemoryGoodsReceipts();
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseOrder(poBase(), { orders, numbering, now });
    await confirmPurchaseOrder("po-1", { orders });
    await createGoodsReceipt(
      { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" },
      { receipts, orders, numbering },
    );
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    return { orders, receipts, invoices, numbering, stock };
  }

  it("create-from-receipt auto-fills lines and links the receipt", async () => {
    const { receipts, invoices, numbering } = await receivedChain();
    const receipt = await receipts.findById("gr-1");
    const lines = buildInvoiceLinesFromReceipt(receipt!, () => 14);
    const inv = await createPurchaseInvoice(
      {
        id: "pi-1",
        supplierId: "sup-1",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        receiptId: "gr-1",
        lines,
      },
      { invoices, receipts, numbering },
    );
    expect(inv.number).toBe("PI-000001");
    expect(inv.receiptId).toBe("gr-1");
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines[0]?.kind).toBe("inventory");
    expect(purchaseInvoiceTax(inv).toString()).toBe("43.400000");
    expect(purchaseInvoiceTotal(inv).toString()).toBe("353.400000");
  });

  it("confirm (from receipt) posts GL only and does NOT re-post stock (golden)", async () => {
    const { receipts, invoices, numbering, stock } = await receivedChain();
    const receipt = await receipts.findById("gr-1");
    await createPurchaseInvoice(
      {
        id: "pi-1",
        supplierId: "sup-1",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        receiptId: "gr-1",
        lines: buildInvoiceLinesFromReceipt(receipt!, () => 14),
      },
      { invoices, receipts, numbering },
    );
    const gl = new RecordingGlPort();
    const { invoice, posting } = await confirmPurchaseInvoice("pi-1", {
      invoices,
      receipts,
      stock,
      gl,
      accounts: ACCOUNTS,
      now,
    });

    expect(invoice.status).toBe("confirmed");
    // stock unchanged from the receipt (no double count)
    expect((await stock.getBalanceDetail("item-A", WH)).onHand.toString()).toBe("10.000000");
    expect((await stock.getBalanceDetail("item-B", WH)).onHand.toString()).toBe("5.000000");
    // receipt flagged invoiced
    expect((await receipts.findById("gr-1"))?.invoiced).toBe(true);

    // GOLDEN: Dr Inventory 310, Dr Input VAT 43.40, Cr AP 353.40
    expect(serializePosting(posting)).toEqual([
      { accountId: "1300-inventory", debit: "310.000000", credit: "0.000000" },
      { accountId: "1360-input-vat", debit: "43.400000", credit: "0.000000" },
      { accountId: "2100-ap", debit: "0.000000", credit: "353.400000" },
    ]);
    expect(gl.postings).toHaveLength(1);
  });

  it("manual invoice confirm posts BOTH stock IN and GL, with a freight line (golden)", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      {
        id: "pi-m",
        supplierId: "sup-2",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        lines: [
          { itemId: "item-C", kind: "inventory", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("50.00"), taxRatePercent: 14 },
          { itemId: null, kind: "expense", description: "شحن", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("30.00"), taxRatePercent: 0 },
        ],
      },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    const { posting } = await confirmPurchaseInvoice("pi-m", { invoices, stock, gl, accounts: ACCOUNTS, now });

    // manual → stock posted
    expect((await stock.getBalanceDetail("item-C", WH)).onHand.toString()).toBe("4.000000");
    expect((await stock.getBalanceDetail("item-C", WH)).averageCost.toString()).toBe("50.000000");

    // GOLDEN: Dr Inventory 200, Dr Freight 30, Dr VAT 28, Cr AP 258
    expect(serializePosting(posting)).toEqual([
      { accountId: "1300-inventory", debit: "200.000000", credit: "0.000000" },
      { accountId: "5200-freight", debit: "30.000000", credit: "0.000000" },
      { accountId: "1360-input-vat", debit: "28.000000", credit: "0.000000" },
      { accountId: "2100-ap", debit: "0.000000", credit: "258.000000" },
    ]);
  });

  it("posting always balances (Σ debit === Σ credit)", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      {
        id: "pi-b",
        supplierId: "sup-2",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        lines: [
          { itemId: "item-X", kind: "inventory", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("7.33"), taxRatePercent: 14 },
        ],
      },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    const { posting } = await confirmPurchaseInvoice("pi-b", { invoices, stock, gl, accounts: ACCOUNTS, now });
    const debit = Money.sum(posting.lines.map((l) => l.debit));
    const credit = Money.sum(posting.lines.map((l) => l.credit));
    expect(debit.toString()).toBe(credit.toString());
  });

  it("enforces the require-receipt strictness gate only when on", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const manual = {
      id: "pi-r",
      supplierId: "sup-2",
      date: "2026-08-23",
      branchId: "MAIN",
      warehouseId: WH,
      lines: [{ itemId: "item-Y", kind: "inventory" as const, qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10.00") }],
    };
    await expect(
      createPurchaseInvoice(manual, { invoices, numbering, policy: { requireReceiptForInvoice: true, blockOverReceipt: false } }),
    ).rejects.toThrow(/PURCHASE_RECEIPT_REQUIRED|required/);
    const inv = await createPurchaseInvoice(manual, { invoices, numbering });
    expect(inv.status).toBe("draft");
  });

  it("cannot confirm a non-draft invoice", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      {
        id: "pi-1",
        supplierId: "sup-2",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        lines: [{ itemId: "item-Z", kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10.00") }],
      },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    await confirmPurchaseInvoice("pi-1", { invoices, stock, gl, accounts: ACCOUNTS, now });
    await expect(
      confirmPurchaseInvoice("pi-1", { invoices, stock, gl, accounts: ACCOUNTS, now }),
    ).rejects.toThrow();
  });
});
