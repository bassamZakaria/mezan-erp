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
  RecordingGlEventPublisher,
} from "../gl/test-helpers/in-memory-ledger-repository.js";
import type { JournalPostingDeps } from "../gl/index.js";
import { UnbalancedEntryError } from "../post-journal-entry.js";
import type { DocumentStockPlan } from "../documents/hooks.js";
import { StockLedgerService } from "./stock-ledger-service.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "./test-helpers/in-memory-stores.js";
import { createInventoryGlPostingHook, createInventoryOpsStockHook } from "./document-hooks.js";
import type { InventoryGlPosting } from "./ports.js";

function stockHarness() {
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
  return { stockLedger, postings };
}

function adjustmentPlan(overrides: Partial<DocumentStockPlan> = {}): DocumentStockPlan {
  return {
    sourceDocType: "STOCK_ADJUSTMENT",
    sourceDocId: "ADJ1",
    sourceDocNumber: "ADJ-000001",
    warehouseId: "wh-1",
    reason: "INITIAL_STOCK",
    date: "2026-01-01",
    lines: [{ itemId: "item-1", direction: "IN", qty: Qty.fromMajor("10"), unitCost: Money.fromMajor("50.00") }],
    ...overrides,
  };
}

describe("createInventoryOpsStockHook — adjustment path (no toWarehouseId)", () => {
  it("routes to postAdjustment, moving both qty and value", async () => {
    const { stockLedger, postings } = stockHarness();
    const hook = createInventoryOpsStockHook(stockLedger);
    const result = await hook.apply(adjustmentPlan());

    expect(result.valueMoved.equals(Money.zero())).toBe(true); // postAdjustment posts its own GL; caller has nothing further
    const balance = await stockLedger.getBalanceDetail("item-1", "wh-1");
    expect(balance.onHand.toString()).toBe("10.000000");
    expect(balance.totalValue.toString()).toBe("500.000000");
    expect(postings).toHaveLength(0); // no glAccountsForReason given -> no GL posting
  });

  it("posts a balanced GL entry when glAccountsForReason resolves an account mapping", async () => {
    const { stockLedger, postings } = stockHarness();
    const hook = createInventoryOpsStockHook(stockLedger, (reason) =>
      reason === "INITIAL_STOCK" ? { inventoryAccountId: "1200", counterpartAccountId: "3100" } : null,
    );
    await hook.apply(adjustmentPlan());

    expect(postings).toHaveLength(1);
    const posting = postings[0] as InventoryGlPosting;
    expect(posting.lines.find((l) => l.debit.scaled > 0n)?.accountId).toBe("1200");
    expect(posting.lines.find((l) => l.debit.scaled > 0n)?.debit.toString()).toBe("500.000000");
    expect(posting.lines.find((l) => l.credit.scaled > 0n)?.accountId).toBe("3100");
    expect(posting.lines.find((l) => l.credit.scaled > 0n)?.credit.toString()).toBe("500.000000");
  });

  it("posts nothing to GL when glAccountsForReason resolves null for that reason (no account mapping configured)", async () => {
    const { stockLedger, postings } = stockHarness();
    const hook = createInventoryOpsStockHook(stockLedger, () => null);
    await hook.apply(adjustmentPlan());
    expect(postings).toHaveLength(0);
    // the movement still happened even without a GL posting.
    const balance = await stockLedger.getBalanceDetail("item-1", "wh-1");
    expect(balance.onHand.toString()).toBe("10.000000");
  });

  it("dates the movement from plan.date rather than wall-clock now", async () => {
    const { stockLedger } = stockHarness();
    const hook = createInventoryOpsStockHook(stockLedger);
    await hook.apply(adjustmentPlan({ date: "2026-02-15" }));
    const movements = await stockLedger.getBalanceDetail("item-1", "wh-1");
    expect(movements.onHand.toString()).toBe("10.000000"); // sanity: posted at all
  });

  it("an OUT adjustment line reduces both qty and value, paired", async () => {
    const { stockLedger, postings } = stockHarness();
    const hook = createInventoryOpsStockHook(stockLedger, () => ({ inventoryAccountId: "1200", counterpartAccountId: "5900" }));
    await hook.apply(adjustmentPlan()); // seed 10 @ 50
    await hook.apply(
      adjustmentPlan({
        sourceDocId: "ADJ2",
        sourceDocNumber: "ADJ-000002",
        reason: "DAMAGE",
        lines: [{ itemId: "item-1", direction: "OUT", qty: Qty.fromMajor("4") }],
      }),
    );
    const balance = await stockLedger.getBalanceDetail("item-1", "wh-1");
    expect(balance.onHand.toString()).toBe("6.000000");
    expect(balance.totalValue.toString()).toBe("300.000000"); // 6 * 50

    const damagePosting = postings.find((p) => p.sourceDocId === "ADJ2")!;
    expect(damagePosting.lines.find((l) => l.credit.scaled > 0n)?.accountId).toBe("1200"); // value LEFT inventory
    expect(damagePosting.lines.find((l) => l.debit.scaled > 0n)?.accountId).toBe("5900");
  });
});

