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
import { NegativeStockError } from "../inventory/errors.js";
import { InvalidDocumentError } from "../documents/errors.js";
import {
  createPurchaseReturnDocumentType,
  purchaseReturnGrandTotal,
  purchaseReturnLineCredit,
  type PurchaseReturnLine,
} from "./purchase-return-document.js";
import { buildPurchaseReturnLinesFromInvoice } from "./from-invoice.js";

const ACCOUNTS = {
  accountsPayableId: "AP",
  inputTaxPayableId: "INPUT_TAX",
  inventoryAccountId: "INVENTORY",
  priceVarianceAccountId: "PPV",
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

  const repo = new InMemoryDocumentRepository<PurchaseReturnLine>();
  const documentType = createPurchaseReturnDocumentType(ACCOUNTS);
  const numbering = new NextNumberService(sequence);
  const service = new DocumentService(documentType, {
    repo,
    numbering: { next: () => numbering.next("PURCHASE_RETURN") },
    gl,
    stock,
    workflow: createDocumentWorkflowGate(() => null),
    now: () => "2026-08-21T00:00:00.000Z",
    actor: "test",
  });

  return { service, repo, ledger, stockService };
}

function line(overrides: Partial<PurchaseReturnLine> = {}): PurchaseReturnLine {
  return {
    itemId: "ITEM1",
    warehouseId: "WH1",
    supplierId: "SUP1",
    sourceInvoiceId: "PI1",
    sourceInvoiceNumber: "PI-000002",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor("5"),
    qty: Qty.fromMajor("3"),
    unitCost: Money.fromMajor("40"),
    taxAmount: Money.fromMajor("16.80"), // 14% of 120
    ...overrides,
  };
}

describe("Purchase Return — de-stock + GL", () => {
  it("confirms: removes inventory and posts Dr AP / Cr Inventory (+ tax)", async () => {
    const { service, stockService, ledger } = harness();

    // Seed 5 on hand at 40 each so the OUT movement has stock to draw from.
    await stockService.postAdjustment({
      adjustmentId: "SEED",
      warehouseId: "WH1",
      reason: "INITIAL_STOCK",
      lines: [{ itemId: "ITEM1", direction: "IN", qty: Qty.fromMajor("5"), unitCost: Money.fromMajor("40") }],
    });

    await service.createDraft({ id: "PRT1", date: "2026-08-21", memo: "", lines: [line()] });
    const { document, held } = await service.confirm("PRT1");

    expect(held).toBe(false);
    expect(document.docNo).toBe("PRT-000001");

    const balance = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(balance.onHand.toString()).toBe("2.000000");
    expect(balance.totalValue.toString()).toBe("80.000000");

    const entry = await ledger.findById(document.journalEntryId as string);
    const byAccount = (id: string) =>
      entry?.lines.filter((l) => l.accountId === id).reduce((s, l) => s.add(l.debit).add(l.credit.negate()), Money.zero());
    expect(byAccount(ACCOUNTS.accountsPayableId)?.toString()).toBe("136.800000"); // 120 + 16.80
    expect(byAccount(ACCOUNTS.inputTaxPayableId)?.toString()).toBe("-16.800000");
    expect(byAccount(ACCOUNTS.inventoryAccountId)?.toString()).toBe("-120.000000");

    const totalDebit = Money.sum(entry?.lines.map((l) => l.debit) ?? []);
    const totalCredit = Money.sum(entry?.lines.map((l) => l.credit) ?? []);
    expect(totalDebit.equals(totalCredit)).toBe(true);
  });

  it("blocks over-return via NegativeStockError when returning more than is on hand", async () => {
    const { service } = harness();
    await service.createDraft({
      id: "PRT2",
      date: "2026-08-21",
      memo: "",
      lines: [line({ qty: Qty.fromMajor("3"), availableQty: Qty.fromMajor("3") })],
    });
    await expect(service.confirm("PRT2")).rejects.toBeInstanceOf(NegativeStockError);
  });
});

