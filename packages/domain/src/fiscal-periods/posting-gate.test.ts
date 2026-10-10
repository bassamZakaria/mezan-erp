import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "./test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { postJournalEntry, type JournalPostingDeps } from "../gl/post.js";
import { assertOpenForPosting } from "./transitions.js";
import { closePeriod, lockPeriod } from "./transitions.js";
import { PeriodNotOpenForPostingError, NoFiscalPeriodForDateError } from "./errors.js";
import type { FiscalPeriodStatus } from "./fiscal-period.js";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

async function harness(periodStatus: FiscalPeriodStatus) {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  await accounts.create(account("1300-1"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: periodStatus });
  const deps: JournalPostingDeps = {
    ledger, accounts, periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => "2026-08-22T10:00:00.000Z",
  };
  return { deps, periods };
}

const entry = {
  id: "je-1",
  date: "2026-08-22",
  memo: "test",
  lines: [
    { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("100") },
  ],
};

describe("fiscal-period posting gate", () => {
  it("assertOpenForPosting allows an open period and blocks closed/locked ones", () => {
    expect(() => assertOpenForPosting({ id: "p", year: 2026, periodNumber: 8, status: "open" })).not.toThrow();
    expect(() => assertOpenForPosting({ id: "p", year: 2026, periodNumber: 8, status: "closed" })).toThrow(PeriodNotOpenForPostingError);
    expect(() => assertOpenForPosting({ id: "p", year: 2026, periodNumber: 8, status: "locked" })).toThrow(PeriodNotOpenForPostingError);
  });

  it("posts into an open period", async () => {
    const { deps } = await harness("open");
    const posted = await postJournalEntry(entry, deps);
    expect(posted.status).toBe("posted");
  });

  it("blocks posting once the period is closed (the UI close action enforces this)", async () => {
    const { deps, periods } = await harness("open");
    await periods.update(closePeriod((await periods.findById("fp-08"))!));
    await expect(postJournalEntry(entry, deps)).rejects.toThrow(PeriodNotOpenForPostingError);
  });

  it("blocks posting once the period is locked", async () => {
    const { deps, periods } = await harness("open");
    await periods.update(lockPeriod(closePeriod((await periods.findById("fp-08"))!)));
    await expect(postJournalEntry(entry, deps)).rejects.toThrow(PeriodNotOpenForPostingError);
  });

  it("rejects a date that falls in no fiscal period", async () => {
    const { deps } = await harness("open");
    await expect(postJournalEntry({ ...entry, date: "2027-01-15" }, deps)).rejects.toThrow(NoFiscalPeriodForDateError);
  });
});
