import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import {
  createJournalEntry,
  postJournalEntry,
  postDraftJournalEntry,
  type CreateJournalEntryCommand,
  type JournalPostingDeps,
} from "./post.js";
import {
  UnbalancedEntryError,
  InvalidJournalEntryError,
} from "../post-journal-entry.js";
import {
  AccountNotFoundError,
  HeaderAccountNotPostableError,
} from "../accounts/errors.js";
import {
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
} from "../fiscal-periods/errors.js";
import {
  InactiveAccountError,
  DuplicateJournalEntryError,
  JournalEntryNotDraftError,
  JournalEntryNotFoundError,
} from "./errors.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
  RecordingAuditSink,
  RecordingGlEventPublisher,
} from "./test-helpers/in-memory-ledger-repository.js";

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

interface Harness {
  deps: JournalPostingDeps;
  ledger: InMemoryLedgerRepository;
  periods: InMemoryFiscalPeriodRepository;
  audit: RecordingAuditSink;
  events: RecordingGlEventPublisher;
}

async function harness(): Promise<Harness> {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  const audit = new RecordingAuditSink();
  const events = new RecordingGlEventPublisher();

  await accounts.create(account("1300-1")); // cash (detail, active)
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("2200", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("1000", { isHeader: true })); // header — non-postable
  await accounts.create(account("9999", { status: "inactive" })); // inactive
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const deps: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    audit,
    events,
    now: () => "2026-08-22T10:00:00.000Z",
    actor: "u1",
  };
  return { deps, ledger, periods, audit, events };
}

const cashSale: CreateJournalEntryCommand = {
  id: "je-1",
  date: "2026-08-22",
  memo: "Cash sale",
  lines: [
    { accountId: "1300-1", debit: Money.fromMajor("1150.75"), credit: Money.zero() },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("1009.43") },
    { accountId: "2200", debit: Money.zero(), credit: Money.fromMajor("141.32") },
  ],
};

describe("postJournalEntry — happy path", () => {
  it("posts a balanced multi-line entry, stamps a JE number and posting time", async () => {
    const { deps, ledger } = await harness();
    const entry = await postJournalEntry(cashSale, deps);

    expect(entry.status).toBe("posted");
    expect(entry.entryNo).toBe("JE-000001");
    expect(entry.source).toBe("manual");
    expect(entry.postedAt).toBe("2026-08-22T10:00:00.000Z");
    expect(await ledger.findById("je-1")).not.toBeNull();
  });

  it("allocates gap-free sequential JE numbers", async () => {
    const { deps } = await harness();
    const first = await postJournalEntry(cashSale, deps);
    const second = await postJournalEntry({ ...cashSale, id: "je-2" }, deps);
    expect(first.entryNo).toBe("JE-000001");
    expect(second.entryNo).toBe("JE-000002");
  });

  it("records a sensitive audit event and publishes JOURNAL_ENTRY_POSTED", async () => {
    const { deps, audit, events } = await harness();
    await postJournalEntry(cashSale, deps);

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      stream: "sensitive",
      module: "accounting",
      entityType: "JOURNAL_ENTRY",
      action: "POST",
      actor: "u1",
    });
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({ type: "JOURNAL_ENTRY_POSTED", entryId: "je-1" });
    expect(events.events[0]?.totalDebit.toString()).toBe("1150.750000");
  });

  it("marks a document-driven entry as system-generated", async () => {
    const { deps } = await harness();
    const entry = await postJournalEntry({ ...cashSale, source: "system" }, deps);
    expect(entry.source).toBe("system");
  });
});

describe("postJournalEntry — rejections", () => {
  it("rejects an unbalanced entry", async () => {
    const { deps, ledger } = await harness();
    await expect(
      postJournalEntry(
        {
          ...cashSale,
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("90") },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
    expect(await ledger.findById("je-1")).toBeNull();
  });

  it("rejects an entry with fewer than two lines", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(
        { ...cashSale, lines: [{ accountId: "1300-1", debit: Money.fromMajor("1"), credit: Money.zero() }] },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });

  it("rejects a line that is both a debit and a credit", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(
        {
          ...cashSale,
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.fromMajor("100") },
            { accountId: "4000", debit: Money.zero(), credit: Money.zero() },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });

  it("rejects a negative amount", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(
        {
          ...cashSale,
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("-100"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("-100") },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });

  it("rejects posting to a header (non-postable) account", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(
        {
          ...cashSale,
          lines: [
            { accountId: "1000", debit: Money.fromMajor("50"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("50") },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(HeaderAccountNotPostableError);
  });

  it("rejects an unknown account", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(
        {
          ...cashSale,
          lines: [
            { accountId: "does-not-exist", debit: Money.fromMajor("50"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("50") },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it("rejects an inactive account", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(
        {
          ...cashSale,
          lines: [
            { accountId: "9999", debit: Money.fromMajor("50"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("50") },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(InactiveAccountError);
  });

  it("rejects a date with no fiscal period", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry({ ...cashSale, date: "2025-01-15" }, deps),
    ).rejects.toBeInstanceOf(NoFiscalPeriodForDateError);
  });

  it("rejects posting into a closed period", async () => {
    const { deps, periods } = await harness();
    await periods.update({
      id: "fp-2026-08",
      year: 2026,
      periodNumber: 8,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      status: "closed",
    });
    await expect(postJournalEntry(cashSale, deps)).rejects.toBeInstanceOf(
      PeriodNotOpenForPostingError,
    );
  });

  it("rejects a duplicate entry id", async () => {
    const { deps } = await harness();
    await postJournalEntry(cashSale, deps);
    await expect(postJournalEntry(cashSale, deps)).rejects.toBeInstanceOf(
      DuplicateJournalEntryError,
    );
  });
});

describe("createJournalEntry / postDraftJournalEntry — draft lifecycle", () => {
  it("creates a draft without a number, an audit event or a consumed sequence", async () => {
    const { deps, audit, events } = await harness();
    const draft = await createJournalEntry(cashSale, deps);
    expect(draft.status).toBe("draft");
    expect(draft.entryNo).toBeNull();
    expect(draft.postedAt).toBeNull();
    expect(audit.events).toHaveLength(0);
    expect(events.events).toHaveLength(0);
  });

  it("does not apply the period gate at draft time (only at post time)", async () => {
    const { deps } = await harness();
    // A date with no open period: draft succeeds, posting it would fail.
    const draft = await createJournalEntry({ ...cashSale, date: "2025-01-15" }, deps);
    expect(draft.status).toBe("draft");
  });

  it("posts an existing draft, assigning JE-000001", async () => {
    const { deps } = await harness();
    await createJournalEntry(cashSale, deps);
    const posted = await postDraftJournalEntry("je-1", deps);
    expect(posted.status).toBe("posted");
    expect(posted.entryNo).toBe("JE-000001");
  });

  it("refuses to post an unknown draft id", async () => {
    const { deps } = await harness();
    await expect(postDraftJournalEntry("nope", deps)).rejects.toBeInstanceOf(
      JournalEntryNotFoundError,
    );
  });

  it("refuses to re-post an already-posted entry", async () => {
    const { deps } = await harness();
    await postJournalEntry(cashSale, deps);
    await expect(postDraftJournalEntry("je-1", deps)).rejects.toBeInstanceOf(
      JournalEntryNotDraftError,
    );
  });
});