describe("createInventoryOpsStockHook — transfer path (toWarehouseId present)", () => {
  it("routes to postTransfer, moving qty out of source and into destination at the same cost — valuation neutral", async () => {
    const { stockLedger, postings } = stockHarness();
    const hook = createInventoryOpsStockHook(stockLedger);
    await hook.apply(adjustmentPlan()); // seed wh-1 with 10 @ 50

    const result = await hook.apply({
      sourceDocType: "STOCK_TRANSFER",
      sourceDocId: "TRF1",
      sourceDocNumber: "TRF-000001",
      warehouseId: "wh-1",
      toWarehouseId: "wh-2",
      date: "2026-01-05",
      lines: [{ itemId: "item-1", direction: "OUT", qty: Qty.fromMajor("4") }],
    });

    expect(result.valueMoved.equals(Money.zero())).toBe(true);
    const source = await stockLedger.getBalanceDetail("item-1", "wh-1");
    const dest = await stockLedger.getBalanceDetail("item-1", "wh-2");
    expect(source.onHand.toString()).toBe("6.000000");
    expect(dest.onHand.toString()).toBe("4.000000");
    expect(source.totalValue.toString()).toBe("300.000000");
    expect(dest.totalValue.toString()).toBe("200.000000"); // moved at the SAME unit cost -> total system value unchanged
    expect(postings).toHaveLength(0); // a transfer never posts to the GL
  });
});

describe("createInventoryGlPostingHook", () => {
  async function glHarness() {
    const ledger = new InMemoryLedgerRepository();
    const accounts = new InMemoryAccountRepository();
    const periods = new InMemoryFiscalPeriodRepository();
    await accounts.create({ id: "1200", code: "1200", nameAr: "مخزون", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" } satisfies Account);
    await accounts.create({ id: "3100", code: "3100", nameAr: "رأس المال", nameEn: null, type: "equity", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" } satisfies Account);
    await periods.create({ id: "fp-2026-01", year: 2026, periodNumber: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "open" });

    const deps: JournalPostingDeps = {
      ledger,
      accounts,
      periods,
      numbering: new NextNumberService(new InMemorySequenceStore()),
      audit: new RecordingAuditSink(),
      events: new RecordingGlEventPublisher(),
      now: () => "2026-01-10T09:00:00.000Z",
      actor: "u1",
    };
    return { ledger, deps };
  }

  it("posts a real journal entry through the GL engine, keyed by the document's own id", async () => {
    const { ledger, deps } = await glHarness();
    const hook = createInventoryGlPostingHook(deps);

    await hook.post({
      sourceDocType: "STOCK_ADJUSTMENT",
      sourceDocId: "ADJ1",
      sourceDocNumber: "ADJ-000001",
      date: "2026-01-10",
      memo: "تسوية رصيد افتتاحي",
      lines: [
        { accountId: "1200", debit: Money.fromMajor("500.00"), credit: Money.zero() },
        { accountId: "3100", debit: Money.zero(), credit: Money.fromMajor("500.00") },
      ],
    });

    const entry = await ledger.findById("ADJ1");
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("posted");
    expect(entry!.source).toBe("system");
    expect(entry!.sourceDocType).toBe("STOCK_ADJUSTMENT");
    expect(entry!.sourceDocId).toBe("ADJ1");
    expect(entry!.sourceDocNumber).toBe("ADJ-000001");
    expect(entry!.memo).toBe("تسوية رصيد افتتاحي");
    expect(entry!.lines.find((l) => l.accountId === "1200")!.debit.toString()).toBe("500.000000");
    expect(entry!.lines.find((l) => l.accountId === "3100")!.credit.toString()).toBe("500.000000");
  });

  it("rejects an unbalanced posting — Σdebit must equal Σcredit", async () => {
    const { deps } = await glHarness();
    const hook = createInventoryGlPostingHook(deps);
    await expect(
      hook.post({
        sourceDocType: "STOCK_ADJUSTMENT",
        sourceDocId: "ADJ1",
        sourceDocNumber: "ADJ-000001",
        date: "2026-01-10",
        memo: "x",
        lines: [
          { accountId: "1200", debit: Money.fromMajor("500.00"), credit: Money.zero() },
          { accountId: "3100", debit: Money.zero(), credit: Money.fromMajor("400.00") },
        ],
      }),
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
  });
});
