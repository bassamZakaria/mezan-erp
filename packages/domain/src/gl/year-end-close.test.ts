import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { PeriodNotOpenForPostingError } from "../fiscal-periods/errors.js";
import { NextNumberService } from "../numbering/index.js";
import { postJournalEntry, type JournalPostingDeps } from "./post.js";
import { reverseJournalEntry } from "./reverse.js";
import {
  closeFiscalYear,
  planYearEndClose,
  YearAlreadyClosedError,
  NothingToCloseError,
  type CloseYearDeps,
} from "./year-end-close.js";
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

  await accounts.create(account("1300-1")); // cash
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit", nameAr: "إيرادات المبيعات" }));
  await accounts.create(account("5000", { type: "expense", naturalBalance: "debit", nameAr: "تكلفة البضاعة المباعة" }));
  await accounts.create(account("3900", { type: "equity", naturalBalance: "credit", nameAr: "الأرباح المرحلة" }));

  await periods.create({
    id: "fp-2026-06",
    year: 2026,
    periodNumber: 6,
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    status: "open",
  });
  await periods.create({
    id: "fp-2026-12",
    year: 2026,
    periodNumber: 12,
    startDate: "2026-12-01",
    endDate: "2026-12-31",
    status: "open",
  });

  const deps: CloseYearDeps = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    audit,
    events,
    now: () => "2026-12-31T12:00:00.000Z",
    actor: "u1",
  };
  return { deps, ledger, accounts, periods, audit, events };
}

async function postRevenueAndExpense(deps: JournalPostingDeps) {
  await postJournalEntry(
    {
      id: "je-rev",
      date: "2026-06-15",
      memo: "Sale",
      lines: [
        { accountId: "1300-1", debit: Money.fromMajor("10000"), credit: Money.zero() },
        { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("10000") },
      ],
    },
    deps,
  );
  await postJournalEntry(
    {
      id: "je-exp",
      date: "2026-06-16",
      memo: "COGS",
      lines: [
        { accountId: "5000", debit: Money.fromMajor("4000"), credit: Money.zero() },
        { accountId: "1300-1", debit: Money.zero(), credit: Money.fromMajor("4000") },
      ],
    },
    deps,
  );
}

describe("planYearEndClose", () => {
  it("computes the closing lines, net profit and totals without posting anything", async () => {
    const { deps, ledger } = await harness();
    await postRevenueAndExpense(deps);

    const plan = await planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, deps);

    expect(plan.year).toBe(2026);
    expect(plan.date).toBe("2026-12-31");
    expect(plan.entryId).toBe("YEAR-CLOSE:2026");
    expect(plan.revenueClosed.toString()).toBe("10000.000000");
    expect(plan.expensesClosed.toString()).toBe("4000.000000");
    expect(plan.netResult.toString()).toBe("6000.000000");
    expect(plan.lines).toHaveLength(2);

    const revenueLine = plan.lines.find((l) => l.accountId === "4000");
    expect(revenueLine?.debit.toString()).toBe("10000.000000");
    expect(revenueLine?.credit.toString()).toBe("0.000000");

    const expenseLine = plan.lines.find((l) => l.accountId === "5000");
    expect(expenseLine?.debit.toString()).toBe("0.000000");
    expect(expenseLine?.credit.toString()).toBe("4000.000000");

    // Nothing was posted.
    expect(await ledger.findById("YEAR-CLOSE:2026")).toBeNull();
  });

  it("excludes a P&L account with a zero balance", async () => {
    const { deps, accounts } = await harness();
    await accounts.create(account("4200", { type: "revenue", naturalBalance: "credit" })); // never posted to
    await postRevenueAndExpense(deps);

    const plan = await planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, deps);
    expect(plan.lines.some((l) => l.accountId === "4200")).toBe(false);
  });

  it("excludes a header P&L account even if the type matches", async () => {
    const { deps, accounts } = await harness();
    await accounts.create(account("4900", { type: "revenue", naturalBalance: "credit", isHeader: true }));
    await postRevenueAndExpense(deps);

    const plan = await planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, deps);
    expect(plan.lines.some((l) => l.accountId === "4900")).toBe(false);
  });

  it("closes a balance of exactly one micro-unit", async () => {
    const { deps } = await harness();
    await postJournalEntry(
      {
        id: "je-tiny",
        date: "2026-06-15",
        memo: "Tiny sale",
        lines: [
          { accountId: "1300-1", debit: Money.fromScaled(1n), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromScaled(1n) },
        ],
      },
      deps,
    );
    const plan = await planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, deps);
    expect(plan.revenueClosed.scaled).toBe(1n);
    expect(plan.lines[0]?.debit.scaled).toBe(1n);
  });

  it("throws NothingToCloseError when no P&L account has moved", async () => {
    const { deps } = await harness();
    await expect(planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, deps)).rejects.toBeInstanceOf(
      NothingToCloseError,
    );
  });

  it("throws YearAlreadyClosedError once the year's close entry already exists", async () => {
    const { deps } = await harness();
    await postRevenueAndExpense(deps);
    await closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps);
    await expect(planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, deps)).rejects.toBeInstanceOf(
      YearAlreadyClosedError,
    );
  });
});

