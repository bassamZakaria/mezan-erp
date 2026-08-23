import { describe, it, expect, beforeEach } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import type { JournalPostingDeps } from "../gl/index.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
  RecordingAuditSink,
  RecordingGlEventPublisher,
} from "../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryStockLedger, InMemorySnapshots, InMemoryWritedownRuns } from "./test-helpers/in-memory-stores.js";
import type { StockMovement } from "./movement.js";
import type { WacSnapshot } from "./ports.js";
import {
  agingDaysBetween,
  applyRateBps,
  periodEndDate,
  writedownRateForAgingDays,
  DEFAULT_AGING_WRITEDOWN_POLICY,
} from "./aging.js";
import { createWritedownRun } from "./create-writedown-run.js";
import { postWritedownRun } from "./post-writedown-run.js";
import {
  DuplicateWritedownPeriodError,
  NoSlowMovingStockError,
  WritedownRunNotDraftError,
  WritedownRunNotFoundError,
} from "./errors.js";

describe("aging policy (pure math)", () => {
  it("computes the last calendar day of a YYYY-MM period", () => {
    expect(periodEndDate("2026-02")).toBe("2026-02-28"); // 2026 is not a leap year
    expect(periodEndDate("2024-02")).toBe("2024-02-29"); // 2024 is a leap year
    expect(periodEndDate("2026-01")).toBe("2026-01-31");
  });

  it("computes whole-day aging, floored and never negative", () => {
    expect(agingDaysBetween("2026-01-01", "2026-04-01")).toBe(90);
    expect(agingDaysBetween("2026-03-31", "2026-03-31")).toBe(0);
    expect(agingDaysBetween("2026-04-01", "2026-01-01")).toBe(0); // future "last activity" clamps to 0
  });

  it("maps aging days to the default policy's bands", () => {
    expect(writedownRateForAgingDays(89)).toBe(0); // below the first band
    expect(writedownRateForAgingDays(90)).toBe(1_000); // 10%
    expect(writedownRateForAgingDays(179)).toBe(1_000);
    expect(writedownRateForAgingDays(180)).toBe(2_500); // 25%
    expect(writedownRateForAgingDays(364)).toBe(2_500);
    expect(writedownRateForAgingDays(365)).toBe(5_000); // 50%
    expect(writedownRateForAgingDays(10_000)).toBe(5_000);
  });

  it("applies a basis-point rate to a Money value, rounded HALF_UP", () => {
    expect(applyRateBps(Money.fromMajor("1000.00"), 1_000).toString()).toBe("100.000000");
    expect(applyRateBps(Money.fromMajor("1000.00"), 2_500).toString()).toBe("250.000000");
    expect(applyRateBps(Money.fromMajor("10.00"), 0).toString()).toBe("0.000000");
    expect(applyRateBps(Money.fromMajor("0.03"), 5_000).toString()).toBe("0.015000");
  });

  it("ships bands that are contiguous and ascending", () => {
    for (let i = 1; i < DEFAULT_AGING_WRITEDOWN_POLICY.length; i++) {
      expect(DEFAULT_AGING_WRITEDOWN_POLICY[i]!.minDays).toBe(DEFAULT_AGING_WRITEDOWN_POLICY[i - 1]!.maxDays);
    }
  });
});

function movement(overrides: Partial<StockMovement> & Pick<StockMovement, "id" | "itemId" | "warehouseId" | "occurredAt">): StockMovement {
  return {
    direction: "IN",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("100.00"),
    sourceDocType: "ADJUSTMENT",
    sourceDocId: "adj-1",
    sourceDocNumber: "ADJ-000001",
    reason: "INITIAL_STOCK",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WacSnapshot> & Pick<WacSnapshot, "itemId" | "warehouseId">): WacSnapshot {
  return {
    onHand: Qty.fromMajor("10"),
    totalValue: Money.fromMajor("1000.00"),
    averageCost: Money.fromMajor("100.00"),
    ...overrides,
  };
}

describe("createWritedownRun", () => {
  it("provisions only positions whose last movement is old enough per the aging policy", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();

    // item-slow: last touched 2025-09-01 -> 211 days before 2026-03-31 -> 25% band.
    await wacSnapshots.save(snapshot({ itemId: "item-slow", warehouseId: "wh-1", onHand: Qty.fromMajor("20"), totalValue: Money.fromMajor("2000.00") }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-slow", warehouseId: "wh-1", occurredAt: "2025-09-01T00:00:00.000Z" }));

    // item-fresh: last touched 2026-03-20 -> 11 days before period end -> below the first band, excluded.
    await wacSnapshots.save(snapshot({ itemId: "item-fresh", warehouseId: "wh-1" }));
    await stockLedger.append(movement({ id: "m2", itemId: "item-fresh", warehouseId: "wh-1", occurredAt: "2026-03-20T00:00:00.000Z" }));

    // item-zero: on-hand qty is zero -> never eligible even though it's old.
    await wacSnapshots.save(snapshot({ itemId: "item-zero", warehouseId: "wh-1", onHand: Qty.zero(), totalValue: Money.zero() }));
    await stockLedger.append(movement({ id: "m3", itemId: "item-zero", warehouseId: "wh-1", occurredAt: "2024-01-01T00:00:00.000Z" }));

    const run = await createWritedownRun(
      { id: "run-1", period: "2026-03" },
      { runs, wacSnapshots, stockLedger },
    );

    expect(run.status).toBe("draft");
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]!.itemId).toBe("item-slow");
    expect(run.lines[0]!.agingDays).toBe(211);
    expect(run.lines[0]!.writedownRateBps).toBe(2_500);
    expect(run.lines[0]!.amount.toString()).toBe("500.000000"); // 2000 * 25%
    expect(run.totalAmount.toString()).toBe("500.000000");
    expect(run.warehouseId).toBeNull();
    expect(run.journalEntryId).toBeNull();
  });

  it("scopes to a single warehouse when one is given", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();

    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1" }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2025-01-01T00:00:00.000Z" }));
    await wacSnapshots.save(snapshot({ itemId: "item-b", warehouseId: "wh-2" }));
    await stockLedger.append(movement({ id: "m2", itemId: "item-b", warehouseId: "wh-2", occurredAt: "2025-01-01T00:00:00.000Z" }));

    const run = await createWritedownRun(
      { id: "run-1", period: "2026-03", warehouseId: "wh-1" },
      { runs, wacSnapshots, stockLedger },
    );

    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]!.itemId).toBe("item-a");
    expect(run.warehouseId).toBe("wh-1");
  });

  it("rejects a duplicate non-cancelled run for the same period + warehouse scope", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1" }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2025-01-01T00:00:00.000Z" }));

    await createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger });

    await expect(createWritedownRun({ id: "run-2", period: "2026-03" }, { runs, wacSnapshots, stockLedger })).rejects.toBeInstanceOf(
      DuplicateWritedownPeriodError,
    );
  });

  it("allows re-running a period whose only prior run was cancelled", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-a", warehouseId: "wh-1" }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-a", warehouseId: "wh-1", occurredAt: "2025-01-01T00:00:00.000Z" }));

    const first = await createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger });
    await runs.update({ ...first, status: "cancelled" });

    const second = await createWritedownRun({ id: "run-2", period: "2026-03" }, { runs, wacSnapshots, stockLedger });
    expect(second.id).toBe("run-2");
  });

  it("rejects an empty result when nothing is slow-moving", async () => {
    const runs = new InMemoryWritedownRuns();
    const wacSnapshots = new InMemorySnapshots();
    const stockLedger = new InMemoryStockLedger();
    await wacSnapshots.save(snapshot({ itemId: "item-fresh", warehouseId: "wh-1" }));
    await stockLedger.append(movement({ id: "m1", itemId: "item-fresh", warehouseId: "wh-1", occurredAt: "2026-03-25T00:00:00.000Z" }));

    await expect(createWritedownRun({ id: "run-1", period: "2026-03" }, { runs, wacSnapshots, stockLedger })).rejects.toBeInstanceOf(
      NoSlowMovingStockError,
    );
  });
});

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

