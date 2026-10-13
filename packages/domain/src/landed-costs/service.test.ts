import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { createDocumentWorkflowGate, createJournalGlHook } from "../documents/journal-document.js";
import { postJournalEntry } from "../gl/post.js";
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

const ACCOUNTS = { inventoryAccountId: "INVENTORY", accruedLandedCostPayableId: "ACCRUED_LC", unabsorbedCostAccountId: "COGS" };

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
  const glDeps = {
    ledger,
    accounts: accountRepo,
    periods,
    numbering: new NextNumberService(sequence),
    now: () => "2026-08-21T00:00:00.000Z",
    actor: "test",
  };
  const gl = createJournalGlHook(glDeps);

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
  const service = new LandedCostService(documents, stockService, {
    postUnabsorbed: async (posting) => {
      await postJournalEntry(
        {
          id: posting.entryId,
          date: posting.date,
          memo: posting.memo,
          source: "system",
          sourceDocId: posting.sourceDocId,
          sourceDocNumber: posting.sourceDocNumber,
          lines: [
            { accountId: ACCOUNTS.unabsorbedCostAccountId, debit: posting.amount, credit: Money.zero() },
            { accountId: ACCOUNTS.inventoryAccountId, debit: Money.zero(), credit: posting.amount },
          ],
        },
        glDeps,
        { mintedBySystem: true },
      );
    },
    postAbsorbed: async (posting) => {
      await postJournalEntry(
        {
          id: posting.entryId,
          date: posting.date,
          memo: posting.memo,
          source: "system",
          sourceDocId: posting.sourceDocId,
          sourceDocNumber: posting.sourceDocNumber,
          lines: [
            { accountId: ACCOUNTS.inventoryAccountId, debit: posting.amount, credit: Money.zero() },
            { accountId: ACCOUNTS.unabsorbedCostAccountId, debit: Money.zero(), credit: posting.amount },
          ],
        },
        glDeps,
      );
    },
    postAbsorbedFromClearing: async () => undefined,
    postIssuedFromClearing: async () => undefined,
    reverseSideEntry: async () => null,
  });

  return { service, documents, repo, ledger, stockService, layers, stockLedger };
}

/** Signed (debit − credit) net on one account across every posted entry. */
async function accountNet(ledger: InMemoryLedgerRepository, accountId: string): Promise<bigint> {
  let net = 0n;
  for (const entry of await ledger.list()) {
    for (const line of entry.lines) {
      if (line.accountId === accountId) net += line.debit.scaled - line.credit.scaled;
    }
  }
  return net;
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

  /**
   * D84's GL half. A landed cost booked after some of the goods were sold can
   * only raise the basis of what is still on hand; the rest belongs to units
   * already gone. Debiting the whole amount to inventory left GL 1200 above the
   * valuation report by exactly the remainder, permanently.
   */
  it("posts the part the stock could not absorb out of inventory and into cost of sales, so GL inventory equals the valuation report", async () => {
    const { service, documents, stockService, ledger } = await harness();

    // Half the receipt is sold BEFORE the landed cost lands: 5 of 10 pieces
    // leave at the 50.00 average, so only 5 remain to carry the freight.
    await stockService.postAdjustment({
      adjustmentId: "SOLD",
      warehouseId: "WH1",
      reason: "OTHER",
      lines: [{ itemId: "ITEM1", direction: "OUT", qty: Qty.fromMajor("5") }],
    });

    const [allocated] = distributeLandedCost(
      [{ costType: "SHIPPING", description: "شحن", amount: Money.fromMajor("100") }],
      "BY_VALUE",
      [{ itemId: "ITEM1", warehouseId: "WH1", sourceInvoiceId: "PI1", sourceInvoiceNumber: "PI-000002", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("50"), weight: Qty.fromMajor("0") }],
    );
    await documents.createDraft({
      id: "LC2",
      date: "2026-08-21",
      memo: "",
      lines: [{ ...(allocated as NonNullable<typeof allocated>), costItems: [{ costType: "SHIPPING", description: "شحن", amount: Money.fromMajor("100") }], distributionMethod: "BY_VALUE" }],
    });

    // The harness seeds stock straight into the ledger and posts no GL for it,
    // so the tie that matters here is the MOVEMENT: what this landed cost adds
    // to GL inventory must equal what it adds to the valuation report.
    const valuationBefore = (await stockService.getBalanceDetail("ITEM1", "WH1")).totalValue;
    const inventoryBefore = await accountNet(ledger, ACCOUNTS.inventoryAccountId);

    const result = await service.confirm("LC2");
    expect(result.unabsorbedTotal.toString()).toBe("50.000000");
    expect(result.unabsorbedJournalEntryId).toBe("LC2:UNABSORBED");

    // Only the 5 pieces still on hand can carry the freight: 250 + 50 = 300.
    const balance = await stockService.getBalanceDetail("ITEM1", "WH1");
    expect(balance.totalValue.toString()).toBe("300.000000");

    expect(await accountNet(ledger, ACCOUNTS.unabsorbedCostAccountId)).toBe(Money.fromMajor("50").scaled);
    expect((await accountNet(ledger, ACCOUNTS.inventoryAccountId)) - inventoryBefore).toBe(
      balance.totalValue.scaled - valuationBefore.scaled,
    );
  });

  it("posts no reclassification when the stock absorbed the whole landed cost", async () => {
    const { service, documents, ledger } = await harness();
    const [allocated] = distributeLandedCost(
      [{ costType: "SHIPPING", description: "شحن", amount: Money.fromMajor("100") }],
      "BY_VALUE",
      [{ itemId: "ITEM1", warehouseId: "WH1", sourceInvoiceId: "PI1", sourceInvoiceNumber: "PI-000002", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("50"), weight: Qty.fromMajor("0") }],
    );
    await documents.createDraft({
      id: "LC3",
      date: "2026-08-21",
      memo: "",
      lines: [{ ...(allocated as NonNullable<typeof allocated>), costItems: [{ costType: "SHIPPING", description: "شحن", amount: Money.fromMajor("100") }], distributionMethod: "BY_VALUE" }],
    });
    const result = await service.confirm("LC3");
    expect(result.unabsorbedTotal.scaled).toBe(0n);
    expect(result.unabsorbedJournalEntryId).toBeNull();
    expect((await ledger.list()).some((e) => e.id === "LC3:UNABSORBED")).toBe(false);
  });
});