describe("createPurchaseReturnDocumentType — validate (pure)", () => {
  const type = createPurchaseReturnDocumentType(ACCOUNTS);

  function doc(lines: PurchaseReturnLine[]) {
    return {
      id: "PRT1",
      docType: "PURCHASE_RETURN",
      docNo: "PRT-000001",
      date: "2026-08-21",
      memo: "",
      status: "draft" as const,
      lines,
      createdAt: "2026-08-21T00:00:00.000Z",
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    };
  }

  it("rejects a document with no lines", () => {
    expect(() => type.validate?.(doc([]))).toThrow(InvalidDocumentError);
  });

  it("rejects lines that name different source invoices", () => {
    expect(() =>
      type.validate?.(doc([line(), line({ sourceInvoiceId: "PI-OTHER" })])),
    ).toThrow(/كل بنود المرتجع يجب أن تنتمي لنفس الفاتورة/);
  });

  it("rejects a zero or negative return qty", () => {
    expect(() => type.validate?.(doc([line({ qty: Qty.zero() })]))).toThrow(/أكبر من صفر/);
    expect(() => type.validate?.(doc([line({ qty: Qty.fromMajor("-1") })]))).toThrow(/أكبر من صفر/);
  });

  it("rejects returning more than the (posted-receipts-derived) available qty", () => {
    expect(() =>
      type.validate?.(doc([line({ qty: Qty.fromMajor("6"), availableQty: Qty.fromMajor("5") })])),
    ).toThrow(/تتجاوز المتاح للإرجاع/);
  });

  it("accepts returning exactly the available qty (the boundary)", () => {
    expect(() =>
      type.validate?.(doc([line({ qty: Qty.fromMajor("5"), availableQty: Qty.fromMajor("5") })])),
    ).not.toThrow();
  });

  it("rejects a negative unitCost or taxAmount", () => {
    expect(() => type.validate?.(doc([line({ unitCost: Money.fromMajor("-1") })]))).toThrow(/لا يمكن أن تكون سالبة/);
    expect(() => type.validate?.(doc([line({ taxAmount: Money.fromMajor("-1") })]))).toThrow(/لا يمكن أن تكون سالبة/);
  });

  it("rejects a line costCategory when the return carries no projectId", () => {
    expect(() => type.validate?.(doc([line({ costCategory: "materials" })]))).toThrow(InvalidDocumentError);
  });
});

describe("createPurchaseReturnDocumentType — buildGlPosting variance branches", () => {
  const type = createPurchaseReturnDocumentType(ACCOUNTS);

  function doc(lines: PurchaseReturnLine[]) {
    return {
      id: "PRT1",
      docType: "PURCHASE_RETURN",
      docNo: "PRT-000001",
      date: "2026-08-21",
      memo: "",
      status: "draft" as const,
      lines,
      createdAt: "2026-08-21T00:00:00.000Z",
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    };
  }

  it("credits the price-variance account when the invoice price exceeds what the stock ledger actually removed", () => {
    // invoice-cost value (line()) = 3 * 40 = 120; stock removed only 90 (moving average dropped since receipt).
    const posting = type.buildGlPosting?.(doc([line()]), { valueMoved: Money.fromMajor("-90") });
    const variance = posting?.lines.find((l) => l.accountId === "PPV");
    expect(variance?.credit.toString()).toBe("30.000000");
    expect(variance?.debit.toString()).toBe("0.000000");
    const inv = posting?.lines.find((l) => l.accountId === "INVENTORY");
    expect(inv?.credit.toString()).toBe("90.000000");
  });

  it("debits the price-variance account when the stock ledger removed MORE value than the invoice price", () => {
    const posting = type.buildGlPosting?.(doc([line()]), { valueMoved: Money.fromMajor("-150") });
    const variance = posting?.lines.find((l) => l.accountId === "PPV");
    expect(variance?.debit.toString()).toBe("30.000000");
    expect(variance?.credit.toString()).toBe("0.000000");
  });

  it("omits the variance line entirely when the invoice price matches what stock removed exactly", () => {
    const posting = type.buildGlPosting?.(doc([line()]), { valueMoved: Money.fromMajor("-120") });
    expect(posting?.lines.some((l) => l.accountId === "PPV")).toBe(false);
  });

  it("falls back to the invoice cost value (no variance) when no stock result is supplied", () => {
    const posting = type.buildGlPosting?.(doc([line()]));
    expect(posting?.lines.some((l) => l.accountId === "PPV")).toBe(false);
    const inv = posting?.lines.find((l) => l.accountId === "INVENTORY");
    expect(inv?.credit.toString()).toBe("120.000000");
  });

  it("returns null (posts nothing) when the grand total is zero", () => {
    const zeroLine = line({ qty: Qty.fromMajor("0.000001"), unitCost: Money.zero(), taxAmount: Money.zero() });
    // qty non-zero to pass validate elsewhere, but a zero-cost/zero-tax line has a zero grand total.
    const posting = type.buildGlPosting?.(doc([zeroLine]));
    expect(posting).toBeNull();
  });

  it("purchaseReturnGrandTotal matches what a confirmed return would debit to AP", () => {
    const total = purchaseReturnGrandTotal(doc([line()]));
    expect(total.toString()).toBe("136.800000"); // 120 cost + 16.80 tax
  });

  it("omits the input-tax line when no line carries tax", () => {
    const posting = type.buildGlPosting?.(doc([line({ taxAmount: Money.zero() })]), { valueMoved: Money.fromMajor("-120") });
    expect(posting?.lines.some((l) => l.accountId === "INPUT_TAX")).toBe(false);
  });

  it("carries the header projectId on every line and costCategory only on the inventory (cost) line", () => {
    const posting = type.buildGlPosting?.(
      doc([line({ projectId: "proj-1", costCategory: "materials" })]),
      { valueMoved: Money.fromMajor("-120") },
    );
    expect(posting?.lines.every((l) => l.projectId === "proj-1")).toBe(true);
    const inv = posting?.lines.find((l) => l.accountId === "INVENTORY");
    const ap = posting?.lines.find((l) => l.accountId === "AP");
    const tax = posting?.lines.find((l) => l.accountId === "INPUT_TAX");
    expect(inv?.costCategory).toBe("materials");
    expect(ap?.costCategory).toBeUndefined();
    expect(tax?.costCategory).toBeUndefined();
  });
});

