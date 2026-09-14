import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { PurchaseGlAccounts } from "./types.js";
import {
  createGoodsReceipt,
  confirmGoodsReceipt,
  cancelGoodsReceipt,
  buildGoodsReceiptPosting,
  buildReceiptLinesFromOrder,
  goodsReceiptTotalCost,
  markGoodsReceiptInvoiced,
} from "./goods-receipt.js";
import { createPurchaseOrder, confirmPurchaseOrder, cancelPurchaseOrder } from "./purchase-order.js";
import {
  DuplicatePurchaseDocumentError,
  GoodsReceiptNotFoundError,
  InvalidPurchaseDocumentError,
  OverReceiptError,
  PurchaseOrderNotFoundError,
  PurchaseOrderNotReceivableError,
} from "./errors.js";
import {
  InMemoryPurchaseOrders,
  InMemoryGoodsReceipts,
  RecordingGlPort,
  makeNumbering,
  makeStockService,
} from "./test-helpers.js";

const now = () => "2026-08-21T09:00:00.000Z";
const WH = "MAIN-WH";

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

async function sentOrder() {
  const orders = new InMemoryPurchaseOrders();
  const numbering = makeNumbering();
  await createPurchaseOrder(poBase(), { orders, numbering, now });
  await confirmPurchaseOrder("po-1", { orders });
  return { orders, numbering };
}

describe("goods receipt — receiving lifecycle", () => {
  it("full receipt: on-hand matches the PO qty exactly and the order closes fully_received", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    const confirmed = await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    expect(confirmed.status).toBe("confirmed");
    expect((await stock.getBalanceDetail("item-A", WH)).onHand.toString()).toBe("10.000000");
    expect((await stock.getBalanceDetail("item-B", WH)).onHand.toString()).toBe("5.000000");
    expect((await orders.findById("po-1"))?.status).toBe("fully_received");
  });

  it("partial receipt: on-hand and PO both reflect only what was received", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await createGoodsReceipt(
      {
        id: "gr-1",
        purchaseOrderId: "po-1",
        date: "2026-08-22",
        lines: [{ itemId: "item-A", qty: Qty.fromMajor("6"), unitCost: Money.fromMajor("25.00") }],
      },
      { receipts, orders, numbering },
    );
    const confirmed = await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    expect(confirmed.status).toBe("confirmed");
    expect((await stock.getBalanceDetail("item-A", WH)).onHand.toString()).toBe("6.000000");
    const po = await orders.findById("po-1");
    expect(po?.status).toBe("partially_received");
    expect(po?.lines[0]?.receivedQty.toString()).toBe("6.000000");

    // a second, closing receipt against the remaining outstanding qty completes the order
    await createGoodsReceipt({ id: "gr-2", purchaseOrderId: "po-1", date: "2026-08-23" }, { receipts, orders, numbering });
    const gr2 = await receipts.findById("gr-2");
    expect(gr2?.lines.map((l) => l.qty.toString())).toEqual(["4.000000", "5.000000"]);
    await confirmGoodsReceipt("gr-2", { receipts, orders, stock });
    expect((await orders.findById("po-1"))?.status).toBe("fully_received");
  });

  it("over-receipt beyond the PO's outstanding qty is refused when the strictness gate is on", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const over = {
      id: "gr-1",
      purchaseOrderId: "po-1",
      date: "2026-08-22",
      lines: [{ itemId: "item-A", qty: Qty.fromMajor("10.000001"), unitCost: Money.fromMajor("25.00") }],
    };
    await expect(
      createGoodsReceipt(over, {
        receipts,
        orders,
        numbering,
        policy: { requirePoForGrn: false, requireReceiptForInvoice: false, blockOverReceipt: true, trackSoldPurchaseItems: true },
      }),
    ).rejects.toThrow(OverReceiptError);
    expect(await receipts.findById("gr-1")).toBeNull();
  });

  it("receiving exactly at the outstanding boundary is accepted when the gate is on", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const exact = {
      id: "gr-1",
      purchaseOrderId: "po-1",
      date: "2026-08-22",
      lines: [{ itemId: "item-A", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("25.00") }],
    };
    const gr = await createGoodsReceipt(exact, {
      receipts,
      orders,
      numbering,
      policy: { requirePoForGrn: false, requireReceiptForInvoice: false, blockOverReceipt: true, trackSoldPurchaseItems: true },
    });
    expect(gr.status).toBe("draft");
  });

  it("receiving against a closed (fully received) order is refused", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    expect((await orders.findById("po-1"))?.status).toBe("fully_received");

    await expect(
      createGoodsReceipt({ id: "gr-2", purchaseOrderId: "po-1", date: "2026-08-23" }, { receipts, orders, numbering }),
    ).rejects.toThrow(PurchaseOrderNotReceivableError);
  });

  it("receiving against a cancelled order is refused", async () => {
    const orders = new InMemoryPurchaseOrders();
    const receipts = new InMemoryGoodsReceipts();
    const numbering = makeNumbering();
    await createPurchaseOrder(poBase(), { orders, numbering, now });
    await confirmPurchaseOrder("po-1", { orders });
    await cancelPurchaseOrder("po-1", { orders });
    await expect(
      createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering }),
    ).rejects.toThrow(PurchaseOrderNotReceivableError);
  });

  it("receiving twice with the same receipt id is refused (duplicate document)", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    await expect(
      createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering }),
    ).rejects.toThrow(DuplicatePurchaseDocumentError);
  });

  it("refuses a line costCategory when the receipt carries no projectId", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    await expect(
      createGoodsReceipt(
        {
          id: "gr-1",
          purchaseOrderId: "po-1",
          date: "2026-08-22",
          lines: [{ itemId: "item-A", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("25.00"), costCategory: "materials" }],
        },
        { receipts, orders, numbering },
      ),
    ).rejects.toThrow(InvalidPurchaseDocumentError);
  });

  it("404s confirming an unknown receipt", async () => {
    const orders = new InMemoryPurchaseOrders();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await expect(confirmGoodsReceipt("nope", { receipts, orders, stock })).rejects.toThrow(GoodsReceiptNotFoundError);
  });

  it("404s confirming when the linked order has vanished", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    // Simulate the PO having been removed from the repo between draft and confirm.
    (orders as unknown as { rows: Map<string, unknown> }).rows.delete("po-1");
    await expect(confirmGoodsReceipt("gr-1", { receipts, orders, stock })).rejects.toThrow(PurchaseOrderNotFoundError);
  });
});

