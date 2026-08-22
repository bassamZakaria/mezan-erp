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
import {
  createPurchaseReturnDocumentType,
  type PurchaseReturnLine,
} from "./purchase-return-document.js";

const ACCOUNTS = {
  accountsPayableId: "AP",
  inputTaxPayableId: "INPUT_TAX",
  inventoryAccountId: "INVENTORY",
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