describe("closeFiscalYear", () => {
  it("posts a balanced entry (Σdebit = Σcredit) that zeroes every P&L account and credits retained earnings with the profit", async () => {
    const { deps, ledger } = await harness();
    await postRevenueAndExpense(deps);

    const result = await closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps);

    expect(result.journalEntryId).toBe("YEAR-CLOSE:2026");
    expect(result.netResult.toString()).toBe("6000.000000");
    expect(result.revenueClosed.toString()).toBe("10000.000000");
    expect(result.expensesClosed.toString()).toBe("4000.000000");
    expect(result.accountsClosed).toBe(2);

    const entry = await ledger.findById("YEAR-CLOSE:2026");
    expect(entry?.status).toBe("posted");
    expect(entry?.date).toBe("2026-12-31");
    expect(entry?.memo).toContain("إقفال السنة المالية");

    const totalDebit = Money.sum(entry!.lines.map((l) => l.debit));
    const totalCredit = Money.sum(entry!.lines.map((l) => l.credit));
    expect(totalDebit.scaled).toBe(totalCredit.scaled);
    expect(totalDebit.toString()).toBe("10000.000000");

    expect((await ledger.accountBalance("4000", "2026-12-31")).balance.toString()).toBe("0.000000");
    expect((await ledger.accountBalance("5000", "2026-12-31")).balance.toString()).toBe("0.000000");
    expect((await ledger.accountBalance("3900", "2026-12-31")).balance.toString()).toBe("-6000.000000");
  });

  it("debits retained earnings when the year made a loss", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(
      {
        id: "je-rev",
        date: "2026-06-15",
        memo: "Sale",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("1000"), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("1000") },
        ],
      },
      deps,
    );
    await postJournalEntry(
      {
        id: "je-exp",
        date: "2026-06-16",
        memo: "Heavy cost",
        lines: [
          { accountId: "5000", debit: Money.fromMajor("4000"), credit: Money.zero() },
          { accountId: "1300-1", debit: Money.zero(), credit: Money.fromMajor("4000") },
        ],
      },
      deps,
    );

    const result = await closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps);
    expect(result.netResult.toString()).toBe("-3000.000000");

    const entry = await ledger.findById("YEAR-CLOSE:2026");
    const retainedLine = entry!.lines.find((l) => l.accountId === "3900");
    expect(retainedLine?.debit.toString()).toBe("3000.000000");
    expect(retainedLine?.credit.toString()).toBe("0.000000");

    const totalDebit = Money.sum(entry!.lines.map((l) => l.debit));
    const totalCredit = Money.sum(entry!.lines.map((l) => l.credit));
    expect(totalDebit.scaled).toBe(totalCredit.scaled);

    expect((await ledger.accountBalance("3900", "2026-12-31")).balance.toString()).toBe("3000.000000");
  });

  it("accepts a caller-supplied entry id and memo", async () => {
    const { deps, ledger } = await harness();
    await postRevenueAndExpense(deps);
    const result = await closeFiscalYear(
      { year: 2026, retainedEarningsAccountId: "3900", entryId: "custom-close-2026", memo: "إقفال مخصص" },
      deps,
    );
    expect(result.journalEntryId).toBe("custom-close-2026");
    expect(await ledger.findById("YEAR-CLOSE:2026")).toBeNull();
    const entry = await ledger.findById("custom-close-2026");
    expect(entry?.memo).toBe("إقفال مخصص");
  });

  it("refuses to close the same year twice", async () => {
    const { deps } = await harness();
    await postRevenueAndExpense(deps);
    await closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps);
    await expect(closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps)).rejects.toBeInstanceOf(
      YearAlreadyClosedError,
    );
  });

  it("refuses to close when nothing moved in the year's P&L accounts", async () => {
    const { deps } = await harness();
    await expect(closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps)).rejects.toBeInstanceOf(
      NothingToCloseError,
    );
  });

  it("refuses to post the closing entry into a locked/closed period (the period gate applies here too)", async () => {
    const { deps, periods } = await harness();
    await postRevenueAndExpense(deps);
    await periods.update({
      id: "fp-2026-12",
      year: 2026,
      periodNumber: 12,
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      status: "locked",
    });
    await expect(closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps)).rejects.toBeInstanceOf(
      PeriodNotOpenForPostingError,
    );
  });

  it("reversing the closing entry restores every P&L and retained-earnings balance, and the original stays immutable", async () => {
    const { deps, ledger } = await harness();
    await postRevenueAndExpense(deps);
    const result = await closeFiscalYear({ year: 2026, retainedEarningsAccountId: "3900" }, deps);

    const originalLines = (await ledger.findById(result.journalEntryId))!.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    }));

    const { original, reversal } = await reverseJournalEntry(result.journalEntryId, deps, {
      reversalId: "je-close-rev",
    });

    expect(original.status).toBe("reversed");
    // The original entry's own lines are untouched — only status/linkage changed.
    expect(original.lines.map((l) => ({ accountId: l.accountId, debit: l.debit.toString(), credit: l.credit.toString() }))).toEqual(
      originalLines,
    );

    const totalDebit = Money.sum(reversal.lines.map((l) => l.debit));
    const totalCredit = Money.sum(reversal.lines.map((l) => l.credit));
    expect(totalDebit.scaled).toBe(totalCredit.scaled);

    expect((await ledger.accountBalance("4000", "2026-12-31")).balance.toString()).toBe("-10000.000000");
    expect((await ledger.accountBalance("5000", "2026-12-31")).balance.toString()).toBe("4000.000000");
    expect((await ledger.accountBalance("3900", "2026-12-31")).balance.toString()).toBe("0.000000");
  });
});
