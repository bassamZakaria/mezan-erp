import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import {
  createPurchaseInvoice,
  confirmPurchaseInvoice,
  cancelPurchaseInvoice,
  buildInvoiceLinesFromReceipt,
  buildInvoicePosting,
  purchaseInvoiceLineBase,
  purchaseInvoiceLineTax,
  purchaseInvoiceSubtotal,
  purchaseInvoiceInventoryBase,
  purchaseInvoiceFreightBase,
  purchaseInvoiceExpenseBase,
  purchaseInvoiceTax,
  purchaseInvoiceTotal,
  purchaseInvoiceBaseTotal,
  type PurchaseInvoice,
} from "./purchase-invoice.js";
import { createPurchaseOrder, confirmPurchaseOrder } from "./purchase-order.js";
import { createGoodsReceipt, confirmGoodsReceipt } from "./goods-receipt.js";
import type { AllocatableInvoiceRepository, AllocatableInvoice } from "../vouchers/allocation.js";
import type { PurchaseGlAccounts, PurchaseGlPosting } from "./types.js";
import {
  GoodsReceiptAlreadyInvoicedError,
  GoodsReceiptNotFoundError,
  InvalidPurchaseDocumentError,
  PurchaseInvoiceNotFoundError,
} from "./errors.js";
import {
  InMemoryPurchaseOrders,
  InMemoryGoodsReceipts,
  InMemoryPurchaseInvoices,
  RecordingGlPort,
  makeNumbering,
  makeStockService,
} from "./test-helpers.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";

import { InvalidStockMovementError } from "../inventory/errors.js";
import { ReversalDateBeforeOriginalError } from "../gl/errors.js";
import { PurchaseItemsAlreadyConsumedError } from "./errors.js";

const now = () => "2026-08-21T09:00:00.000Z";
const WH = "MAIN-WH";
const ACCOUNTS: PurchaseGlAccounts = {
  inventoryAccountId: "1300-inventory",
  payableAccountId: "2100-ap",
  taxAccountId: "1360-input-vat",
  freightAccountId: "5200-freight",
};

