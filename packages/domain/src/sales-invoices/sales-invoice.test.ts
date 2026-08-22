import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
  RecordingAuditSink,
} from "../gl/test-helpers/in-memory-ledger-repository.js";
import { StockLedgerService } from "../inventory/index.js";
import {
  InMemoryStockLedger,
  InMemoryCostLayers,
  InMemorySnapshots,
} from "../inventory/test-helpers/in-memory-stores.js";
import {
  SalesInvoiceService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  computeInvoiceTotals,
  canSalesInvoiceTransition,
  InvalidSalesInvoiceError,
  InvalidSalesInvoiceTransitionError,
  InvalidSalesInvoicePaymentError,
  type CreateSalesInvoiceCommand,
  type SalesInvoiceLine,
} from "./index.js";
import { InMemorySalesInvoiceRepository } from "./test-helpers/in-memory-sales-invoice-repository.js";

/* ------------------------------------------------------------------ */
/* Account ids used across the harness                                 */
/* ------------------------------------------------------------------ */
const AR = "1300"; // المدينون
const REVENUE = "4000"; // إيرادات المبيعات
const TAX = "2200"; // ضريبة القيمة المضافة المستحقة
const COGS = "5000"; // تكلفة البضاعة المباعة
const INVENTORY = "1200"; // المخزون

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

const NOW = "2026-08-22T10:00:00.000Z";

async function harness(opts: { periodStatus?: "open" | "closed" | "locked" } = {}) {
  const accounts = new InMemoryAccountRepository();
  await accounts.create(account(AR));
  await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account(TAX, { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account(COGS, { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account(INVENTORY));

  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: opts.periodStatus ?? "open",
  });

  const ledger = new InMemoryLedgerRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());
  const audit = new RecordingAuditSink();

  const glHook = createSalesInvoiceGlHook({
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => NOW,
    actor: "u1",
  });

  const stockService = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: false },
    clock: () => NOW,
  });
  const stockHook = createSalesInvoiceStockHook(stockService);

  const repo = new InMemorySalesInvoiceRepository();
  const svc = new SalesInvoiceService({
    repo,
    numbering: { next: () => numbering.next("SALES_INVOICE") },
    gl: glHook,
    stock: stockHook,
    audit,
    now: () => NOW,
    actor: "u1",
  });

  return { svc, ledger, stockService, audit };
}

/** Seed a stock position: `qty` units of `itemId` at `unitCost` in `WH1`. */
async function seedStock(
  stockService: StockLedgerService,
  itemId: string,
  qty: string,
  unitCost: string,
): Promise<void> {
  await stockService.recordOpeningBalance({
    adjustmentId: `open-${itemId}`,
    warehouseId: "WH1",
    lines: [{ itemId, qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) }],
  });
}

function line(overrides: Partial<SalesInvoiceLine> & { lineId: string; itemId: string }): SalesInvoiceLine {
  return {
    itemNameAr: overrides.itemId,
    isStock: true,
    qty: Qty.fromMajor("1"),
    unitPrice: Money.fromMajor("0"),
    discountPercent: 0,
    taxRatePercent: 0,
    revenueAccountId: REVENUE,
    cogsAccountId: COGS,
    inventoryAccountId: INVENTORY,
    unitCost: null,
    ...overrides,
  };
}