describe("postWritedownRun", () => {
  async function harness() {
    const ledger = new InMemoryLedgerRepository();
    const accounts = new InMemoryAccountRepository();
    const periods = new InMemoryFiscalPeriodRepository();
    await accounts.create(account("5060", { type: "expense", naturalBalance: "debit" }));
    await accounts.create(account("1190", { type: "asset", naturalBalance: "credit" }));
    await periods.create({
      id: "fp-2026-03",
      year: 2026,
      periodNumber: 3,
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      status: "open",
    });

    const gl: JournalPostingDeps = {
      ledger,
      accounts,
      periods,
      numbering: new NextNumberService(new InMemorySequenceStore()),
      audit: new RecordingAuditSink(),
      events: new RecordingGlEventPublisher(),
      now: () => "2026-03-31T10:00:00.000Z",
      actor: "u1",
    };

    const runs = new InMemoryWritedownRuns();
    await runs.create({
      id: "run-1",
      period: "2026-03",
      warehouseId: null,
      status: "draft",
      lines: [
        {
          itemId: "item-slow",
          warehouseId: "wh-1",
          onHandQty: Qty.fromMajor("20"),
          unitCost: Money.fromMajor("100.00"),
          agingDays: 211,
          writedownRateBps: 2_500,
          amount: Money.fromMajor("500.00"),
        },
      ],
      totalAmount: Money.fromMajor("500.00"),
      journalEntryId: null,
      createdAt: "2026-03-31T00:00:00.000Z",
      postedAt: null,
    });

    return {
      runs,
      ledger,
      deps: {
        runs,
        gl,
        now: () => "2026-03-31T12:00:00.000Z",
        accounts: { writedownExpenseAccountId: "5060", provisionAccountId: "1190" },
      },
    };
  }

  it("posts one balanced entry Dr write-down expense / Cr provision, and marks the run posted", async () => {
    const h = await harness();
    const posted = await postWritedownRun("run-1", h.deps);

    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).toBe("WRITEDOWN-JE:run-1");
    expect(posted.postedAt).toBe("2026-03-31T12:00:00.000Z");

    const entry = await h.ledger.findById("WRITEDOWN-JE:run-1");
    expect(entry).not.toBeNull();
    expect(entry!.status).toBe("posted");
    expect(entry!.date).toBe("2026-03-31");
    expect(entry!.lines).toHaveLength(2);

    const expenseLine = entry!.lines.find((l) => l.accountId === "5060")!;
    const provisionLine = entry!.lines.find((l) => l.accountId === "1190")!;
    expect(expenseLine.debit.toString()).toBe("500.000000");
    expect(expenseLine.credit.scaled).toBe(0n);
    expect(provisionLine.credit.toString()).toBe("500.000000");
    expect(provisionLine.debit.scaled).toBe(0n);
  });

  it("rejects posting a run that does not exist", async () => {
    const h = await harness();
    await expect(postWritedownRun("missing", h.deps)).rejects.toBeInstanceOf(WritedownRunNotFoundError);
  });

  it("rejects posting a non-draft run (idempotent post)", async () => {
    const h = await harness();
    await postWritedownRun("run-1", h.deps);
    await expect(postWritedownRun("run-1", h.deps)).rejects.toBeInstanceOf(WritedownRunNotDraftError);
  });
});
