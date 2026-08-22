import { describe, it, expect } from "vitest";
import {
  Money,
  Qty,
  createPurchaseOrder,
  confirmPurchaseOrder,
  createGoodsReceipt,
  confirmGoodsReceipt,
  createPurchaseInvoice,
  buildInvoiceLinesFromReceipt,
  NextNumberService,
  StockLedgerService,
  type PurchaseGlPosting,
} from "@mezan/domain";
import { createSqlitePurchasingStores } from "./purchasing-stores.js";
import { createSqliteStockLedgerStore } from "./stock-ledger-store.js";
import { createSqliteSequenceStore } from "./sequence-store.js";

const now = () => "2026-08-21T09:00:00.000Z";

describe("SQLite purchasing stores", () => {
  it("round-trips the whole PO → GRN → invoice chain through SQLite", async () => {
    const stores = createSqlitePurchasingStores(":memory:");
    const seq = createSqliteSequenceStore(":memory:");
    const numbering = new NextNumberService(seq);
    const stockStore = createSqliteStockLedgerStore(":memory:");
    const stock = new StockLedgerService({
      ledger: stockStore.ledger,
      layers: stockStore.layers,
      snapshots: stockStore.snapshots,
      policy: { allowNegativeStock: false },
      clock: now,
    });

    const po = await createPurchaseOrder(
      {
        id: "po-1",
        supplierId: "sup-1",
        date: "2026-08-21",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "item-A", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25.00") }],
      },
      { orders: stores.orders, numbering, now },
    );
    expect(po.number).toBe("PO-000001");
    await confirmPurchaseOrder("po-1", { orders: stores.orders });

    const reloaded = await stores.orders.findById("po-1");
    expect(reloaded?.status).toBe("sent");
    expect(reloaded?.lines[0]?.qty.toString()).toBe("10.000000");
    expect(reloaded?.lines[0]?.unitPrice.toString()).toBe("25.000000");

    await createGoodsReceipt(
      { id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" },
      { receipts: stores.receipts, orders: stores.orders, numbering },
    );
    await confirmGoodsReceipt("gr-1", { receipts: stores.receipts, orders: stores.orders, stock });

    const grReloaded = await stores.receipts.findById("gr-1");
    expect(grReloaded?.status).toBe("confirmed");
    expect((await stores.orders.findById("po-1"))?.status).toBe("fully_received");
    expect((await stock.getBalanceDetail("item-A", "MAIN-WH")).onHand.toString()).toBe("10.000000");

    const receipt = await stores.receipts.findById("gr-1");
    const inv = await createPurchaseInvoice(
      {
        id: "pi-1",
        supplierId: "sup-1",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        receiptId: "gr-1",
        lines: buildInvoiceLinesFromReceipt(receipt!, () => 14),
      },
      { invoices: stores.invoices, receipts: stores.receipts, numbering },
    );
    expect(inv.number).toBe("PI-000001");

    const piReloaded = await stores.invoices.findById("pi-1");
    expect(piReloaded?.receiptId).toBe("gr-1");
    expect(piReloaded?.lines[0]?.taxRatePercent).toBe(14);
    expect(piReloaded?.lines[0]?.kind).toBe("inventory");
    expect(piReloaded?.lines[0]?.unitCost.toString()).toBe("25.000000");

    stores.close();
    seq.close();
    stockStore.close();
  });

  it("lists receipts by order", async () => {
    const stores = createSqlitePurchasingStores(":memory:");
    const numbering = new NextNumberService(createSqliteSequenceStore(":memory:"));
    await createPurchaseOrder(
      {
        id: "po-1",
        supplierId: "sup-1",
        date: "2026-08-21",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "item-A", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25.00") }],
      },
      { orders: stores.orders, numbering, now },
    );
    await confirmPurchaseOrder("po-1", { orders: stores.orders });
    await createGoodsReceipt(
      {
        id: "gr-1",
        purchaseOrderId: "po-1",
        date: "2026-08-22",
        lines: [{ itemId: "item-A", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("25.00") }],
      },
      { receipts: stores.receipts, orders: stores.orders, numbering },
    );
    const byOrder = await stores.receipts.listByOrder("po-1");
    expect(byOrder).toHaveLength(1);
    // ensure PurchaseGlPosting type import is exercised (compile-time contract)
    const _posting: PurchaseGlPosting | null = null;
    expect(_posting).toBeNull();
    stores.close();
  });
});