class RecordingAllocatable implements AllocatableInvoiceRepository {
  readonly saved: AllocatableInvoice[] = [];
  async findById(id: string): Promise<AllocatableInvoice | null> {
    return this.saved.find((s) => s.id === id) ?? null;
  }
  async save(invoice: AllocatableInvoice): Promise<void> {
    this.saved.push(invoice);
  }
  async listOpen(): Promise<readonly AllocatableInvoice[]> {
    return this.saved;
  }
  async allocatedByIds(ids: readonly string[]): Promise<ReadonlyMap<string, Money>> {
    const out = new Map<string, Money>();
    for (const id of ids) {
      const invoice = this.saved.find((s) => s.id === id);
      if (invoice) out.set(id, invoice.allocated);
    }
    return out;
  }
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

async function receivedChain() {
  const orders = new InMemoryPurchaseOrders();
  const receipts = new InMemoryGoodsReceipts();
  const invoices = new InMemoryPurchaseInvoices();
  const numbering = makeNumbering();
  const stock = makeStockService();
  await createPurchaseOrder(poBase(), { orders, numbering, now });
  await confirmPurchaseOrder("po-1", { orders });
  await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
  await confirmGoodsReceipt("gr-1", { receipts, orders, stock });
  return { orders, receipts, invoices, numbering, stock };
}

describe("pure computations", () => {
  const invLine = {
    itemId: "item-A",
    description: null,
    kind: "inventory" as const,
    qty: Qty.fromMajor("3"),
    unitCost: Money.fromMajor("100"),
    taxRatePercent: 14,
  };

  it("line base and tax (HALF_UP)", () => {
    expect(purchaseInvoiceLineBase(invLine).toString()).toBe("300.000000");
    expect(purchaseInvoiceLineTax(invLine).toString()).toBe("42.000000");
  });

  it("tax rounds HALF_UP at the 1e-6 boundary", () => {
    const odd = { qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("0.000005"), taxRatePercent: 50 };
    // base 0.000005 * 50% = 0.0000025 -> rounds up to 0.000003 (half up away from zero)
    expect(purchaseInvoiceLineTax(odd).toString()).toBe("0.000003");
  });

  it("subtotal/inventory/freight/expense split by kind, tax and total", () => {
    const invoice = {
      lines: [
        { itemId: "item-A", description: null, kind: "inventory" as const, qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("50"), taxRatePercent: 14 },
        { itemId: null, description: "شحن", kind: "freight" as const, qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("30"), taxRatePercent: 0 },
        { itemId: null, description: "أخرى", kind: "expense" as const, qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10"), taxRatePercent: 0 },
      ],
    };
    expect(purchaseInvoiceSubtotal(invoice).toString()).toBe("240.000000");
    expect(purchaseInvoiceInventoryBase(invoice).toString()).toBe("200.000000");
    expect(purchaseInvoiceFreightBase(invoice).toString()).toBe("30.000000");
    expect(purchaseInvoiceExpenseBase(invoice).toString()).toBe("10.000000");
    expect(purchaseInvoiceTax(invoice).toString()).toBe("28.000000");
    expect(purchaseInvoiceTotal(invoice).toString()).toBe("268.000000");
  });

  it("purchaseInvoiceBaseTotal falls back to the document total with no fxRate", () => {
    const invoice = { lines: [invLine], fxRate: null };
    expect(purchaseInvoiceBaseTotal(invoice).toString()).toBe(purchaseInvoiceTotal(invoice).toString());
  });

  it("purchaseInvoiceBaseTotal converts component-by-component at the stamped fxRate", () => {
    const invoice = { lines: [invLine], fxRate: "50" };
    // base 300 * 50 = 15000, tax 42 * 50 = 2100 -> 17100
    expect(purchaseInvoiceBaseTotal(invoice).toString()).toBe("17100.000000");
  });
});

describe("buildInvoiceLinesFromReceipt — the auto-fill (bare receiptId) input shape", () => {
  it("defaults every line's tax rate to 0% when no resolver is supplied", async () => {
    const { receipts } = await receivedChain();
    const receipt = await receipts.findById("gr-1");
    const lines = buildInvoiceLinesFromReceipt(receipt!);
    expect(lines.every((l) => l.taxRatePercent === 0)).toBe(true);
  });

  it("uses the ITEM's real tax rate when a resolver is wired, not a hardcoded default", async () => {
    const { receipts } = await receivedChain();
    const receipt = await receipts.findById("gr-1");
    const rateByItem: Record<string, number> = { "item-A": 14, "item-B": 5 };
    const lines = buildInvoiceLinesFromReceipt(receipt!, (itemId) => rateByItem[itemId] ?? 0);
    expect(lines.find((l) => l.itemId === "item-A")?.taxRatePercent).toBe(14);
    expect(lines.find((l) => l.itemId === "item-B")?.taxRatePercent).toBe(5);
    expect(lines.every((l) => l.taxRatePercent !== 0)).toBe(true);
  });

  it("carries the receipt's own unit cost, batch and expiry onto each line", async () => {
    const { receipts, orders, numbering } = await receivedChain();
    // A second receipt line with batch/expiry, ad-hoc so it is easy to control.
    const receipts2 = new InMemoryGoodsReceipts();
    await createGoodsReceipt(
      {
        id: "gr-x",
        date: "2026-08-22",
        supplierId: "sup-1",
        warehouseId: WH,
        lines: [{ itemId: "item-C", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("9.50"), batchNo: "B1", expiryDate: "2027-01-01" }],
      },
      { receipts: receipts2, orders, numbering },
    );
    const receipt = await receipts2.findById("gr-x");
    const lines = buildInvoiceLinesFromReceipt(receipt!, () => 14);
    expect(lines[0]).toMatchObject({ itemId: "item-C", unitCost: expect.anything(), batchNo: "B1", expiryDate: "2027-01-01" });
    expect(lines[0]?.unitCost.toString()).toBe("9.500000");
    void receipts;
  });
});

describe("createPurchaseInvoice — both input shapes", () => {
  it("explicit-lines (manual) shape: creates a draft invoice not linked to any receipt", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const inv = await createPurchaseInvoice(
      {
        id: "pi-manual",
        supplierId: "sup-2",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        lines: [{ itemId: "item-Z", kind: "inventory", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("40"), taxRatePercent: 14 }],
      },
      { invoices, numbering },
    );
    expect(inv.receiptId).toBeNull();
    expect(inv.lines[0]?.taxRatePercent).toBe(14);
  });

  it("bare-receiptId shape: lines are pre-built via buildInvoiceLinesFromReceipt and the invoice links back to the receipt", async () => {
    const { receipts, invoices, numbering } = await receivedChain();
    const receipt = await receipts.findById("gr-1");
    const lines = buildInvoiceLinesFromReceipt(receipt!, () => 14);
    const inv = await createPurchaseInvoice(
      { id: "pi-1", supplierId: "sup-1", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, receiptId: "gr-1", lines },
      { invoices, receipts, numbering },
    );
    expect(inv.receiptId).toBe("gr-1");
    expect(inv.lines.every((l) => l.taxRatePercent === 14)).toBe(true);
    expect(purchaseInvoiceTax(inv).toString()).toBe("43.400000");
  });

  it("refuses a receiptId pointing at an unconfirmed (draft) receipt", async () => {
    const orders = new InMemoryPurchaseOrders();
    const receipts = new InMemoryGoodsReceipts();
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    await createPurchaseOrder(poBase(), { orders, numbering, now });
    await confirmPurchaseOrder("po-1", { orders });
    await createGoodsReceipt({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-22" }, { receipts, orders, numbering });
    const receipt = await receipts.findById("gr-1");
    await expect(
      createPurchaseInvoice(
        { id: "pi-1", supplierId: "sup-1", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, receiptId: "gr-1", lines: buildInvoiceLinesFromReceipt(receipt!) },
        { invoices, receipts, numbering },
      ),
    ).rejects.toThrow(InvalidPurchaseDocumentError);
  });

  it("404s a receiptId that does not exist", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const receipts = new InMemoryGoodsReceipts();
    const numbering = makeNumbering();
    await expect(
      createPurchaseInvoice(
        { id: "pi-1", supplierId: "sup-1", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, receiptId: "nope", lines: [] },
        { invoices, receipts, numbering },
      ),
    ).rejects.toThrow(GoodsReceiptNotFoundError);
  });

  it("rejects a duplicate invoice id", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const cmd = {
      id: "pi-1",
      supplierId: "sup-2",
      date: "2026-08-23",
      branchId: "MAIN",
      warehouseId: WH,
      lines: [{ itemId: "item-Z", kind: "inventory" as const, qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }],
    };
    await createPurchaseInvoice(cmd, { invoices, numbering });
    await expect(createPurchaseInvoice(cmd, { invoices, numbering })).rejects.toThrow(DuplicateRecordIdError);
  });

  it("rejects an inventory line with no item id", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    await expect(
      createPurchaseInvoice(
        { id: "pi-1", supplierId: "sup-2", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, lines: [{ itemId: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }] },
        { invoices, numbering },
      ),
    ).rejects.toThrow(/بند المخزون يتطلب صنفاً/);
  });
});

