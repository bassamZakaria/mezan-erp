import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { createJournalEntry, postJournalEntry, type JournalPostingDeps } from "./post.js";
import { reverseJournalEntry } from "./reverse.js";
import { PeriodNotOpenForPostingError } from "../fiscal-periods/errors.js";
import { VatPeriodAlreadyFiledError } from "../tax/vat-filing.js";
import {
  JournalEntryAlreadyReversedError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
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

async function harness() {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  const audit = new RecordingAuditSink();
  const events = new RecordingGlEventPublisher();
  await accounts.create(account("1300-1"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  for (const [n, status] of [
    [8, "open"],
    [9, "open"],
  ] as const) {
    await periods.create({
      id: `fp-2026-0${n}`,
      year: 2026,
      periodNumber: n,
      startDate: `2026-0${n}-01`,
      endDate: `2026-0${n}-30`,
      status,
    });
  }
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

const entryCmd = {
  id: "je-1",
  date: "2026-08-22",
  memo: "Cash sale",
  lines: [
    { accountId: "1300-1", debit: Money.fromMajor("500"), credit: Money.zero() },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("500") },
  ],
};

describe("reverseJournalEntry", () => {
  it("posts a mirror-image reversing entry and links both directions", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(entryCmd, deps);

    const { original, reversal } = await reverseJournalEntry("je-1", deps, {
      reversalId: "je-1-rev",
    });

    expect(original.status).toBe("reversed");
    expect(original.reversedByEntryId).toBe("je-1-rev");
    expect(reversal.status).toBe("posted");
    expect(reversal.source).toBe("system");
    expect(reversal.entryNo).toBe("JE-000002");
    expect(reversal.reversesEntryId).toBe("je-1");
    // Debit/credit swapped on every line.
    expect(reversal.lines[0]).toMatchObject({ accountId: "1300-1" });
    expect(reversal.lines[0]?.debit.toString()).toBe("0.000000");
    expect(reversal.lines[0]?.credit.toString()).toBe("500.000000");

    // Persisted state reflects the reversal.
    expect((await ledger.findById("je-1"))?.status).toBe("reversed");
  });

  it("nets the account balance back to zero after reversal", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(entryCmd, deps);

    const before = await ledger.accountBalance("1300-1");
    expect(before.balance.toString()).toBe("500.000000");

    await reverseJournalEntry("je-1", deps, { reversalId: "je-1-rev" });
    const after = await ledger.accountBalance("1300-1");
    expect(after.balance.toString()).toBe("0.000000");
  });

  it("records a WARNING audit event and publishes JOURNAL_ENTRY_REVERSED", async () => {
    const { deps, audit, events } = await harness();
    await postJournalEntry(entryCmd, deps);
    audit.events.length = 0;
    events.events.length = 0;

    await reverseJournalEntry("je-1", deps, { reversalId: "je-1-rev" });
    expect(audit.events[0]).toMatchObject({
      action: "REVERSE",
      severity: "WARNING",
      module: "accounting",
    });
    expect(events.events[0]).toMatchObject({
      type: "JOURNAL_ENTRY_REVERSED",
      reversesEntryId: "je-1",
    });
  });

  it("reverses into a different (open) period when a date is supplied", async () => {
    const { deps } = await harness();
    await postJournalEntry(entryCmd, deps);
    const { reversal } = await reverseJournalEntry("je-1", deps, {
      reversalId: "je-1-rev",
      date: "2026-09-01",
    });
    expect(reversal.date).toBe("2026-09-01");
  });

  it("refuses to reverse into a closed period", async () => {
    const { deps, periods } = await harness();
    await postJournalEntry(entryCmd, deps);
    await periods.update({
      id: "fp-2026-09",
      year: 2026,
      periodNumber: 9,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      status: "closed",
    });
    await expect(
      reverseJournalEntry("je-1", deps, { reversalId: "je-1-rev", date: "2026-09-15" }),
    ).rejects.toBeInstanceOf(PeriodNotOpenForPostingError);
  });

  it("refuses to reverse an unknown entry", async () => {
    const { deps } = await harness();
    await expect(
      reverseJournalEntry("nope", deps, { reversalId: "x" }),
    ).rejects.toBeInstanceOf(JournalEntryNotFoundError);
  });

  it("refuses to reverse a draft (only posted entries can be reversed)", async () => {
    const { deps } = await harness();
    await createJournalEntry(entryCmd, deps);
    await expect(
      reverseJournalEntry("je-1", deps, { reversalId: "je-1-rev" }),
    ).rejects.toBeInstanceOf(JournalEntryNotPostedError);
  });

  it("refuses to reverse the same entry twice (append-only)", async () => {
    const { deps } = await harness();
    await postJournalEntry(entryCmd, deps);
    await reverseJournalEntry("je-1", deps, { reversalId: "je-1-rev" });
    await expect(
      reverseJournalEntry("je-1", deps, { reversalId: "je-1-rev-2" }),
    ).rejects.toBeInstanceOf(JournalEntryAlreadyReversedError);
  });
});

describe("reverseJournalEntry — every dimension travels with the mirror", () => {
  const dimensioned = {
    id: "je-dim",
    date: "2026-08-22",
    memo: "بيع بالدولار على مركز تكلفة",
    lines: [
      {
        accountId: "1300-1",
        debit: Money.fromMajor("485.00"),
        credit: Money.zero(),
        costCenterId: "cc-cairo",
        currency: "USD",
        fxRate: "48.500000",
        taxRatePercent: 14,
        memo: "سطر مدين",
      },
      {
        accountId: "4000",
        debit: Money.zero(),
        credit: Money.fromMajor("485.00"),
        costCenterId: "cc-cairo",
        currency: "USD",
        fxRate: "48.500000",
        taxRatePercent: 14,
        memo: "سطر دائن",
      },
    ],
  };

  it("carries the cost centre, the currency and its rate, and the tax rate onto the reversing line", async () => {
    const { deps } = await harness();
    await postJournalEntry(dimensioned, deps);

    const { reversal } = await reverseJournalEntry("je-dim", deps, { reversalId: "je-dim-rev" });

    // The mirror's own docstring promises this: a reversal that keeps only the
    // account and the amount un-tags itself, and the cost-centre P&L, the VAT
    // return and FX revaluation all stop seeing it.
    for (const [index, line] of reversal.lines.entries()) {
      const source = dimensioned.lines[index] as (typeof dimensioned.lines)[number];
      expect(line.costCenterId).toBe(source.costCenterId);
      expect(line.currency).toBe(source.currency);
      expect(line.fxRate).toBe(source.fxRate);
      expect(line.taxRatePercent).toBe(source.taxRatePercent);
      expect(line.accountId).toBe(source.accountId);
      expect(line.memo).toBe(source.memo);
    }
  });

  it("swaps the two sides exactly, and nothing else", async () => {
    const { deps } = await harness();
    await postJournalEntry(dimensioned, deps);

    const { reversal } = await reverseJournalEntry("je-dim", deps, { reversalId: "je-dim-rev" });

    for (const [index, line] of reversal.lines.entries()) {
      const source = dimensioned.lines[index] as (typeof dimensioned.lines)[number];
      expect(line.debit.scaled).toBe(source.credit.scaled);
      expect(line.credit.scaled).toBe(source.debit.scaled);
    }
  });

  it("nets the position to zero once both entries are posted", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(dimensioned, deps);
    await reverseJournalEntry("je-dim", deps, { reversalId: "je-dim-rev" });

    for (const accountId of ["1300-1", "4000"]) {
      const balance = await ledger.accountBalance(accountId);
      expect(balance.debit.scaled).toBe(balance.credit.scaled);
    }
  });
});