describe("goods receipt — GL posting (both stock and control account)", () => {
  const ACCOUNTS: PurchaseGlAccounts = {
    inventoryAccountId: "1300-inventory",
    payableAccountId: "2100-payables",
    taxAccountId: "1360-input-vat",
    goodsReceivedNotInvoicedAccountId: "2150-grni",
  };

  it("buildGoodsReceiptPosting: Dr Inventory / Cr GRNI, balanced, equal to the receipt's own total", () => {
    const receipt = {
      id: "gr-1",
      number: "GR-000001",
      date: "2026-08-22",
      purchaseOrderId: "po-1",
      supplierId: "sup-1",
      branchId: "MAIN",
      warehouseId: WH,
      status: "confirmed",
      invoiced: false,
      notes: null,
      createdBy: "user-1",
      createdAt: "2026-08-22T00:00:00.000Z",
      lines: [
        { itemId: "item-A", description: null, qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("25.00") },
        { itemId: "item-B", description: null, qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("12.00") },
      ],
    } as Parameters<typeof buildGoodsReceiptPosting>[0];
    const posting = buildGoodsReceiptPosting(receipt, {
      inventoryAccountId: ACCOUNTS.inventoryAccountId,
      goodsReceivedNotInvoicedAccountId: ACCOUNTS.goodsReceivedNotInvoicedAccountId as string,
    });
    expect(posting.lines).toEqual([
      { accountId: "1300-inventory", debit: expect.anything(), credit: Money.zero(), projectId: null },
      { accountId: "2150-grni", debit: Money.zero(), credit: expect.anything(), projectId: null },
    ]);
    const debit = posting.lines[0]?.debit as Money;
    const credit = posting.lines[1]?.credit as Money;
    expect(debit.toString()).toBe("310.000000");
    expect(credit.toString()).toBe("310.000000");
    expect(debit.equals(credit)).toBe(true);
    expect(debit.toString()).toBe(goodsReceiptTotalCost(receipt).toString());
  });

  it("carries the header projectId on every line and costCategory only on the inventory (cost) line", () => {
    const receipt = {
      id: "gr-2",
      number: "GR-000002",
      date: "2026-08-22",
      purchaseOrderId: "po-1",
      supplierId: "sup-1",
      branchId: "MAIN",
      warehouseId: WH,
      status: "confirmed",
      invoiced: false,
      notes: null,
      projectId: "proj-1",
      createdBy: "user-1",
      createdAt: "2026-08-22T00:00:00.000Z",
      lines: [
        { itemId: "item-A", description: null, qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("25.00"), costCategory: "materials" },
      ],
    } as Parameters<typeof buildGoodsReceiptPosting>[0];
    const posting = buildGoodsReceiptPosting(receipt, {
      inventoryAccountId: ACCOUNTS.inventoryAccountId,
      goodsReceivedNotInvoicedAccountId: ACCOUNTS.goodsReceivedNotInvoicedAccountId as string,
    });
    expect(posting.lines.every((l) => l.projectId === "proj-1")).toBe(true);
    const inventoryLine = posting.lines.find((l) => l.accountId === "1300-inventory");
    const grniLine = posting.lines.find((l) => l.accountId === "2150-grni");
    expect(inventoryLine?.costCategory).toBe("materials");
    expect(grniLine?.costCategory).toBeUndefined();
  });

  it("confirm posts both the stock ledger AND the GL control account when GL deps are wired", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    const gl = new RecordingGlPort();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock, gl, accounts: ACCOUNTS });

    // stock (sub-ledger) side
    const stockValue = (await stock.getBalanceDetail("item-A", WH)).totalValue.add(
      (await stock.getBalanceDetail("item-B", WH)).totalValue,
    );
    expect(stockValue.toString()).toBe("310.000000");

    // GL (control account) side — must agree with the stock-ledger value moved
    expect(gl.postings).toHaveLength(1);
    const posted = gl.postings[0];
    const debit = posted?.lines.find((l) => l.accountId === "1300-inventory")?.debit as Money;
    expect(debit.toString()).toBe(stockValue.toString());
  });

  it("confirm posts stock but nothing to GL when the GRNI account is not configured (documented fallback)", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    const gl = new RecordingGlPort();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock, gl, accounts: { inventoryAccountId: "1300-inventory", payableAccountId: "2100-payables", taxAccountId: "1360-input-vat" } });
    expect(gl.postings).toHaveLength(0);
    expect((await stock.getBalanceDetail("item-A", WH)).onHand.toString()).toBe("10.000000");
  });
});