describe("createPurchaseInvoice — receiving twice against the same receipt is refused", () => {
  it("a second invoice against an already-invoiced receipt is rejected even while the receipt is still 'confirmed'", async () => {
    const { receipts, invoices, numbering, stock } = await receivedChain();
    const receipt = await receipts.findById("gr-1");
    await createPurchaseInvoice(
      { id: "pi-1", supplierId: "sup-1", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, receiptId: "gr-1", lines: buildInvoiceLinesFromReceipt(receipt!, () => 14) },
      { invoices, receipts, numbering },
    );
    const gl = new RecordingGlPort();
    await confirmPurchaseInvoice("pi-1", { invoices, receipts, stock, gl, accounts: ACCOUNTS, now });
    expect((await receipts.findById("gr-1"))?.invoiced).toBe(true);

    await expect(
      createPurchaseInvoice(
        { id: "pi-2", supplierId: "sup-1", date: "2026-08-24", branchId: "MAIN", warehouseId: WH, receiptId: "gr-1", lines: buildInvoiceLinesFromReceipt(receipt!, () => 14) },
        { invoices, receipts, numbering },
      ),
    ).rejects.toThrow(GoodsReceiptAlreadyInvoicedError);
  });
});

describe("confirmPurchaseInvoice — sub-ledger (AP) and GL control account both move", () => {
  it("from-receipt invoice: GL payable credit equals the AP sub-ledger's recorded total", async () => {
    const { receipts, invoices, numbering, stock } = await receivedChain();
    const receipt = await receipts.findById("gr-1");
    await createPurchaseInvoice(
      { id: "pi-1", supplierId: "sup-1", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, receiptId: "gr-1", lines: buildInvoiceLinesFromReceipt(receipt!, () => 14) },
      { invoices, receipts, numbering },
    );
    const gl = new RecordingGlPort();
    const allocatable = new RecordingAllocatable();
    const { posting } = await confirmPurchaseInvoice("pi-1", { invoices, receipts, stock, gl, accounts: ACCOUNTS, allocatable, now });

    const apCredit = posting.lines.find((l) => l.accountId === "2100-ap")?.credit as Money;
    expect(allocatable.saved).toHaveLength(1);
    expect(allocatable.saved[0]?.total.toString()).toBe(apCredit.toString());
    expect(allocatable.saved[0]?.kind).toBe("purchase");
    expect(allocatable.saved[0]?.partyId).toBe("sup-1");
  });

  it("manual invoice: stock, GL and AP sub-ledger all agree on the same total", async () => {
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
        lines: [{ itemId: "item-C", kind: "inventory", qty: Qty.fromMajor("4"), unitCost: Money.fromMajor("50.00"), taxRatePercent: 14 }],
      },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    const allocatable = new RecordingAllocatable();
    const { posting } = await confirmPurchaseInvoice("pi-m", { invoices, stock, gl, accounts: ACCOUNTS, allocatable, now });
    const apCredit = posting.lines.find((l) => l.accountId === "2100-ap")?.credit as Money;
    expect(allocatable.saved[0]?.total.toString()).toBe(apCredit.toString());
    expect((await stock.getBalanceDetail("item-C", WH)).totalValue.toString()).toBe("200.000000");
  });

  it("posts nothing to the AP sub-ledger when no allocatable port is wired (documented gap)", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      { id: "pi-n", supplierId: "sup-2", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, lines: [{ itemId: "item-C", kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10") }] },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    await confirmPurchaseInvoice("pi-n", { invoices, stock, gl, accounts: ACCOUNTS, now });
    expect(gl.postings).toHaveLength(1);
  });

  it("refuses to confirm a foreign-currency invoice with no exchange rate on file", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      { id: "pi-fx", supplierId: "sup-2", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, currency: "USD", lines: [{ itemId: "item-C", kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("10") }] },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    await expect(
      confirmPurchaseInvoice("pi-fx", { invoices, stock, gl, accounts: ACCOUNTS, now, baseCurrency: "EGP" }),
    ).rejects.toThrow(InvalidPurchaseDocumentError);
  });

  it("converts a foreign-currency invoice to base at the confirmed rate, stamping fxRate on the payable line", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      { id: "pi-fx", supplierId: "sup-2", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, currency: "USD", lines: [{ itemId: "item-C", kind: "inventory", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10") }] },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    const exchangeRates = { findRate: async () => ({ rate: "50" }) };
    const { invoice, posting } = await confirmPurchaseInvoice("pi-fx", {
      invoices,
      stock,
      gl,
      accounts: ACCOUNTS,
      now,
      baseCurrency: "EGP",
      exchangeRates,
    });
    expect(invoice.fxRate).toBe("50");
    const payableLine = posting.lines.find((l) => l.accountId === "2100-ap");
    expect(payableLine?.credit.toString()).toBe("1000.000000"); // 20 USD base value * 50
    expect(payableLine?.currency).toBe("USD");
    expect(payableLine?.fxRate).toBe("50");
    // stock is valued in BASE currency too, matching the GL inventory debit
    expect((await stock.getBalanceDetail("item-C", WH)).totalValue.toString()).toBe("1000.000000");
  });

  it("D213: a foreign multi-line invoice balances exactly, credits AP with its per-line base total and stocks the goods at the GL debit", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      {
        id: "pi-d213",
        supplierId: "sup-2",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        currency: "USD",
        lines: [
          { itemId: "item-C", kind: "inventory", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("0.333333"), taxRatePercent: 14 },
          { itemId: "item-D", kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("0.333333"), taxRatePercent: 14 },
          { itemId: null, description: "شحن", kind: "freight", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("0.333333") },
        ],
      },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    const { invoice, posting } = await confirmPurchaseInvoice("pi-d213", {
      invoices,
      stock,
      gl,
      accounts: ACCOUNTS,
      now,
      baseCurrency: "EGP",
      exchangeRates: { findRate: async () => ({ rate: "1.5" }) },
    });
    const debit = Money.sum(posting.lines.map((l) => l.debit));
    const credit = Money.sum(posting.lines.map((l) => l.credit));
    expect(debit.toString()).toBe(credit.toString());
    const payable = posting.lines.find((l) => l.accountId === "2100-ap")!;
    expect(payable.credit.toString()).toBe(purchaseInvoiceBaseTotal(invoice).toString());
    const inventoryDebit = Money.sum(posting.lines.filter((l) => l.accountId === ACCOUNTS.inventoryAccountId).map((l) => l.debit));
    const stocked = (await stock.getBalanceDetail("item-C", WH)).totalValue.add((await stock.getBalanceDetail("item-D", WH)).totalValue);
    expect(stocked.toString()).toBe(inventoryDebit.toString());
    expect(inventoryDebit.toString()).toBe("1.999999");
  });

  it("404s confirming an unknown invoice", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const stock = makeStockService();
    const gl = new RecordingGlPort();
    await expect(confirmPurchaseInvoice("nope", { invoices, stock, gl, accounts: ACCOUNTS, now })).rejects.toThrow(
      PurchaseInvoiceNotFoundError,
    );
  });
});

