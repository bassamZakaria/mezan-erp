import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { createDocumentWorkflowGate, createJournalGlHook } from "../documents/journal-document.js";
import { createInventoryStockHook } from "../documents/inventory-stock-hook.js";
import { InMemoryDocumentRepository } from "../documents/test-helpers/in-memory-document-repository.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { StockLedgerService } from "../inventory/stock-ledger-service.js";
import {
  InMemoryStockLedger,
  InMemoryCostLayers,
  InMemorySnapshots,
} from "../inventory/test-helpers/in-memory-stores.js";
import { InvalidDocumentError } from "../documents/errors.js";
import {
  createSalesReturnDocumentType,
  salesReturnCreditByInvoice,
  salesReturnGrandTotal,
  salesReturnLineCredit,
  type SalesReturnLine,
} from "./sales-return-document.js";
import { isAwaitingRefund, refundDue } from "./refund.js";
import { buildSalesReturnLinesFromInvoice } from "./from-invoice.js";

const ACCOUNTS = {
  accountsReceivableId: "AR",
  salesReturnsAccountId: "SALES_RETURNS",
  outputTaxPayableAccountId: "OUTPUT_TAX",
  inventoryAccountId: "INVENTORY",
  cogsAccountId: "COGS",
};

function harness() {
  const accountRepo = new InMemoryAccountRepository();
  for (const id of Object.values(ACCOUNTS)) {
    void accountRepo.create({
      id,
      code: id,
      nameAr: id,
      nameEn: id,
      type: "asset",
      naturalBalance: "debit",
      parentId: null,
      isHeader: false,
      status: "active",
    });
  }
  const periods = new InMemoryFiscalPeriodRepository();
  void periods.create({ id: "P1", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const ledger = new InMemoryLedgerRepository();
  const sequence = new InMemorySequenceStore();
  const gl = createJournalGlHook({
    ledger,
    accounts: accountRepo,
    periods,
    numbering: new NextNumberService(sequence),
    now: () => "2026-08-21T00:00:00.000Z",
    actor: "test",
  });

  const stockLedger = new InMemoryStockLedger();
  const layers = new InMemoryCostLayers();
  const snapshots = new InMemorySnapshots();
  const stockService = new StockLedgerService({
    ledger: stockLedger,
    layers,
    snapshots,
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-21T00:00:00.000Z",
  });
  const stock = createInventoryStockHook(stockService);

  const repo = new InMemoryDocumentRepository<SalesReturnLine>();
  const documentType = createSalesReturnDocumentType(ACCOUNTS);
  const numbering = new NextNumberService(sequence);
  const service = new DocumentService(documentType, {
    repo,
    numbering: { next: () => numbering.next("SALES_RETURN") },
    gl,
    stock,
    workflow: createDocumentWorkflowGate(() => null),
    now: () => "2026-08-21T00:00:00.000Z",
    actor: "test",
  });

  return { service, repo, ledger, stockService };
}

function line(overrides: Partial<SalesReturnLine> = {}): SalesReturnLine {
  return {
    itemId: "ITEM1",
    warehouseId: "WH1",
    customerId: "CUST1",
    sourceInvoiceId: "INV1",
    sourceInvoiceNumber: "INV-000014",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor("5"),
    qty: Qty.fromMajor("2"),
    unitPrice: Money.fromMajor("100"),
    unitCost: Money.fromMajor("60"),
    taxAmount: Money.fromMajor("28"), // 14% of 200
    ...overrides,
  };
}

describe("Sales Return — restock + GL", () => {
  it("confirms: restocks inventory at cost and posts a balanced reversal entry", async () => {
    const { service, stockService, ledger } = harness();

    await service.createDraft({ id: "SR1", date: "2026-08-21", memo: "", lines: [line()] });
    const { document, held } = await service.confirm("SR1");

    expect(held).toBe(false);
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBe("SRT-000001");
    expect(isAwaitingRefund(document)).toBe(true);

    // Restock: 2 units back into stock at unit cost 60.
    const balance = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(balance.onHand.toString()).toBe("2.000000");
    expect(balance.totalValue.toString()).toBe("120.000000");

    // GL: Dr Sales Returns 200 + Dr Output Tax 28 = Cr AR 228; Dr Inventory 120 = Cr COGS 120.
    const entry = await ledger.findById(document.journalEntryId as string);
    expect(entry).toBeTruthy();
    const byAccount = (id: string) =>
      entry?.lines.filter((l) => l.accountId === id).reduce((s, l) => s.add(l.debit).add(l.credit.negate()), Money.zero());
    expect(byAccount(ACCOUNTS.salesReturnsAccountId)?.toString()).toBe("200.000000");
    expect(byAccount(ACCOUNTS.outputTaxPayableAccountId)?.toString()).toBe("28.000000");
    expect(byAccount(ACCOUNTS.accountsReceivableId)?.toString()).toBe("-228.000000");
    expect(byAccount(ACCOUNTS.inventoryAccountId)?.toString()).toBe("120.000000");
    expect(byAccount(ACCOUNTS.cogsAccountId)?.toString()).toBe("-120.000000");

    const totalDebit = Money.sum(entry?.lines.map((l) => l.debit) ?? []);
    const totalCredit = Money.sum(entry?.lines.map((l) => l.credit) ?? []);
    expect(totalDebit.equals(totalCredit)).toBe(true);
  });

  it("stamps the restock movement with the return's own date, not the wall clock, and a later reversal with the reversal's date", async () => {
    const { service, stockService } = harness();

    await service.createDraft({ id: "SR-DATED", date: "2026-08-05", memo: "", lines: [line()] });
    await service.confirm("SR-DATED");
    await service.reverse("SR-DATED", { reversalId: "SR-DATED-REV", date: "2026-08-19" });

    expect((await stockService.getMovementsOfDocument("SR-DATED")).map((m) => m.occurredAt)).toEqual(["2026-08-05T00:00:00.000Z"]);
    expect((await stockService.getMovementsOfDocument("SR-DATED-REV")).map((m) => m.occurredAt)).toEqual(["2026-08-19T00:00:00.000Z"]);
  });

  it("carries the return's projectId onto every posted GL line (D-01)", async () => {
    const { service, ledger } = harness();

    await service.createDraft({
      id: "SR-PRJ",
      date: "2026-08-21",
      memo: "",
      lines: [line({ projectId: "PRJ-1" })],
    });
    const { document } = await service.confirm("SR-PRJ");

    const entry = await ledger.findById(document.journalEntryId as string);
    expect(entry).toBeTruthy();
    expect(entry!.lines.length).toBeGreaterThan(0);
    for (const l of entry!.lines) {
      expect(l.projectId).toBe("PRJ-1");
    }
  });

  it("rejects a return qty greater than what's available", async () => {
    const { service } = harness();
    await expect(
      service.createDraft({
        id: "SR2",
        date: "2026-08-21",
        memo: "",
        lines: [line({ qty: Qty.fromMajor("10"), availableQty: Qty.fromMajor("5") })],
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);
  });

  it("rejects lines that mix two different source invoices", async () => {
    const { service } = harness();
    await expect(
      service.createDraft({
        id: "SR3",
        date: "2026-08-21",
        memo: "",
        lines: [line(), line({ itemId: "ITEM2", sourceInvoiceId: "INV2" })],
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);
  });

  it("is not awaiting refund before it's confirmed", async () => {
    const { service } = harness();
    const draft = await service.createDraft({ id: "SR4", date: "2026-08-21", memo: "", lines: [line()] });
    expect(isAwaitingRefund(draft)).toBe(false);
  });
});

describe("a return against a foreign invoice reverses at the invoice's rate (D203)", () => {
  const type = createSalesReturnDocumentType(ACCOUNTS);
  const usd = line({ currency: "USD", fxRate: "48.00" });
  const doc = {
    id: "SR-USD",
    docType: "SALES_RETURN",
    docNo: "SRT-000009",
    date: "2026-08-21",
    memo: "",
    status: "confirmed" as const,
    lines: [usd],
    createdAt: "2026-08-21T00:00:00.000Z",
    confirmedAt: "2026-08-21T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };

  it("credits AR with USD 228 × 48.00 = 10,944.00 and reverses revenue and VAT in base, while the restock stays at base cost", () => {
    const posting = type.buildGlPosting?.(doc, undefined);
    const amount = (accountId: string, side: "debit" | "credit") =>
      posting?.lines.filter((l) => l.accountId === accountId).reduce((sum, l) => sum.add(l[side]), Money.zero()).toString();
    expect(amount("AR", "credit")).toBe("10944.000000");
    expect(amount("SALES_RETURNS", "debit")).toBe("9600.000000");
    expect(amount("OUTPUT_TAX", "debit")).toBe("1344.000000");
    expect(amount("INVENTORY", "debit")).toBe("120.000000");
    expect(posting?.lines.find((l) => l.accountId === "AR")).toMatchObject({ currency: "USD", fxRate: "48.00" });
  });

  it("gives every credit helper the same base figure the posting credited", () => {
    expect(salesReturnGrandTotal(doc).toString()).toBe("10944.000000");
    expect(salesReturnLineCredit(usd).toString()).toBe("10944.000000");
    expect(salesReturnCreditByInvoice([doc]).get("INV1")?.toString()).toBe("10944.000000");
    expect(refundDue(doc, []).toString()).toBe("10944.000000");
  });

  it("stamps the invoice's currency and rate onto every line built from it", () => {
    const lines = buildSalesReturnLinesFromInvoice(
      {
        id: "INV1",
        number: "INV-000014",
        customerId: "CUST1",
        warehouseId: "WH1",
        date: "2026-08-20",
        status: "confirmed",
        currency: "USD",
        fxRate: "48.00",
        lines: [{ itemId: "ITEM1", itemName: "صنف", qty: Qty.fromMajor("2"), alreadyReturnedQty: Qty.zero(), unitPrice: Money.fromMajor("100"), unitCost: Money.fromMajor("60"), taxAmount: Money.fromMajor("28") }],
      },
      "WH1",
      "DEFECTIVE",
      [{ itemId: "ITEM1", qty: Qty.fromMajor("1") }],
    );
    expect(lines[0]).toMatchObject({ currency: "USD", fxRate: "48.00" });
  });
});

describe("a sales return posts in its source invoice's branch (D111)", () => {
  const type = createSalesReturnDocumentType(ACCOUNTS);
  const docOf = (lines: SalesReturnLine[]) => ({
    id: "SR-BR",
    docType: "SALES_RETURN",
    docNo: "SRT-000010",
    date: "2026-08-21",
    memo: "",
    status: "confirmed" as const,
    lines,
    createdAt: "2026-08-21T00:00:00.000Z",
    confirmedAt: "2026-08-21T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  });

  it("stamps the invoice's branch on the receivable, revenue, VAT and restock legs", () => {
    const posting = type.buildGlPosting?.(docOf([line({ branchId: "BR-ALEX" })]), undefined);
    expect(posting!.lines.length).toBeGreaterThan(2);
    expect(posting!.lines.every((l) => l.branchId === "BR-ALEX")).toBe(true);
  });

  it("leaves a return whose invoice carried no branch unattributed", () => {
    const posting = type.buildGlPosting?.(docOf([line()]), undefined);
    expect(posting!.lines.every((l) => l.branchId === null)).toBe(true);
  });

  it("reads the branch off the invoice when the lines are built from it", () => {
    const [built] = buildSalesReturnLinesFromInvoice(
      {
        id: "INV1",
        number: "INV-000001",
        customerId: "C1",
        warehouseId: "WH1",
        branchId: "BR-ALEX",
        date: "2026-08-20",
        status: "confirmed",
        lines: [
          {
            itemId: "ITEM1",
            itemName: "صنف 1",
            qty: Qty.fromMajor("10"),
            alreadyReturnedQty: Qty.zero(),
            unitPrice: Money.fromMajor("20"),
            unitCost: Money.fromMajor("12"),
            taxAmount: Money.fromMajor("28"),
          },
        ],
      },
      "WH1",
      "OTHER",
      [{ itemId: "ITEM1", qty: Qty.fromMajor("2") }],
    );
    expect(built?.branchId).toBe("BR-ALEX");
  });
});
