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
  replaceDraftJournalEntry,
  deleteDraftJournalEntry,
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
  InvalidJournalPartyError,
  PartyRequiredOnControlAccountError,
} from "./errors.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
  RecordingAuditSink,
  RecordingGlEventPublisher,
} from "./test-helpers/in-memory-ledger-repository.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";

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
    await expect(postJournalEntry(cashSale, deps)).rejects.toBeInstanceOf(DuplicateRecordIdError);
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

describe("the memorandum partition (C.2)", () => {
  async function memoHarness() {
    const h = await harness();
    const accounts = h.deps.accounts as InMemoryAccountRepository;
    await accounts.create(account("9100", { type: "memorandum" }));
    await accounts.create(account("9200", { type: "memorandum", naturalBalance: "credit" }));
    return h;
  }

  it("posts a pure memorandum pair", async () => {
    const { deps } = await memoHarness();
    const entry = await postJournalEntry(
      {
        id: "je-memo",
        date: "2026-08-22",
        memo: "خطاب ضمان",
        lines: [
          { accountId: "9100", debit: Money.fromMajor("500000"), credit: Money.zero() },
          { accountId: "9200", debit: Money.zero(), credit: Money.fromMajor("500000") },
        ],
      },
      deps,
    );
    expect(entry.status).toBe("posted");
  });

  it("posts an entry where BOTH partitions balance on their own", async () => {
    const { deps } = await memoHarness();
    const entry = await postJournalEntry(
      {
        id: "je-both",
        date: "2026-08-22",
        memo: "إصدار خطاب ضمان بغطاء نقدي",
        lines: [
          { accountId: "9100", debit: Money.fromMajor("500000"), credit: Money.zero() },
          { accountId: "9200", debit: Money.zero(), credit: Money.fromMajor("500000") },
          { accountId: "1300-1", debit: Money.fromMajor("100000"), credit: Money.zero() },
          { accountId: "2200", debit: Money.zero(), credit: Money.fromMajor("100000") },
        ],
      },
      deps,
    );
    expect(entry.status).toBe("posted");
  });

  it("REFUSES an entry that balances only by mixing memorandum with real accounts", async () => {
    const { deps, ledger } = await memoHarness();
    await expect(
      postJournalEntry(
        {
          id: "je-mixed",
          date: "2026-08-22",
          memo: "قيد مختلط",
          lines: [
            { accountId: "9100", debit: Money.fromMajor("500000"), credit: Money.zero() },
            { accountId: "2200", debit: Money.zero(), credit: Money.fromMajor("500000") },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
    expect((await ledger.list()).length).toBe(0);
  });
});

describe("the entry date is a calendar day (C.10)", () => {
  it("REFUSES a full ISO timestamp", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry({ ...cashSale, date: "2026-08-22T10:00:00.000Z" }, deps),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });

  it("REFUSES a draft dated with a timestamp too", async () => {
    const { deps } = await harness();
    await expect(
      createJournalEntry({ ...cashSale, date: "2026-08-22T10:00:00.000Z" }, deps),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });
});

describe("project-bound control accounts (C.4)", () => {
  const projectRequiredAccountIds = new Set(["2200"]);

  it("REFUSES a line on a contracting control account with no projectId", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(cashSale, { ...deps, projectRequiredAccountIds }),
    ).rejects.toBeInstanceOf(InvalidJournalEntryError);
  });

  it("accepts the same entry once the line names a project", async () => {
    const { deps } = await harness();
    const entry = await postJournalEntry(
      {
        ...cashSale,
        lines: cashSale.lines.map((l) => (l.accountId === "2200" ? { ...l, projectId: "PRJ-1" } : l)),
      },
      { ...deps, projectRequiredAccountIds },
    );
    expect(entry.status).toBe("posted");
  });
});

describe("party control accounts — a manual line on 1105/2100 names its party (D205)", () => {
  const partyControlAccounts = new Map([["1300-1", "customer" as const], ["2200", "supplier" as const]]);
  const partyExists = async (kind: "customer" | "supplier", id: string) =>
    (kind === "customer" && id === "CUST-1") || (kind === "supplier" && id === "SUPP-1");
  const withParties = (lines: CreateJournalEntryCommand["lines"]): CreateJournalEntryCommand => ({ ...cashSale, lines });

  it("refuses a line on the receivables control account that names no customer, in Arabic and English", async () => {
    const { deps, ledger } = await harness();
    const refusal = postJournalEntry(cashSale, { ...deps, partyControlAccounts, partyExists });
    await expect(refusal).rejects.toBeInstanceOf(PartyRequiredOnControlAccountError);
    await expect(refusal).rejects.toMatchObject({
      code: "PARTY_REQUIRED_ON_CONTROL_ACCOUNT",
      accountId: "1300-1",
      partyKind: "customer",
      message: expect.stringContaining("العميل"),
      messageEn: expect.stringContaining("customer"),
    });
    expect(await ledger.findById("je-1")).toBeNull();
  });

  it("refuses the same line as a draft, and when a draft missing it is posted", async () => {
    const { deps } = await harness();
    await expect(createJournalEntry(cashSale, { ...deps, partyControlAccounts, partyExists })).rejects.toBeInstanceOf(
      PartyRequiredOnControlAccountError,
    );
    await createJournalEntry(cashSale, deps);
    await expect(postDraftJournalEntry("je-1", { ...deps, partyControlAccounts, partyExists })).rejects.toBeInstanceOf(
      PartyRequiredOnControlAccountError,
    );
  });

  it("posts once every control line names a party that exists, and keeps the party on the line", async () => {
    const { deps } = await harness();
    const entry = await postJournalEntry(
      withParties([
        { ...cashSale.lines[0]!, partyId: "CUST-1" },
        cashSale.lines[1]!,
        { ...cashSale.lines[2]!, partyId: "SUPP-1" },
      ]),
      { ...deps, partyControlAccounts, partyExists },
    );
    expect(entry.lines.map((l) => l.partyId)).toEqual(["CUST-1", null, "SUPP-1"]);
  });

  it("refuses a party that does not exist, and a party on an account that is not a control account", async () => {
    const { deps } = await harness();
    await expect(
      postJournalEntry(
        withParties([{ ...cashSale.lines[0]!, partyId: "CUST-GHOST" }, cashSale.lines[1]!, { ...cashSale.lines[2]!, partyId: "SUPP-1" }]),
        { ...deps, partyControlAccounts, partyExists },
      ),
    ).rejects.toBeInstanceOf(InvalidJournalPartyError);
    await expect(
      postJournalEntry(
        withParties([{ ...cashSale.lines[0]!, partyId: "CUST-1" }, { ...cashSale.lines[1]!, partyId: "CUST-1" }, { ...cashSale.lines[2]!, partyId: "SUPP-1" }]),
        { ...deps, partyControlAccounts, partyExists },
      ),
    ).rejects.toBeInstanceOf(InvalidJournalPartyError);
  });

  it("checks nothing for a posting whose composition supplies no control accounts — a document posting", async () => {
    const { deps } = await harness();
    expect((await postJournalEntry(cashSale, deps)).status).toBe("posted");
  });
});

describe("replaceDraftJournalEntry / deleteDraftJournalEntry — editing and discarding a draft (D226)", () => {
  const partyControlAccounts = new Map([["1300-1", "customer" as const], ["2200", "supplier" as const]]);
  const partyExists = async (kind: "customer" | "supplier", id: string) =>
    (kind === "customer" && id === "CUST-1") || (kind === "supplier" && id === "SUPP-1");

  it("overwrites a draft's date, memo and lines in place, keeping its id and draft status", async () => {
    const { deps, ledger } = await harness();
    await createJournalEntry(cashSale, deps);

    const edited = await replaceDraftJournalEntry(
      "je-1",
      {
        date: "2026-08-23",
        memo: "Cash sale (corrected)",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("200"), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("200") },
        ],
      },
      deps,
    );

    expect(edited.id).toBe("je-1");
    expect(edited.status).toBe("draft");
    expect(edited.entryNo).toBeNull();
    expect(edited.date).toBe("2026-08-23");
    expect(edited.memo).toBe("Cash sale (corrected)");
    expect(edited.lines).toHaveLength(2);

    const stored = await ledger.findById("je-1");
    expect(stored?.date).toBe("2026-08-23");
    expect(stored?.lines).toHaveLength(2);
  });

  it("re-validates on edit: an unbalanced replacement is refused and the draft is left untouched", async () => {
    const { deps, ledger } = await harness();
    await createJournalEntry(cashSale, deps);
    await expect(
      replaceDraftJournalEntry(
        "je-1",
        {
          date: "2026-08-23",
          memo: "unbalanced",
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("90") },
          ],
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(UnbalancedEntryError);
    expect((await ledger.findById("je-1"))?.memo).toBe("Cash sale");
  });

  it("adding the missing party (D205) to a legacy draft's control-account line makes it postable", async () => {
    const { deps } = await harness();
    // Saved before D205 existed: a party-less line on the receivables control account.
    await createJournalEntry(cashSale, deps);
    await expect(
      postDraftJournalEntry("je-1", { ...deps, partyControlAccounts, partyExists }),
    ).rejects.toBeInstanceOf(PartyRequiredOnControlAccountError);

    const edited = await replaceDraftJournalEntry(
      "je-1",
      {
        date: cashSale.date,
        memo: cashSale.memo,
        lines: cashSale.lines.map((l) =>
          l.accountId === "1300-1"
            ? { ...l, partyId: "CUST-1" }
            : l.accountId === "2200"
              ? { ...l, partyId: "SUPP-1" }
              : l,
        ),
      },
      { ...deps, partyControlAccounts, partyExists },
    );
    expect(edited.lines.find((l) => l.accountId === "1300-1")?.partyId).toBe("CUST-1");
    expect(edited.lines.find((l) => l.accountId === "2200")?.partyId).toBe("SUPP-1");

    const posted = await postDraftJournalEntry("je-1", { ...deps, partyControlAccounts, partyExists });
    expect(posted.status).toBe("posted");
    expect(posted.entryNo).toBe("JE-000001");
  });

  it("refuses to edit an unknown draft id", async () => {
    const { deps } = await harness();
    await expect(
      replaceDraftJournalEntry("nope", { date: "2026-08-22", memo: "x", lines: cashSale.lines }, deps),
    ).rejects.toBeInstanceOf(JournalEntryNotFoundError);
  });

  it("refuses to edit a posted entry — corrections are reversals, not edits", async () => {
    const { deps } = await harness();
    await postJournalEntry(cashSale, deps);
    await expect(
      replaceDraftJournalEntry("je-1", { date: "2026-08-22", memo: "sneaky edit", lines: cashSale.lines }, deps),
    ).rejects.toBeInstanceOf(JournalEntryNotDraftError);
  });

  it("deletes a draft outright, and it is gone from the ledger", async () => {
    const { deps, ledger } = await harness();
    await createJournalEntry(cashSale, deps);
    await deleteDraftJournalEntry("je-1", deps);
    expect(await ledger.findById("je-1")).toBeNull();
  });

  it("refuses to delete an unknown id", async () => {
    const { deps } = await harness();
    await expect(deleteDraftJournalEntry("nope", deps)).rejects.toBeInstanceOf(JournalEntryNotFoundError);
  });

  it("refuses to delete a posted entry — it stays immutable and undeletable", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(cashSale, deps);
    await expect(deleteDraftJournalEntry("je-1", deps)).rejects.toBeInstanceOf(JournalEntryNotDraftError);
    expect(await ledger.findById("je-1")).not.toBeNull();
  });

  it("audits an edit and a delete", async () => {
    const { deps, audit } = await harness();
    await createJournalEntry(cashSale, deps);
    await replaceDraftJournalEntry("je-1", { date: "2026-08-23", memo: "edited", lines: cashSale.lines }, deps);
    await deleteDraftJournalEntry("je-1", deps);

    expect(audit.events.map((e) => e.action)).toEqual(["UPDATE", "DELETE"]);
    expect(audit.events.every((e) => e.entityType === "JOURNAL_ENTRY")).toBe(true);
  });
});