/**
 * guards B-7 — the GL posted first with a deterministic id (`PI-JE:<invoiceId>`)
 * and nothing wrapped the confirm, so a failure after it left the invoice
 * `draft` beside a live entry and every retry threw a duplicate-id refusal.
 * The invoice could never be confirmed again.
 */
describe("confirmPurchaseInvoice — one transaction", () => {
  /** A ledger-shaped transactor: a throw inside rolls every recorded write back. */
  function atomicGl() {
    const postings: PurchaseGlPosting[] = [];
    let failNext = false;
    return {
      postings,
      failAfterPost() {
        failNext = true;
      },
      async post(posting: PurchaseGlPosting) {
        postings.push(posting);
      },
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        const mark = postings.length;
        try {
          return await fn();
        } catch (err) {
          postings.length = mark;
          throw err;
        }
      },
      stockPort: {
        async postReceipt() {
          if (failNext) throw new Error("stock store went away mid-confirm");
          return { coverVariance: Money.zero() };
        },
      },
    };
  }

  async function draftInvoice() {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    await createPurchaseInvoice(
      {
        id: "pi-tx",
        supplierId: "sup-9",
        date: "2026-08-23",
        branchId: "MAIN",
        warehouseId: WH,
        lines: [{ itemId: "item-C", kind: "inventory", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("100.00"), taxRatePercent: 14 }],
      },
      { invoices, numbering },
    );
    return invoices;
  }

  it("a failure after the GL post leaves NO entry and NO confirmed invoice", async () => {
    const invoices = await draftInvoice();
    const gl = atomicGl();
    gl.failAfterPost();

    await expect(
      confirmPurchaseInvoice("pi-tx", { invoices, stock: gl.stockPort as never, gl, accounts: ACCOUNTS, now }),
    ).rejects.toThrow("stock store went away mid-confirm");

    expect(gl.postings).toHaveLength(0);
    expect((await invoices.findById("pi-tx"))?.status).toBe("draft");
  });

  it("and the invoice retries cleanly afterwards — one entry, one confirm", async () => {
    const invoices = await draftInvoice();
    const gl = atomicGl();
    gl.failAfterPost();
    await expect(
      confirmPurchaseInvoice("pi-tx", { invoices, stock: gl.stockPort as never, gl, accounts: ACCOUNTS, now }),
    ).rejects.toThrow();

    const stock = makeStockService();
    const { invoice } = await confirmPurchaseInvoice("pi-tx", { invoices, stock, gl, accounts: ACCOUNTS, now });
    expect(invoice.status).toBe("confirmed");
    expect(gl.postings).toHaveLength(1);
  });

  it("still confirms when no transactor is wired (the port's transaction is optional)", async () => {
    const invoices = await draftInvoice();
    const stock = makeStockService();
    const gl = new RecordingGlPort();
    const { invoice } = await confirmPurchaseInvoice("pi-tx", { invoices, stock, gl, accounts: ACCOUNTS, now });
    expect(invoice.status).toBe("confirmed");
    expect(gl.postings).toHaveLength(1);
  });
});