function draftCmd(overrides: Partial<CreateSalesInvoiceCommand> = {}): CreateSalesInvoiceCommand {
  return {
    id: "inv-1",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    warehouseId: "WH1",
    branchId: "BR1",
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [
      { lineId: "L1", itemId: "ITEM-A", itemNameAr: "صنف أ", isStock: true, qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25"), taxRatePercent: 14, revenueAccountId: REVENUE, cogsAccountId: COGS, inventoryAccountId: INVENTORY },
      { lineId: "L2", itemId: "SVC-1", itemNameAr: "خدمة تركيب", isStock: false, qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("50"), discountPercent: 10, taxRatePercent: 14, revenueAccountId: REVENUE },
    ],
    ...overrides,
  };
}

/* ================================================================== */
/* 1. Totals + rounding                                                */
/* ================================================================== */

describe("computeInvoiceTotals — totals, discounts, tax, rounding", () => {
  it("computes line extension, line discount, tax and grand total to the cent", () => {
    const totals = computeInvoiceTotals(
      [
        line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("10"), unitPrice: Money.fromMajor("25"), taxRatePercent: 14 }),
        line({ lineId: "L2", itemId: "S", isStock: false, qty: Qty.fromMajor("2"), unitPrice: Money.fromMajor("50"), discountPercent: 10, taxRatePercent: 14 }),
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
    const totals = computeInvoiceTotals(
      [line({ lineId: "L1", itemId: "A", qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("33.33"), taxRatePercent: 14 })],
      { type: "amount", amount: Money.zero() },
    );
    expect(totals.lines[0]?.tax.toString()).toBe("4.670000");
    expect(totals.grandTotal.toString()).toBe("38.000000");
  });

  it("allocates an invoice-level discount across lines by largest remainder, reconciling to the cent", () => {
    const totals = computeInvoiceTotals(
      [
        line({ lineId: "L1", itemId: "A", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
        line({ lineId: "L2", itemId: "B", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
        line({ lineId: "L3", itemId: "C", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 0 }),
      ],
      { type: "amount", amount: Money.fromMajor("10") },
    );
    const allocated = totals.lines.map((l) => l.invoiceDiscount.toString());
    expect(allocated).toEqual(["3.340000", "3.330000", "3.330000"]);
    expect(Money.sum(totals.lines.map((l) => l.invoiceDiscount)).toString()).toBe("10.000000");
    expect(totals.taxableTotal.toString()).toBe("290.000000");
    expect(totals.grandTotal.toString()).toBe("290.000000");
  });

  it("applies a percentage invoice discount on the post-line-discount subtotal", () => {
    const totals = computeInvoiceTotals(
      [line({ lineId: "L1", itemId: "A", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("200"), taxRatePercent: 0 })],
      { type: "percent", percent: 5 },
    );
    expect(totals.invoiceDiscountTotal.toString()).toBe("10.000000");
    expect(totals.grandTotal.toString()).toBe("190.000000");
  });

  it("forces tax to zero for a tax-exempt customer", () => {
    const totals = computeInvoiceTotals(
      [line({ lineId: "L1", itemId: "A", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("100"), taxRatePercent: 14 })],
      { type: "amount", amount: Money.zero() },
      { taxExempt: true },
    );
    expect(totals.taxTotal.toString()).toBe("0.000000");
    expect(totals.grandTotal.toString()).toBe("100.000000");
  });
});

/* ================================================================== */
/* 2. Confirm posts correct stock + GL (golden fixture)                */
/* ================================================================== */

describe("SalesInvoiceService.confirm — golden fixture", () => {
  it("issues stock at moving average and posts one balanced revenue+COGS entry", async () => {
    const { svc, ledger, stockService, audit } = await harness();
    await seedStock(stockService, "ITEM-A", "100", "10"); // avg cost 10.00

    await svc.createDraft(draftCmd());
    const { invoice, held } = await svc.confirm("inv-1");

    expect(held).toBe(false);
    expect(invoice.status).toBe("confirmed");
    expect(invoice.docNo).toBe("INV-000001");
    expect(invoice.journalEntryId).toBe("inv-1");

    // Stock: 10 units of ITEM-A left the warehouse at avg 10.00 → 90 on hand.
    const balance = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(balance.onHand.toString()).toBe("90.000000");
    expect(balance.totalValue.toString()).toBe("900.000000");
    expect(invoice.lines[0]?.unitCost?.toString()).toBe("10.000000");

    // GL: one posted, balanced entry.
    const entry = await ledger.findById("inv-1");
    expect(entry?.status).toBe("posted");
    expect(entry?.entryNo).toBe("JE-000001");
    expect(entry?.source).toBe("system");

    const amounts = (accountId: string, side: "debit" | "credit") =>
      Money.sum(
        (entry?.lines ?? []).filter((l) => l.accountId === accountId).map((l) => l[side]),
      ).toString();

    expect(amounts(AR, "debit")).toBe("387.600000"); // grand total
    expect(amounts(REVENUE, "credit")).toBe("340.000000"); // net of discounts
    expect(amounts(TAX, "credit")).toBe("47.600000"); // VAT
    expect(amounts(COGS, "debit")).toBe("100.000000"); // 10 × 10.00
    expect(amounts(INVENTORY, "credit")).toBe("100.000000");

    const totalDebit = Money.sum((entry?.lines ?? []).map((l) => l.debit));
    const totalCredit = Money.sum((entry?.lines ?? []).map((l) => l.credit));
    expect(totalDebit.toString()).toBe(totalCredit.toString());
    expect(totalDebit.toString()).toBe("487.600000");

    expect(audit.events.at(-1)?.action).toBe("CONFIRM");
  });

  it("blocks confirming an invoice whose total is zero", async () => {
    const { svc } = await harness();
    await svc.createDraft(
      draftCmd({
        id: "inv-zero",
        lines: [line({ lineId: "L1", itemId: "A", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.zero() })],
      }),
    );
    await expect(svc.confirm("inv-zero")).rejects.toBeInstanceOf(InvalidSalesInvoiceError);
  });
});

/* ================================================================== */
/* 3. Status transitions                                               */
/* ================================================================== */

describe("sales-invoice lifecycle transitions", () => {
  it("permits the canonical transitions and forbids illegal ones", () => {
    expect(canSalesInvoiceTransition("draft", "confirmed")).toBe(true);
    expect(canSalesInvoiceTransition("draft", "cancelled")).toBe(true);
    expect(canSalesInvoiceTransition("confirmed", "partially_paid")).toBe(true);
    expect(canSalesInvoiceTransition("partially_paid", "paid")).toBe(true);
    expect(canSalesInvoiceTransition("confirmed", "reversed")).toBe(true);

    expect(canSalesInvoiceTransition("draft", "paid")).toBe(false);
    expect(canSalesInvoiceTransition("confirmed", "cancelled")).toBe(false); // live → must reverse
    expect(canSalesInvoiceTransition("paid", "confirmed")).toBe(false);
    expect(canSalesInvoiceTransition("cancelled", "confirmed")).toBe(false);
  });

  it("cancel moves a draft to cancelled but refuses a confirmed invoice", async () => {
    const { svc, stockService } = await harness();
    await seedStock(stockService, "ITEM-A", "100", "10");

    await svc.createDraft(draftCmd({ id: "inv-c1" }));
    const cancelled = await svc.cancel("inv-c1");
    expect(cancelled.status).toBe("cancelled");

    await svc.createDraft(draftCmd({ id: "inv-c2" }));
    await svc.confirm("inv-c2");
    await expect(svc.cancel("inv-c2")).rejects.toBeInstanceOf(InvalidSalesInvoiceTransitionError);
  });

  it("records payments advancing confirmed → partially_paid → paid and rejects overpayment", async () => {
    const { svc, stockService } = await harness();
    await seedStock(stockService, "ITEM-A", "100", "10");
    await svc.createDraft(draftCmd({ id: "inv-p" }));
    await svc.confirm("inv-p"); // grand total 387.60

    const partial = await svc.recordPayment("inv-p", Money.fromMajor("100"));
    expect(partial.status).toBe("partially_paid");
    expect(partial.amountPaid.toString()).toBe("100.000000");

    await expect(svc.recordPayment("inv-p", Money.fromMajor("500"))).rejects.toBeInstanceOf(
      InvalidSalesInvoicePaymentError,
    );

    const paid = await svc.recordPayment("inv-p", Money.fromMajor("287.60"));
    expect(paid.status).toBe("paid");
    expect(paid.amountPaid.toString()).toBe("387.600000");
  });
});

/* ================================================================== */
/* 4. Period gate                                                      */
/* ================================================================== */

describe("SalesInvoiceService.confirm — period gate", () => {
  it("refuses to confirm into a closed fiscal period", async () => {
    const { svc, stockService } = await harness({ periodStatus: "closed" });
    await seedStock(stockService, "ITEM-A", "100", "10");

    await svc.createDraft(draftCmd({ id: "inv-gate" }));
    await expect(svc.confirm("inv-gate")).rejects.toThrow();

    // The GL post is rejected by the period gate; the invoice is never marked
    // confirmed (with a shared-connection store the whole confirm rolls back).
    const still = await svc.findById("inv-gate");
    expect(still?.status).toBe("draft");
  });
});
