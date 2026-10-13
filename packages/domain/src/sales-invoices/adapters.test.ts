import { describe, it, expect } from "vitest";
import { PLAIN_SALES_TAX_DEPS } from "./test-support.js";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { StockLedgerService } from "../inventory/index.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../inventory/test-helpers/in-memory-stores.js";
import {
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  createSalesInvoiceCustomerExposureHook,
  SalesInvoiceService,
  type CreateSalesInvoiceCommand,
} from "./index.js";
import { InMemorySalesInvoiceRepository } from "./test-helpers/in-memory-sales-invoice-repository.js";

const AR = "1300";
const REVENUE = "4000";
const TAX = "2200";
const NOW = "2026-08-22T10:00:00.000Z";

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

async function glHarness() {
  const accounts = new InMemoryAccountRepository();
  await accounts.create(account(AR));
  await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({ id: "fp", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  const ledger = new InMemoryLedgerRepository();
  const hook = createSalesInvoiceGlHook({
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => NOW,
    actor: "u1",
  });
  return { hook, ledger };
}

describe("createSalesInvoiceGlHook", () => {
  it("posts a balanced entry as a system document and returns its id/number", async () => {
    const { hook, ledger } = await glHarness();
    const result = await hook.post({
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "inv-1",
      sourceDocNumber: "INV-000001",
      date: "2026-08-22",
      memo: "فاتورة مبيعات INV-000001",
      lines: [
        { accountId: AR, debit: Money.fromMajor("100"), credit: Money.zero() },
        { accountId: REVENUE, debit: Money.zero(), credit: Money.fromMajor("100") },
      ],
    });
    expect(result.journalEntryId).toBe("inv-1");
    expect(result.journalEntryNo).toBe("JE-000001");

    const entry = await ledger.findById("inv-1");
    expect(entry?.status).toBe("posted");
    expect(entry?.source).toBe("system");
    expect(entry?.sourceDocType).toBe("SALES_INVOICE");
  });

  it("carries cost centre, tax rate, currency and fx rate through onto posted lines", async () => {
    const { hook, ledger } = await glHarness();
    await hook.post({
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "inv-fx",
      sourceDocNumber: "INV-000002",
      date: "2026-08-22",
      memo: "m",
      lines: [
        {
          accountId: AR,
          debit: Money.fromMajor("100"),
          credit: Money.zero(),
          costCenterId: "CC1",
          taxRatePercent: 14,
          currency: "USD",
          fxRate: "31.5",
        },
        { accountId: REVENUE, debit: Money.zero(), credit: Money.fromMajor("100") },
      ],
    });
    const entry = await ledger.findById("inv-fx");
    const arLine = entry?.lines.find((l) => l.accountId === AR);
    expect(arLine?.costCenterId).toBe("CC1");
    expect(arLine?.taxRatePercent).toBe(14);
    expect(arLine?.currency).toBe("USD");
    expect(arLine?.fxRate).toBe("31.5");
  });

  it("reverses a posted entry, mirroring every line", async () => {
    const { hook, ledger } = await glHarness();
    await hook.post({
      sourceDocType: "SALES_INVOICE",
      sourceDocId: "inv-2",
      sourceDocNumber: "INV-000003",
      date: "2026-08-22",
      memo: "m",
      lines: [
        { accountId: AR, debit: Money.fromMajor("50"), credit: Money.zero() },
        { accountId: REVENUE, debit: Money.zero(), credit: Money.fromMajor("50") },
      ],
    });
    const reversal = await hook.reverse("inv-2", { reversalId: "inv-2-rev", date: "2026-08-23", memo: "عكس" });
    expect(reversal.journalEntryId).toBe("inv-2-rev");
    const reversalEntry = await ledger.findById("inv-2-rev");
    expect(reversalEntry?.status).toBe("posted");
    const original = await ledger.findById("inv-2");
    expect(original?.status).toBe("reversed");
  });
});

describe("createSalesInvoiceStockHook", () => {
  async function stockHarness() {
    const stockService = new StockLedgerService({
      ledger: new InMemoryStockLedger(),
      layers: new InMemoryCostLayers(),
      snapshots: new InMemorySnapshots(),
      policy: { allowNegativeStock: false },
      clock: () => NOW,
    });
    await stockService.recordOpeningBalance({
      adjustmentId: "open-1",
      warehouseId: "WH1",
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("50"), unitCost: Money.fromMajor("10") }],
    });
    await stockService.recordOpeningBalance({
      adjustmentId: "open-2",
      warehouseId: "WH2",
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("20"), unitCost: Money.fromMajor("12") }],
    });
    return stockService;
  }

  it("issues stock from the document's own warehouse when there is no cross-warehouse resolver", async () => {
    const stockService = await stockHarness();
    const hook = createSalesInvoiceStockHook(stockService);
    const result = await hook.issue({
      issueId: "iss-1",
      sourceDocId: "inv-1",
      sourceDocNumber: "INV-000001",
      warehouseId: "WH1",
      occurredAt: NOW,
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("10") }],
    });
    expect(result.totalCost.toString()).toBe("100.000000");
    expect(result.lines[0]?.unitCost.toString()).toBe("10.000000");

    const balance = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(balance.onHand.toString()).toBe("40.000000");
  });

  it("redirects a line to the resolved warehouse when the resolver names one", async () => {
    const stockService = await stockHarness();
    const hook = createSalesInvoiceStockHook(stockService, async () => "WH2");
    const result = await hook.issue({
      issueId: "iss-2",
      sourceDocId: "inv-2",
      sourceDocNumber: "INV-000002",
      warehouseId: "WH1",
      occurredAt: NOW,
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("5") }],
    });
    // Issued from WH2 (cost 12), not WH1 (cost 10).
    expect(result.lines[0]?.unitCost.toString()).toBe("12.000000");
    const wh1 = await stockService.getBalanceDetail("ITEM-A", "WH1");
    const wh2 = await stockService.getBalanceDetail("ITEM-A", "WH2");
    expect(wh1.onHand.toString()).toBe("50.000000");
    expect(wh2.onHand.toString()).toBe("15.000000");
  });

  it("keeps the line on the document's warehouse when the resolver returns null", async () => {
    const stockService = await stockHarness();
    const hook = createSalesInvoiceStockHook(stockService, async () => null);
    await hook.issue({
      issueId: "iss-3",
      sourceDocId: "inv-3",
      sourceDocNumber: "INV-000003",
      warehouseId: "WH1",
      occurredAt: NOW,
      lines: [{ itemId: "ITEM-A", qty: Qty.fromMajor("5") }],
    });
    const wh1 = await stockService.getBalanceDetail("ITEM-A", "WH1");
    expect(wh1.onHand.toString()).toBe("45.000000");
  });
});

