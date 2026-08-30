import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { createDocumentWorkflowGate } from "../documents/journal-document.js";
import { InMemoryDocumentRepository } from "../documents/test-helpers/in-memory-document-repository.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "./test-helpers/in-memory-stores.js";
import { stockTransferDocumentType, type StockTransferDocLine } from "./stock-transfer-document.js";
import { stockAdjustmentDocumentType, type StockAdjustmentDocLine } from "./stock-adjustment-document.js";
import { createInventoryOpsStockHook } from "./document-hooks.js";
import type { InventoryGlPosting } from "./ports.js";

function harness() {
  const ledger = new InMemoryStockLedger();
  const layers = new InMemoryCostLayers();
  const snapshots = new InMemorySnapshots();
  const postings: InventoryGlPosting[] = [];
  const stockLedger = new StockLedgerService({
    ledger,
    layers,
    snapshots,
    policy: { allowNegativeStock: false },
    gl: { post: async (p) => void postings.push(p) },
  });

  const stockHook = createInventoryOpsStockHook(stockLedger, () => ({
    inventoryAccountId: "1200",
    counterpartAccountId: "3100",
  }));

  let adjCounter = 0;
  const adjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: new InMemoryDocumentRepository<StockAdjustmentDocLine>(),
    numbering: { next: async () => ({ value: ++adjCounter, formatted: `ADJ-${String(adjCounter).padStart(6, "0")}` }) },
    workflow: createDocumentWorkflowGate(() => null),
    stock: stockHook,
  });

  let trfCounter = 0;
  const transfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: new InMemoryDocumentRepository<StockTransferDocLine>(),
    numbering: { next: async () => ({ value: ++trfCounter, formatted: `TRF-${String(trfCounter).padStart(6, "0")}` }) },
    workflow: createDocumentWorkflowGate(() => null),
    stock: stockHook,
  });

  return { adjustments, transfers, stockLedger, postings };
}

async function seed(adjustments: ReturnType<typeof harness>["adjustments"], id: string, itemId: string, warehouseId: string, qty: string, unitCost: string) {
  await adjustments.createDraft({
    id,
    date: "2026-01-01",
    memo: "seed",
    lines: [{ itemId, warehouseId, reason: "INITIAL_STOCK", direction: "IN", qty: Qty.fromMajor(qty), unitCost: Money.fromMajor(unitCost) }],
  });
  await adjustments.confirm(id);
}

describe("stockTransferDocumentType — valuation neutrality, end to end", () => {
  it("draft → confirm assigns TRF- number, moves qty between warehouses, and never posts GL", async () => {
    const { adjustments, transfers, stockLedger, postings } = harness();
    await seed(adjustments, "OPEN1", "I1", "W1", "10", "5");
    postings.length = 0; // clear the opening-balance posting

    const beforeTotal = (await stockLedger.getValuation()).totalValue;
    expect(beforeTotal.toString()).toBe("50.000000");

    await transfers.createDraft({
      id: "T1",
      date: "2026-01-02",
      memo: "",
      lines: [{ itemId: "I1", fromWarehouseId: "W1", toWarehouseId: "W2", qty: Qty.fromMajor("4") }],
    });
    const { document } = await transfers.confirm("T1");
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBe("TRF-000001");

    const afterTotal = (await stockLedger.getValuation()).totalValue;
    expect(afterTotal.toString()).toBe("50.000000"); // UNCHANGED

    expect((await stockLedger.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("6.000000");
    expect((await stockLedger.getBalanceDetail("I1", "W2")).onHand.toString()).toBe("4.000000");
    expect((await stockLedger.getBalanceDetail("I1", "W2")).averageCost.toString()).toBe("5.000000");

    expect(postings).toHaveLength(0); // transfers never post to the GL
  });

  it("rejects a transfer naming the same source and destination warehouse", async () => {
    const { transfers } = harness();
    await expect(
      transfers.createDraft({
        id: "T1",
        date: "2026-01-01",
        memo: "",
        lines: [{ itemId: "I1", fromWarehouseId: "W1", toWarehouseId: "W1", qty: Qty.fromMajor("1") }],
      }),
    ).rejects.toThrow();
  });

  it("a confirmed transfer cannot be re-confirmed (one-way; reverse via a new opposite transfer)", async () => {
    const { adjustments, transfers } = harness();
    await seed(adjustments, "OPEN1", "I1", "W1", "10", "5");
    await transfers.createDraft({
      id: "T1",
      date: "2026-01-02",
      memo: "",
      lines: [{ itemId: "I1", fromWarehouseId: "W1", toWarehouseId: "W2", qty: Qty.fromMajor("1") }],
    });
    await transfers.confirm("T1");
    await expect(transfers.confirm("T1")).rejects.toThrow();
  });
});