describe("buildInvoicePosting", () => {
  it("balances (Σ debit === Σ credit) with mixed inventory/freight/expense/tax lines", () => {
    const invoice: PurchaseInvoice = {
      id: "pi-1",
      number: "PI-000001",
      supplierId: "sup-1",
      date: "2026-08-23",
      dueDate: null,
      supplierInvoiceNumber: null,
      branchId: "MAIN",
      warehouseId: WH,
      currency: "EGP",
      notes: null,
      receiptId: null,
      lines: [
        { itemId: "item-A", description: null, kind: "inventory", qty: Qty.fromMajor("3"), unitCost: Money.fromMajor("7.33"), taxRatePercent: 14, batchNo: null, expiryDate: null },
        { itemId: null, description: "شحن", kind: "freight", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("5"), taxRatePercent: 0, batchNo: null, expiryDate: null },
      ],
      status: "draft",
      fxRate: null,
      createdBy: "system",
      createdAt: now(),
    };
    const posting = buildInvoicePosting(invoice, ACCOUNTS);
    const debit = Money.sum(posting.lines.map((l) => l.debit));
    const credit = Money.sum(posting.lines.map((l) => l.credit));
    expect(debit.equals(credit)).toBe(true);
  });

  it("splits input VAT into one line per distinct rate charged", () => {
    const invoice: PurchaseInvoice = {
      id: "pi-1",
      number: "PI-000001",
      supplierId: "sup-1",
      date: "2026-08-23",
      dueDate: null,
      supplierInvoiceNumber: null,
      branchId: "MAIN",
      warehouseId: WH,
      currency: "EGP",
      notes: null,
      receiptId: null,
      lines: [
        { itemId: "item-A", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100"), taxRatePercent: 14, batchNo: null, expiryDate: null },
        { itemId: "item-B", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100"), taxRatePercent: 5, batchNo: null, expiryDate: null },
      ],
      status: "draft",
      fxRate: null,
      createdBy: "system",
      createdAt: now(),
    };
    const posting = buildInvoicePosting(invoice, ACCOUNTS);
    const taxLines = posting.lines.filter((l) => l.accountId === "1360-input-vat");
    expect(taxLines).toHaveLength(2);
    expect(taxLines.map((l) => l.taxRatePercent).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([5, 14]);
    const taxSum = Money.sum(taxLines.map((l) => l.debit));
    expect(taxSum.toString()).toBe(purchaseInvoiceTax(invoice).toString());
  });

  it("a from-receipt invoice with a GRNI account clears GRNI instead of debiting inventory directly", () => {
    const invoice: PurchaseInvoice = {
      id: "pi-1",
      number: "PI-000001",
      supplierId: "sup-1",
      date: "2026-08-23",
      dueDate: null,
      supplierInvoiceNumber: null,
      branchId: "MAIN",
      warehouseId: WH,
      currency: "EGP",
      notes: null,
      receiptId: "gr-1",
      lines: [{ itemId: "item-A", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100"), taxRatePercent: 0, batchNo: null, expiryDate: null }],
      status: "draft",
      fxRate: null,
      createdBy: "system",
      createdAt: now(),
    };
    const withGrni = buildInvoicePosting(invoice, { ...ACCOUNTS, goodsReceivedNotInvoicedAccountId: "2150-grni" });
    expect(withGrni.lines.find((l) => l.debit.scaled > 0n)?.accountId).toBe("2150-grni");

    const withoutGrni = buildInvoicePosting(invoice, ACCOUNTS);
    expect(withoutGrni.lines.find((l) => l.debit.scaled > 0n)?.accountId).toBe("1300-inventory");
  });

  it("carries the header projectId on every line and costCategory only on the cost (inventory/freight/expense) lines", () => {
    const invoice: PurchaseInvoice = {
      id: "pi-1",
      number: "PI-000001",
      supplierId: "sup-1",
      date: "2026-08-23",
      dueDate: null,
      supplierInvoiceNumber: null,
      branchId: "MAIN",
      warehouseId: WH,
      currency: "EGP",
      notes: null,
      receiptId: null,
      projectId: "proj-1",
      lines: [
        { itemId: "item-A", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100"), taxRatePercent: 14, batchNo: null, expiryDate: null, costCategory: "materials" },
      ],
      status: "draft",
      fxRate: null,
      createdBy: "system",
      createdAt: now(),
    };
    const posting = buildInvoicePosting(invoice, ACCOUNTS);
    expect(posting.lines.every((l) => l.projectId === "proj-1")).toBe(true);
    const inventoryLine = posting.lines.find((l) => l.accountId === "1300-inventory");
    const payableLine = posting.lines.find((l) => l.accountId === "2100-ap");
    const taxLine = posting.lines.find((l) => l.accountId === "1360-input-vat");
    expect(inventoryLine?.costCategory).toBe("materials");
    expect(payableLine?.costCategory).toBeUndefined();
    expect(taxLine?.costCategory).toBeUndefined();
  });
});

describe("createPurchaseInvoice — projectId / costCategory validation", () => {
  it("refuses a line costCategory when the invoice carries no projectId", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    await expect(
      createPurchaseInvoice(
        {
          id: "pi-1",
          supplierId: "sup-1",
          date: "2026-08-23",
          branchId: "MAIN",
          warehouseId: WH,
          lines: [{ itemId: "item-A", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100"), costCategory: "materials" }],
        },
        { invoices, numbering },
      ),
    ).rejects.toThrow(InvalidPurchaseDocumentError);
  });
});

describe("cancelPurchaseInvoice — goods that have already left", () => {
  async function soldOut(trackSoldPurchaseItems: boolean) {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const { InMemoryCostLayers, InMemorySnapshots, InMemoryStockLedger } = await import("../inventory/test-helpers/in-memory-stores.js");
    const { StockLedgerService } = await import("../inventory/stock-ledger-service.js");
    const layers = new InMemoryCostLayers();
    const stock = new StockLedgerService({ ledger: new InMemoryStockLedger(), layers, snapshots: new InMemorySnapshots(), policy: { allowNegativeStock: false } });
    await createPurchaseInvoice(
      { id: "pi-sold", supplierId: "sup-2", date: "2026-06-04", branchId: "MAIN", warehouseId: WH, lines: [{ itemId: "item-S", kind: "inventory", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10.00") }] },
      { invoices, numbering },
    );
    await confirmPurchaseInvoice("pi-sold", { invoices, stock, gl: new RecordingGlPort(), accounts: ACCOUNTS, now });
    await stock.postIssue({ issueId: "sale-1", sourceDocType: "SALES_INVOICE", sourceDocId: "sale-1", warehouseId: WH, occurredAt: "2026-06-20T00:00:00.000Z", lines: [{ itemId: "item-S", qty: Qty.fromMajor("2") }] });
    const glReverse = { calls: [] as unknown[], async reverse(id: string, opts: unknown) { this.calls.push({ id, opts }); } };
    const cancel = cancelPurchaseInvoice("pi-sold", {
      invoices,
      stock,
      glReverse: glReverse as never,
      layers,
      policy: { requirePoForGrn: false, requireReceiptForInvoice: false, blockOverReceipt: false, trackSoldPurchaseItems },
    });
    return { cancel, glReverse, invoices };
  }

  it("refuses when every unit has been issued — the layer is gone, which is consumed, not untouched", async () => {
    const { cancel, glReverse, invoices } = await soldOut(true);
    await expect(cancel).rejects.toThrow(PurchaseItemsAlreadyConsumedError);
    expect(glReverse.calls).toEqual([]);
    expect((await invoices.findById("pi-sold"))?.status).toBe("confirmed");
  });

  it("with the policy off the stock ledger still refuses, before anything reaches the GL", async () => {
    const { cancel, glReverse, invoices } = await soldOut(false);
    await expect(cancel).rejects.toThrow(InvalidStockMovementError);
    expect(glReverse.calls).toEqual([]);
    expect((await invoices.findById("pi-sold"))?.status).toBe("confirmed");
  });

  it("dates the GL reversal and the stock reversal on the same day — the cancel's, not the invoice's", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      { id: "pi-d", supplierId: "sup-2", date: "2026-06-04", branchId: "MAIN", warehouseId: WH, lines: [{ itemId: "item-D", kind: "inventory", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10.00") }] },
      { invoices, numbering },
    );
    await confirmPurchaseInvoice("pi-d", { invoices, stock, gl: new RecordingGlPort(), accounts: ACCOUNTS, now });
    const glReverse = { calls: [] as { id: string; opts: { date: string } }[], async reverse(id: string, opts: { date: string }) { this.calls.push({ id, opts }); } };
    const { InMemoryCostLayers } = await import("../inventory/test-helpers/in-memory-stores.js");
    const deps = { invoices, stock, glReverse: glReverse as never, layers: new InMemoryCostLayers(), policy: { requirePoForGrn: false, requireReceiptForInvoice: false, blockOverReceipt: false, trackSoldPurchaseItems: false } };

    await expect(cancelPurchaseInvoice("pi-d", deps, { date: "2026-06-03" })).rejects.toThrow(ReversalDateBeforeOriginalError);
    await cancelPurchaseInvoice("pi-d", deps, { date: "2026-07-10" });

    expect(glReverse.calls.map((c) => c.opts.date)).toEqual(["2026-07-10"]);
    expect((await stock.getMovementsOfDocument("pi-d:cancel")).map((m) => m.occurredAt)).toEqual(["2026-07-10T00:00:00.000Z"]);
  });
});

describe("cancelPurchaseInvoice — restores both sides", () => {
  it("cancels a confirmed manual invoice: reverses GL and its own stock posting", async () => {
    const invoices = new InMemoryPurchaseInvoices();
    const numbering = makeNumbering();
    const stock = makeStockService();
    await createPurchaseInvoice(
      { id: "pi-c", supplierId: "sup-2", date: "2026-08-23", branchId: "MAIN", warehouseId: WH, lines: [{ itemId: "item-Q", kind: "inventory", qty: Qty.fromMajor("2"), unitCost: Money.fromMajor("10.00") }] },
      { invoices, numbering },
    );
    const gl = new RecordingGlPort();
    await confirmPurchaseInvoice("pi-c", { invoices, stock, gl, accounts: ACCOUNTS, now });
    expect((await stock.getBalanceDetail("item-Q", WH)).onHand.toString()).toBe("2.000000");

    const glReverse = { calls: [] as unknown[], async reverse(id: string, opts: unknown) { this.calls.push({ id, opts }); } };
    const { InMemoryCostLayers } = await import("../inventory/test-helpers/in-memory-stores.js");
    const cancelled = await cancelPurchaseInvoice("pi-c", {
      invoices,
      stock,
      glReverse: glReverse as never,
      layers: new InMemoryCostLayers(),
      policy: { requirePoForGrn: false, requireReceiptForInvoice: false, blockOverReceipt: false, trackSoldPurchaseItems: false },
    });
    expect(cancelled.status).toBe("cancelled");
    expect(glReverse.calls).toHaveLength(1);
    expect((await stock.getBalanceDetail("item-Q", WH)).onHand.toString()).toBe("0.000000");
  });
});