describe("goods receipt — cancel restores both sides", () => {
  const ACCOUNTS: PurchaseGlAccounts = {
    inventoryAccountId: "1300-inventory",
    payableAccountId: "2100-payables",
    taxAccountId: "1360-input-vat",
    goodsReceivedNotInvoicedAccountId: "2150-grni",
  };

  it("cancelling a confirmed receipt reverses stock and rolls the PO back to sent", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    const { InMemoryCostLayers } = await import("../inventory/test-helpers/in-memory-stores.js");
    const layers = new InMemoryCostLayers();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    const cancelled = await cancelGoodsReceipt("gr-1", {
      receipts,
      orders,
      stock,
      layers,
      policy: { requirePoForGrn: false, requireReceiptForInvoice: false, blockOverReceipt: false, trackSoldPurchaseItems: false },
    });
    expect(cancelled.status).toBe("cancelled");
    expect((await stock.getBalanceDetail("item-A", WH)).onHand.toString()).toBe("0.000000");
    const po = await orders.findById("po-1");
    expect(po?.status).toBe("sent");
    expect(po?.lines.every((l) => l.receivedQty.isZero())).toBe(true);
  });
});

describe("goods receipt — auto batch numbers", () => {
  it("stamps a blank line's batchNo via the tenant's autoBatchNo hook, leaving an explicit batchNo alone", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const calls: { itemId: string; receiptNumber: string; lineIndex: number }[] = [];
    const gr = await createGoodsReceipt(
      {
        id: "gr-1",
        purchaseOrderId: "po-1",
        date: "2026-08-22",
        lines: [
          { itemId: "item-A", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("25") },
          { itemId: "item-B", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("12"), batchNo: "MANUAL-1" },
        ],
      },
      {
        receipts,
        orders,
        numbering,
        autoBatchNo: async (input) => {
          calls.push(input);
          return `AUTO-${input.lineIndex}`;
        },
      },
    );
    expect(gr.lines[0]?.batchNo).toBe("AUTO-0");
    expect(gr.lines[1]?.batchNo).toBe("MANUAL-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.itemId).toBe("item-A");
  });

  it("leaves batchNo null when the autoBatchNo hook itself returns null", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const gr = await createGoodsReceipt(
      { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22", lines: [{ itemId: "item-A", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("25") }] },
      { receipts, orders, numbering, autoBatchNo: async () => null },
    );
    expect(gr.lines[0]?.batchNo).toBeNull();
  });
});

describe("goods receipt — cancel with trackSoldPurchaseItems on and nothing consumed", () => {
  it("succeeds when the strictness gate is on but no layer has been drawn down", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    const stock = makeStockService();
    const { InMemoryCostLayers } = await import("../inventory/test-helpers/in-memory-stores.js");
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
    const cancelled = await cancelGoodsReceipt("gr-1", { receipts, orders, stock, layers: new InMemoryCostLayers() });
    expect(cancelled.status).toBe("cancelled");
    expect((await stock.getBalanceDetail("item-A", WH)).onHand.toString()).toBe("0.000000");
  });
});

describe("markGoodsReceiptInvoiced", () => {
  it("flags a receipt invoiced, idempotently", async () => {
    const { orders, numbering } = await sentOrder();
    const receipts = new InMemoryGoodsReceipts();
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    await markGoodsReceiptInvoiced("gr-1", { receipts });
    expect((await receipts.findById("gr-1"))?.invoiced).toBe(true);
    await expect(markGoodsReceiptInvoiced("gr-1", { receipts })).resolves.toBeUndefined();
  });

  it("404s marking an unknown receipt invoiced", async () => {
    const receipts = new InMemoryGoodsReceipts();
    await expect(markGoodsReceiptInvoiced("nope", { receipts })).rejects.toThrow(GoodsReceiptNotFoundError);
  });
});

describe("buildReceiptLinesFromOrder", () => {
  it("skips lines already fully received", async () => {
    const { orders } = await sentOrder();
    const order = await orders.findById("po-1");
    const partially = {
      ...order!,
      lines: [
        { ...order!.lines[0]!, receivedQty: order!.lines[0]!.qty },
        order!.lines[1]!,
      ],
    };
    const lines = buildReceiptLinesFromOrder(partially);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.itemId).toBe("item-B");
  });
});