describe("createSalesInvoiceCustomerExposureHook", () => {
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
        {
          lineId: "L1",
          itemId: "SVC-1",
          itemNameAr: "خدمة",
          isStock: false,
          qty: Qty.fromMajor("1"),
          unitPrice: Money.fromMajor("500"),
          taxRatePercent: 0,
          revenueAccountId: REVENUE,
        },
      ],
      ...overrides,
    };
  }

  async function svcHarness(repo: InMemorySalesInvoiceRepository) {
    const accounts = new InMemoryAccountRepository();
    await accounts.create(account(AR));
    await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
    await accounts.create(account(TAX, { type: "liability", naturalBalance: "credit" }));
    const periods = new InMemoryFiscalPeriodRepository();
    await periods.create({ id: "fp", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
    const glHook = createSalesInvoiceGlHook({
      ledger: new InMemoryLedgerRepository(),
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
      policy: { allowNegativeStock: true },
      clock: () => NOW,
    });
    const numbering = new NextNumberService(new InMemorySequenceStore());
    return new SalesInvoiceService({
    ...PLAIN_SALES_TAX_DEPS,
      repo,
      numbering: { next: () => numbering.next("SALES_INVOICE") },
      gl: glHook,
      stock: createSalesInvoiceStockHook(stockService),
      now: () => NOW,
      actor: "u1",
    });
  }

  it("sums only confirmed/partially_paid invoices for the customer, excluding the named invoice", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const svc = await svcHarness(repo);

    await svc.createDraft(draftCmd({ id: "inv-1" }));
    await svc.confirm("inv-1"); // 500 confirmed

    await svc.createDraft(draftCmd({ id: "inv-2" }));
    // inv-2 stays draft — must not count toward exposure.

    await svc.createDraft(draftCmd({ id: "inv-3" }));
    await svc.confirm("inv-3"); // another 500 confirmed

    const hook = createSalesInvoiceCustomerExposureHook(repo);
    const total = await hook.currentBalance("cust-1");
    expect(total.toString()).toBe("1000.000000");

    const excludingInv1 = await hook.currentBalance("cust-1", "inv-1");
    expect(excludingInv1.toString()).toBe("500.000000");
  });

  it("nets amountPaid out of a partially paid invoice's exposure", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const svc = await svcHarness(repo);
    await svc.createDraft(draftCmd({ id: "inv-1" }));
    await svc.confirm("inv-1");
    const invoice = await repo.findById("inv-1");
    await repo.update({ ...invoice!, status: "partially_paid", amountPaid: Money.fromMajor("200") });

    const hook = createSalesInvoiceCustomerExposureHook(repo);
    const total = await hook.currentBalance("cust-1");
    expect(total.toString()).toBe("300.000000");
  });

  it("returns zero for a customer with no invoices", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const hook = createSalesInvoiceCustomerExposureHook(repo);
    expect((await hook.currentBalance("cust-none")).toString()).toBe("0.000000");
  });
});
