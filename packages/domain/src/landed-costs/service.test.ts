import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { createDocumentWorkflowGate, createJournalGlHook } from "../documents/journal-document.js";
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
import { distributeLandedCost } from "./distribution.js";
import { createLandedCostDocumentType, type LandedCostLine } from "./landed-cost-document.js";
import { LandedCostService } from "./service.js";

const ACCOUNTS = { inventoryAccountId: "INVENTORY", accruedLandedCostPayableId: "ACCRUED_LC" };

async function harness() {
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

  // Seed the receipt as purchase invoice PI1 — the target the landed cost
  // allocates onto. It goes into the LEDGER, not the layer cache: the engine
  // rebuilds layers by replaying movements, so a layer re-tagged behind the
  // ledger's back is discarded on the next rebuild.
  await stockLedger.append({
    id: "PI1:ITEM1:WH1",
    itemId: "ITEM1",
    warehouseId: "WH1",
    direction: "IN",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("50"),
    sourceDocType: "PURCHASE_INVOICE",
    sourceDocId: "PI1",
    sourceDocNumber: "PI-000002",
    reason: null,
    occurredAt: "2026-08-20T00:00:00.000Z",
  });
  await stockService.rebuild("ITEM1", "WH1");

  const repo = new InMemoryDocumentRepository<LandedCostLine>();
  const documentType = createLandedCostDocumentType(ACCOUNTS);
  const numbering = new NextNumberService(sequence);
  const documents = new DocumentService(documentType, {
    repo,
    numbering: { next: () => numbering.next("LANDED_COST") },
    gl,
    workflow: createDocumentWorkflowGate(() => null),
    now: () => "2026-08-21T00:00:00.000Z",
    actor: "test",
  });
  const service = new LandedCostService(documents, stockService);

  return { service, documents, repo, ledger, stockService, layers };
}

describe("LandedCostService — GL + landed unit-cost revaluation", () => {
  it("confirms: posts Dr Inventory / Cr accrued payable, and raises the target position's cost basis", async () => {
    const { service, documents, stockService, layers } = await harness();

    const [allocated] = distributeLandedCost(
      [{ costType: "SHIPPING", description: "شحن", amount: Money.fromMajor("100") }],
      "BY_VALUE",
      [{ itemId: "ITEM1", warehouseId: "WH1", sourceInvoiceId: "PI1", sourceInvoiceNumber: "PI-000002", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("50"), weight: Qty.fromMajor("0") }],
    );

    await documents.createDraft({
      id: "LC1",
      date: "2026-08-21",
      memo: "",
      lines: [{ ...(allocated as NonNullable<typeof allocated>), costItems: [{ costType: "SHIPPING", description: "شحن", amount: Money.fromMajor("100") }], distributionMethod: "BY_VALUE" }],
    });

    const { document, held } = await service.confirm("LC1");
    expect(held).toBe(false);
    expect(document.docNo).toBe("LC-000001");

    // Snapshot: totalValue rises by 100 with NO qty change (10 on hand → 500 + 100 = 600 → avg 60).
    const balance = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(balance.onHand.toString()).toBe("10.000000");
    expect(balance.totalValue.toString()).toBe("600.000000");
    expect(balance.averageCost.toString()).toBe("60.000000");

    // The PI1-tagged layer's own unit cost is raised by the same allocated amount / qty.
    const positionLayers = await layers.listByPosition("ITEM1", "WH1");
    expect(positionLayers).toHaveLength(1);
    expect(positionLayers[0]?.unitCost.toString()).toBe("60.000000");
    expect(positionLayers[0]?.remainingQty.toString()).toBe("10.000000");
  });
});
