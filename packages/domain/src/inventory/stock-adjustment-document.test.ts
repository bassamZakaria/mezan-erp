import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { InMemoryDocumentRepository } from "../documents/test-helpers/in-memory-document-repository.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "./test-helpers/in-memory-stores.js";
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

  let counter = 0;
  const service = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: new InMemoryDocumentRepository<StockAdjustmentDocLine>(),
    numbering: { next: async () => ({ value: ++counter, formatted: `ADJ-${String(counter).padStart(6, "0")}` }) },
    stock: createInventoryOpsStockHook(stockLedger, (reason) =>
      reason === "INITIAL_STOCK" || reason === "OTHER"
        ? { inventoryAccountId: "1200", counterpartAccountId: reason === "INITIAL_STOCK" ? "3100" : "5900" }
        : { inventoryAccountId: "1200", counterpartAccountId: "5900" },
    ),
  });

  return { service, stockLedger, postings };
}

describe("stockAdjustmentDocumentType — the 8 reasons + direction validation", () => {
  it("rejects a line whose direction contradicts an IN-only reason (INITIAL_STOCK)", async () => {
    const { service } = harness();
    await expect(
      service.createDraft({
        id: "A1",
        date: "2026-01-01",
        memo: "",
        lines: [
          {
            itemId: "I1",
            warehouseId: "W1",
            reason: "INITIAL_STOCK",
            direction: "OUT",
            qty: Qty.fromMajor("1"),
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects a line whose direction contradicts an OUT-only reason (DAMAGE)", async () => {
    const { service } = harness();
    await expect(
      service.createDraft({
        id: "A1",
        date: "2026-01-01",
        memo: "",
        lines: [
          { itemId: "I1", warehouseId: "W1", reason: "DAMAGE", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") },
        ],
      }),
    ).rejects.toThrow();
  });

  it("accepts either direction for an EITHER reason (PHYSICAL_COUNT, OTHER)", async () => {
    const { service } = harness();
    const doc = await service.createDraft({
      id: "A1",
      date: "2026-01-01",
      memo: "",
      lines: [
        { itemId: "I1", warehouseId: "W1", reason: "OTHER", direction: "OUT", qty: Qty.fromMajor("1") },
      ],
    });
    expect(doc.status).toBe("draft");
  });

  it("rejects mixed warehouses/reasons across lines of one adjustment", async () => {
    const { service } = harness();
    await expect(
      service.createDraft({
        id: "A1",
        date: "2026-01-01",
        memo: "",
        lines: [
          { itemId: "I1", warehouseId: "W1", reason: "OTHER", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") },
          { itemId: "I2", warehouseId: "W2", reason: "OTHER", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe("stockAdjustmentDocumentType — INITIAL_STOCK opening balance, confirmed end to end", () => {
  it("draft → confirm assigns ADJ- number, moves stock, and posts Dr Inventory / Cr Owner Capital", async () => {
    const { service, stockLedger, postings } = harness();
    await service.createDraft({
      id: "OPEN1",
      date: "2026-01-01",
      memo: "الرصيد الافتتاحي",
      lines: [
        {
          itemId: "I1",
          warehouseId: "W1",
          reason: "INITIAL_STOCK",
          direction: "IN",
          qty: Qty.fromMajor("100"),
          unitCost: Money.fromMajor("5000"),
        },
      ],
    });

    const { document, held } = await service.confirm("OPEN1");
    expect(held).toBe(false);
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBe("ADJ-000001");

    const balance = await stockLedger.getBalanceDetail("I1", "W1");
    expect(balance.onHand.toString()).toBe("100.000000");
    expect(balance.totalValue.toString()).toBe("500000.000000");

    expect(postings).toHaveLength(1);
    const p = postings[0] as InventoryGlPosting;
    expect(p.lines.find((l) => l.debit.scaled > 0n)?.accountId).toBe("1200");
    expect(p.lines.find((l) => l.credit.scaled > 0n)?.accountId).toBe("3100");
    expect(p.lines.find((l) => l.credit.scaled > 0n)?.credit.toString()).toBe("500000.000000");
  });

  it("a confirmed adjustment cannot be re-confirmed or edited (append-only)", async () => {
    const { service } = harness();
    await service.createDraft({
      id: "A1",
      date: "2026-01-01",
      memo: "",
      lines: [{ itemId: "I1", warehouseId: "W1", reason: "OTHER", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1") }],
    });
    await service.confirm("A1");
    await expect(service.confirm("A1")).rejects.toThrow();
  });
});

describe("stockAdjustmentDocumentType — describeEffects", () => {
  it("is blocked with no lines and unblocked otherwise", () => {
    const empty = stockAdjustmentDocumentType.describeEffects({
      id: "x",
      docType: "STOCK_ADJUSTMENT",
      docNo: null,
      date: "2026-01-01",
      memo: "",
      status: "draft",
      lines: [],
      createdAt: "",
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });
    expect(empty.blocked).toBe(true);

    const withLines = stockAdjustmentDocumentType.describeEffects({
      id: "x",
      docType: "STOCK_ADJUSTMENT",
      docNo: null,
      date: "2026-01-01",
      memo: "",
      status: "draft",
      lines: [{ itemId: "I1", warehouseId: "W1", reason: "OTHER", direction: "IN", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("2") }],
      createdAt: "",
      confirmedAt: null,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });
    expect(withLines.blocked).toBe(false);
    expect(withLines.effects.some((e) => e.kind === "stock")).toBe(true);
    expect(withLines.effects.some((e) => e.kind === "gl")).toBe(true);
  });
});
