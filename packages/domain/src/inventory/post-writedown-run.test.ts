import { describe, it, expect } from "vitest";
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
import { InMemoryWritedownRuns } from "./test-helpers/in-memory-stores.js";
import { postWritedownRun } from "./post-writedown-run.js";
import { WritedownRunNotDraftError, WritedownRunNotFoundError } from "./errors.js";
import type { WritedownRun } from "./writedown-run.js";

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

async function harness(run: Partial<WritedownRun> = {}) {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  await accounts.create(account("5060", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1190", { type: "asset", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-03", year: 2026, periodNumber: 3, startDate: "2026-03-01", endDate: "2026-03-31", status: "open" });

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
    ...run,
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

describe("postWritedownRun", () => {
  it("dates the entry to the period's last calendar day, not the wall-clock post time", async () => {
    const h = await harness();
    await postWritedownRun("run-1", h.deps);
    const entry = await h.ledger.findById("WRITEDOWN-JE:run-1");
    expect(entry!.date).toBe("2026-03-31");
    expect(entry!.source).toBe("system");
    expect(entry!.sourceDocType).toBe("WRITEDOWN_RUN");
    expect(entry!.sourceDocId).toBe("run-1");
    expect(entry!.sourceDocNumber).toBe("2026-03");
  });

  it("the memo names the warehouse when the run is warehouse-scoped, and omits it when tenant-wide", async () => {
    const scoped = await harness({ warehouseId: "wh-1" });
    await postWritedownRun("run-1", scoped.deps);
    const scopedEntry = await scoped.ledger.findById("WRITEDOWN-JE:run-1");
    expect(scopedEntry!.memo).toContain("warehouse wh-1");

    const unscoped = await harness();
    await postWritedownRun("run-1", unscoped.deps);
    const unscopedEntry = await unscoped.ledger.findById("WRITEDOWN-JE:run-1");
    expect(unscopedEntry!.memo).not.toContain("warehouse");
  });

  it("the posted run's journalEntryId points at the exact journal entry that was created", async () => {
    const h = await harness();
    const posted = await postWritedownRun("run-1", h.deps);
    const entry = await h.ledger.findById(posted.journalEntryId!);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(posted.journalEntryId);
  });

  it("never touches the run's own lines/totalAmount — only status/journalEntryId/postedAt change", async () => {
    const h = await harness();
    const before = await h.runs.findById("run-1");
    const posted = await postWritedownRun("run-1", h.deps);
    expect(posted.lines).toEqual(before!.lines);
    expect(posted.totalAmount.equals(before!.totalAmount)).toBe(true);
    expect(posted.period).toBe(before!.period);
  });

  it("rejects posting a run that does not exist", async () => {
    const h = await harness();
    await expect(postWritedownRun("missing", h.deps)).rejects.toBeInstanceOf(WritedownRunNotFoundError);
  });

  it("rejects re-posting an already-posted run", async () => {
    const h = await harness();
    await postWritedownRun("run-1", h.deps);
    await expect(postWritedownRun("run-1", h.deps)).rejects.toBeInstanceOf(WritedownRunNotDraftError);
  });

  it("rejects posting a cancelled run", async () => {
    const h = await harness({ status: "cancelled" });
    await expect(postWritedownRun("run-1", h.deps)).rejects.toBeInstanceOf(WritedownRunNotDraftError);
  });
});
