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
import { VatPeriodAlreadyFiledError } from "../tax/vat-filing.js";
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

    // Which accounts moved, by how much, and on which side — a posting that
    // swapped an account or an amount would otherwise pass this test.
    expect((await ledger.accountBalance("1300-1")).debit.toString()).toBe("1150.750000");
    expect((await ledger.accountBalance("1300-1")).credit.toString()).toBe("0.000000");
    expect((await ledger.accountBalance("4000")).credit.toString()).toBe("1009.430000");
    expect((await ledger.accountBalance("2200")).credit.toString()).toBe("141.320000");

    const debit = entry.lines.reduce((acc, l) => acc + l.debit.scaled, 0n);
    const credit = entry.lines.reduce((acc, l) => acc + l.credit.scaled, 0n);
    expect(debit).toBe(credit);
    expect(debit).toBe(1_150_750_000n);
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

describe("the VAT-filing lock (D29)", () => {
  /** A filings port that reports one filed return covering August 2026. */
  function filings(status: "filed" | "amended" | "draft") {
    return {
      async findCovering(date: string) {
        return date >= "2026-08-01" && date <= "2026-08-31" ? [{ id: "vat-2026-08", status }] : [];
      },
    };
  }

  it("refuses a posting dated inside a period whose VAT return has been filed", async () => {
    const { deps, ledger } = await harness();
    await expect(
      postJournalEntry(cashSale, { ...deps, vatFilings: filings("filed") }),
    ).rejects.toBeInstanceOf(VatPeriodAlreadyFiledError);

    // Nothing is written: a refused posting must leave the ledger untouched,
    // or the return the authority already has stops matching the books.
    expect(await ledger.findById("je-1")).toBeNull();
  });

  it("names the filing and the date it refused, so the screen can say which return is closed", async () => {
    const { deps } = await harness();
    try {
      await postJournalEntry(cashSale, { ...deps, vatFilings: filings("filed") });
      throw new Error("expected the posting to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(VatPeriodAlreadyFiledError);
      expect((error as Error).message).toContain("2026-08-22");
    }
  });

  it("allows a posting dated outside the filed window", async () => {
    const { deps, periods } = await harness();
    await periods.create({
      id: "fp-2026-09",
      year: 2026,
      periodNumber: 9,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      status: "open",
    });
    const entry = await postJournalEntry(
      { ...cashSale, id: "je-sept", date: "2026-09-15" },
      { ...deps, vatFilings: filings("filed") },
    );
    expect(entry.status).toBe("posted");
  });

  it("allows a posting once the filing is amended rather than filed", async () => {
    const { deps } = await harness();
    const entry = await postJournalEntry(cashSale, { ...deps, vatFilings: filings("amended") });
    expect(entry.status).toBe("posted");
  });

  it("allows a posting when the return is still a draft", async () => {
    const { deps } = await harness();
    const entry = await postJournalEntry(cashSale, { ...deps, vatFilings: filings("draft") });
    expect(entry.status).toBe("posted");
  });

  it("posts normally when no filings port is wired at all", async () => {
    const { deps } = await harness();
    const entry = await postJournalEntry(cashSale, { ...deps, vatFilings: undefined });
    expect(entry.status).toBe("posted");
  });

  it("checks the lock BEFORE writing, not after — a refused entry consumes no JE number", async () => {
    const { deps, ledger } = await harness();
    await expect(
      postJournalEntry(cashSale, { ...deps, vatFilings: filings("filed") }),
    ).rejects.toBeInstanceOf(VatPeriodAlreadyFiledError);

    const next = await postJournalEntry({ ...cashSale, id: "je-2" }, deps);
    expect(next.entryNo).toBe("JE-000001");
    expect((await ledger.list()).length).toBe(1);
  });
});