describe("a return against a foreign invoice reverses at the invoice's rate (D203)", () => {
  const type = createPurchaseReturnDocumentType(ACCOUNTS);
  const sar = line({ currency: "SAR", fxRate: "13.20" });
  const doc = {
    id: "PRT-SAR",
    docType: "PURCHASE_RETURN",
    docNo: "PRT-000009",
    date: "2026-08-21",
    memo: "",
    status: "confirmed" as const,
    lines: [sar],
    createdAt: "2026-08-21T00:00:00.000Z",
    confirmedAt: "2026-08-21T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };

  it("debits AP with SAR 136.80 × 13.20 = 1,805.76, and the variance is base credit less what stock removed", () => {
    const posting = type.buildGlPosting?.(doc, { valueMoved: Money.fromMajor("-1500") });
    const amount = (accountId: string, side: "debit" | "credit") =>
      posting?.lines.filter((l) => l.accountId === accountId).reduce((sum, l) => sum.add(l[side]), Money.zero()).toString();
    expect(amount("AP", "debit")).toBe("1805.760000");
    expect(amount("INPUT_TAX", "credit")).toBe("221.760000");
    expect(amount("INVENTORY", "credit")).toBe("1500.000000");
    expect(amount("PPV", "credit")).toBe("84.000000");
    expect(posting?.lines.find((l) => l.accountId === "AP")).toMatchObject({ currency: "SAR", fxRate: "13.20" });
  });

  it("gives the credit helpers the same base figure the posting debited", () => {
    expect(purchaseReturnGrandTotal(doc).toString()).toBe("1805.760000");
    expect(purchaseReturnLineCredit(sar).toString()).toBe("1805.760000");
  });

  it("stamps the invoice's currency and rate onto every line built from it", () => {
    const lines = buildPurchaseReturnLinesFromInvoice(
      {
        id: "PI1",
        number: "PI-000002",
        supplierId: "SUP1",
        warehouseId: "WH1",
        date: "2026-08-20",
        status: "confirmed",
        currency: "SAR",
        fxRate: "13.20",
        lines: [{ itemId: "ITEM1", itemName: "صنف", qty: Qty.fromMajor("5"), alreadyReturnedQty: Qty.zero(), unitCost: Money.fromMajor("40"), taxAmount: Money.fromMajor("28") }],
      },
      "WH1",
      "DEFECTIVE",
      [{ itemId: "ITEM1", qty: Qty.fromMajor("3") }],
    );
    expect(lines[0]).toMatchObject({ currency: "SAR", fxRate: "13.20" });
  });
});

describe("a purchase return posts in its source invoice's branch (D111)", () => {
  const type = createPurchaseReturnDocumentType(ACCOUNTS);
  const docOf = (lines: PurchaseReturnLine[]) => ({
    id: "PRT-BR",
    docType: "PURCHASE_RETURN",
    docNo: "PRT-000010",
    date: "2026-08-21",
    memo: "",
    status: "draft" as const,
    lines,
    createdAt: "2026-08-21T00:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  });

  it("stamps the invoice's branch on the payable, VAT, inventory and variance legs", () => {
    const posting = type.buildGlPosting?.(docOf([line({ branchId: "BR-ALEX" })]), { valueMoved: Money.fromMajor("-90") });
    expect(posting!.lines.length).toBeGreaterThan(2);
    expect(posting!.lines.every((l) => l.branchId === "BR-ALEX")).toBe(true);
  });

  it("leaves a return whose invoice carried no branch unattributed", () => {
    const posting = type.buildGlPosting?.(docOf([line()]), { valueMoved: Money.fromMajor("-90") });
    expect(posting!.lines.every((l) => l.branchId === null)).toBe(true);
  });
});