/**
 * Every audit row in the GL used to be appended after its transaction closed,
 * so a crash between the two lost the record of a posting that had happened —
 * and a rolled-back write could leave a record of one that had not. These pin
 * the boundary rather than the mere presence of a row.
 */
describe("the audit row is written inside the write's own transaction", () => {
  function witness(h: Harness): string[] {
    const inside: string[] = [];
    const sink = h.deps.audit!;
    const append = sink.append.bind(sink);
    sink.append = async (event) => {
      inside.push(h.ledger.inTransaction ? "inside" : "outside");
      await append(event);
    };
    return inside;
  }

  it("postJournalEntry", async () => {
    const h = await harness();
    const where = witness(h);
    await postJournalEntry(cashSale, h.deps);
    expect(where).toEqual(["inside"]);
  });

  it("postDraftJournalEntry", async () => {
    const h = await harness();
    await createJournalEntry(cashSale, h.deps);
    const where = witness(h);
    await postDraftJournalEntry("je-1", h.deps);
    expect(where).toEqual(["inside"]);
  });

  it("replaceDraftJournalEntry", async () => {
    const h = await harness();
    await createJournalEntry(cashSale, h.deps);
    const where = witness(h);
    await replaceDraftJournalEntry("je-1", { date: cashSale.date, memo: "edited", lines: cashSale.lines }, h.deps);
    expect(where).toEqual(["inside"]);
  });

  it("deleteDraftJournalEntry", async () => {
    const h = await harness();
    await createJournalEntry(cashSale, h.deps);
    const where = witness(h);
    await deleteDraftJournalEntry("je-1", h.deps);
    expect(where).toEqual(["inside"]);
  });
});