/**
 * guards B-11 — posting checks the filed-VAT lock (post.ts) and reversing did
 * not, so a filed return could be restated by a reversal dated into it.
 */
describe("reverseJournalEntry — the filed-VAT lock", () => {
  function filings(status: "filed" | "amended") {
    return {
      async findCovering(date: string) {
        return date >= "2026-08-01" && date <= "2026-08-31" ? [{ id: "vat-2026-08", status }] : [];
      },
    };
  }

  const august = {
    id: "je-aug",
    date: "2026-08-22",
    memo: "بيع نقدي",
    lines: [
      { accountId: "1300-1", debit: Money.fromMajor("100.00"), credit: Money.zero() },
      { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("100.00") },
    ],
  };

  it("refuses a reversal dated into a period whose VAT return is filed, and writes nothing", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(august, deps);
    const before = (await ledger.list()).length;

    await expect(
      reverseJournalEntry("je-aug", { ...deps, vatFilings: filings("filed") }, { reversalId: "je-aug-rev" }),
    ).rejects.toBeInstanceOf(VatPeriodAlreadyFiledError);

    expect((await ledger.list()).length).toBe(before);
    expect((await ledger.findById("je-aug"))!.status).toBe("posted");
    expect(await ledger.findById("je-aug-rev")).toBeNull();
  });

  it("allows the reversal once the filing has been amended", async () => {
    const { deps } = await harness();
    await postJournalEntry(august, deps);
    const { reversal } = await reverseJournalEntry(
      "je-aug",
      { ...deps, vatFilings: filings("amended") },
      { reversalId: "je-aug-rev" },
    );
    expect(reversal.status).toBe("posted");
  });

  it("allows a reversal dated OUT of the filed window — September, on an August entry", async () => {
    const { deps } = await harness();
    await postJournalEntry(august, deps);
    const { reversal } = await reverseJournalEntry(
      "je-aug",
      { ...deps, vatFilings: filings("filed") },
      { reversalId: "je-aug-rev", date: "2026-09-01" },
    );
    expect(reversal.date).toBe("2026-09-01");
  });
});
