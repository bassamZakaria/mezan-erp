import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../money/index.js";
import { NextNumberService } from "../numbering/index.js";
import { postJournalEntry, type JournalPostingDeps } from "../gl/post.js";
import { planYearEndClose } from "../gl/year-end-close.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { runReport } from "../reports/engine.js";
import { createTrialBalanceReport } from "../reports/trial-balance.js";
import type { Account } from "./account.js";
import { InMemoryAccountRepository } from "./test-helpers/in-memory-account-repository.js";
import { updateAccount } from "./update-account.js";

/**
 * The chart of accounts against the ledger it already carries.
 *
 * updateAccount re-checks the HIERARCHY (parent exists, no cycle, a header with
 * children stays a header) and nothing about the postings the account is already
 * holding. Every check below runs the REAL posting engine into a real ledger and
 * then runs the REAL trial balance over the same two collections the report route
 * feeds it, so an edit that strands a posted balance surfaces the way the
 * accountant would meet it: mizan al-murajaa stops footing.
 */

interface Harness {
  accounts: InMemoryAccountRepository;
  ledger: InMemoryLedgerRepository;
  deps: JournalPostingDeps;
}

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

async function harness(): Promise<Harness> {
  const accounts = new InMemoryAccountRepository();
  const ledger = new InMemoryLedgerRepository();
  const periods = new InMemoryFiscalPeriodRepository();

  await accounts.create(account("1000", { isHeader: true }));
  await accounts.create(account("1300-1", { parentId: "1000" }));
  await accounts.create(account("1105", { parentId: "1000" }));
  // Posted to by nobody — the negative control for every "this edit stranded a
  // balance" claim below.
  await accounts.create(account("1360", { parentId: "1000" }));
  await accounts.create(account("2100", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("3900", { type: "equity", naturalBalance: "credit" }));
  await accounts.create(account("4100", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("5100", { type: "expense", naturalBalance: "debit" }));

  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, "0");
    const lastDay = month === 2 ? "28" : ["04", "06", "09", "11"].includes(mm) ? "30" : "31";
    await periods.create({
      id: `fp-2026-${mm}`,
      year: 2026,
      periodNumber: month,
      startDate: `2026-${mm}-01`,
      endDate: `2026-${mm}-${lastDay}`,
      status: "open",
    });
  }

  const deps: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => "2026-08-22T10:00:00.000Z",
  };
  return { accounts, ledger, deps };
}

/** Book the month, so every balance below opens NON-ZERO. */
async function bookTheMonth(deps: JournalPostingDeps): Promise<void> {
  await postJournalEntry(
    {
      id: "je-sale",
      date: "2026-08-05",
      memo: "فاتورة مبيعات آجلة",
      lines: [
        { accountId: "1105", debit: Money.fromMajor("8420.50"), credit: Money.zero() },
        { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("8420.50") },
      ],
    },
    deps,
  );
  await postJournalEntry(
    {
      id: "je-collect",
      date: "2026-08-11",
      memo: "تحصيل من عميل",
      lines: [
        { accountId: "1300-1", debit: Money.fromMajor("6200.25"), credit: Money.zero() },
        { accountId: "1105", debit: Money.zero(), credit: Money.fromMajor("6200.25") },
      ],
    },
    deps,
  );
  await postJournalEntry(
    {
      id: "je-rent",
      date: "2026-08-28",
      memo: "مصروف إيجار مستحق",
      lines: [
        { accountId: "5100", debit: Money.fromMajor("1750.00"), credit: Money.zero() },
        { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("1750.00") },
      ],
    },
    deps,
  );
}

async function trialBalance(h: Harness) {
  const outcome = runReport(
    createTrialBalanceReport("2026-12-31"),
    { asOfDate: "2026-12-31" },
    { accounts: await h.accounts.list(), journalEntries: await h.ledger.list() },
  );
  if (!outcome.ok) throw new Error("the trial balance failed to run");
  return outcome;
}

describe("the trial balance foots over the real posting engine, at non-zero balances", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await bookTheMonth(h.deps);
  });

  it("puts every account on the side its MOVEMENT put it on, not the side its type declares, and foots", async () => {
    const tb = await trialBalance(h);
    const byId = new Map(tb.rows.map((r) => [r.accountId, r]));

    expect(byId.get("1300-1")).toMatchObject({ debit: 6200.25, credit: 0 });
    expect(byId.get("1105")).toMatchObject({ debit: 2220.25, credit: 0 });
    expect(byId.get("5100")).toMatchObject({ debit: 1750, credit: 0 });
    expect(byId.get("2100")).toMatchObject({ debit: 0, credit: 1750 });
    expect(byId.get("4100")).toMatchObject({ debit: 0, credit: 8420.5 });

    expect(tb.grandTotals.debit).toBe(10170.5);
    expect(tb.grandTotals.credit).toBe(10170.5);
    expect(tb.reconciliation?.diff).toBe(0);
  });

  it("still foots when an ASSET carries a credit balance and a LIABILITY carries a debit one", async () => {
    // The supplier was overpaid out of a cash box that is now overdrawn. Both are
    // wrong-side balances a real month produces, and the trial balance must still
    // add up across them.
    await postJournalEntry(
      {
        id: "je-overpay",
        date: "2026-08-29",
        memo: "دفعة زائدة لمورد",
        lines: [
          { accountId: "2100", debit: Money.fromMajor("9000.00"), credit: Money.zero() },
          { accountId: "1300-1", debit: Money.zero(), credit: Money.fromMajor("9000.00") },
        ],
      },
      h.deps,
    );

    const tb = await trialBalance(h);
    const byId = new Map(tb.rows.map((r) => [r.accountId, r]));
    expect(byId.get("2100")).toMatchObject({ debit: 7250, credit: 0 });
    expect(byId.get("1300-1")).toMatchObject({ debit: 0, credit: 2799.75 });
    expect(tb.grandTotals.debit).toBe(11220.25);
    expect(tb.grandTotals.credit).toBe(11220.25);
    expect(tb.reconciliation?.diff).toBe(0);
  });

  it("moves by EXACTLY one posting, on exactly the two accounts that posting named", async () => {
    const before = await trialBalance(h);
    const beforeById = new Map(before.rows.map((r) => [r.accountId, r]));

    await postJournalEntry(
      {
        id: "je-second-sale",
        date: "2026-08-30",
        memo: "فاتورة مبيعات ثانية",
        lines: [
          { accountId: "1105", debit: Money.fromMajor("1234.56"), credit: Money.zero() },
          { accountId: "4100", debit: Money.zero(), credit: Money.fromMajor("1234.56") },
        ],
      },
      h.deps,
    );

    const after = await trialBalance(h);
    const afterById = new Map(after.rows.map((r) => [r.accountId, r]));
    expect(after.grandTotals.debit).toBe(11405.06);
    expect(after.grandTotals.credit).toBe(11405.06);
    expect(afterById.get("1105")).toMatchObject({ debit: 3454.81, credit: 0 });
    expect(afterById.get("4100")).toMatchObject({ debit: 0, credit: 9655.06 });

    // Footing alone proves nothing: a posting that also touched a third account
    // would still leave the report balanced. Every other row must be untouched.
    for (const id of ["1300-1", "2100", "5100", "3900", "1360"]) {
      expect(afterById.get(id)).toMatchObject({ debit: beforeById.get(id)!.debit, credit: beforeById.get(id)!.credit });
    }
    expect(after.reconciliation?.diff).toBe(0);
  });
});


/**
 * The guard these three used to document as a LIMITATION. `updateAccount` now
 * takes the GL ledger and refuses the two edits that rewrite the meaning of
 * postings already made — the fix that closed the finding this file opened.
 */
describe("an account that has been posted to is protected from the edits that would strand its balance", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await bookTheMonth(h.deps);
  });

  it("refuses to flip a POSTED-TO detail account into a header, writes nothing, and leaves the trial balance footing", async () => {
    await expect(updateAccount("1300-1", { isHeader: true }, h.accounts, h.ledger)).rejects.toMatchObject({
      code: "ACCOUNT_HAS_POSTINGS",
      accountId: "1300-1",
    });

    // A refusal that still wrote the row would be the same hole with a 422 on it.
    expect((await h.accounts.findById("1300-1"))?.isHeader).toBe(false);
    const after = await trialBalance(h);
    expect(after.rows.find((r) => r.accountId === "1300-1")).toMatchObject({ debit: 6200.25, credit: 0 });
    expect(after.grandTotals.debit).toBe(10170.5);
    expect(after.grandTotals.credit).toBe(10170.5);
    expect(after.reconciliation?.diff).toBe(0);
  });

  it("refuses to re-TYPE a posted-to revenue account, so the year-end close still carries the real result", async () => {
    const closeDeps = { ...h.deps, accounts: h.accounts };
    const before = await planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, closeDeps);
    expect(before.revenueClosed.toString()).toBe("8420.500000");
    expect(before.expensesClosed.toString()).toBe("1750.000000");
    expect(before.netResult.toString()).toBe("6670.500000");

    await expect(
      updateAccount("4100", { type: "asset", naturalBalance: "debit" }, h.accounts, h.ledger),
    ).rejects.toMatchObject({ code: "ACCOUNT_HAS_POSTINGS", accountId: "4100" });

    expect((await h.accounts.findById("4100"))?.type).toBe("revenue");
    const after = await planYearEndClose({ year: 2026, retainedEarningsAccountId: "3900" }, closeDeps);
    expect(after.lines.map((l) => l.accountId).sort()).toEqual(["4100", "5100"]);
    expect(after.netResult.toString()).toBe("6670.500000");
  });

  it("negative control: an account with NO postings can still be made a header and re-typed", async () => {
    const header = await updateAccount("1360", { isHeader: true }, h.accounts, h.ledger);
    expect(header.isHeader).toBe(true);
    const retyped = await updateAccount("1360", { type: "expense" }, h.accounts, h.ledger);
    expect(retyped.type).toBe("expense");

    const after = await trialBalance(h);
    expect(after.grandTotals.debit).toBe(10170.5);
    expect(after.reconciliation?.diff).toBe(0);
  });

  it("negative control: the edits that do NOT change what a posted line means are still allowed on a posted-to account", async () => {
    const renamed = await updateAccount("1300-1", { nameAr: "صندوق الفرع الرئيسي" }, h.accounts, h.ledger);
    expect(renamed.nameAr).toBe("صندوق الفرع الرئيسي");
    const deactivated = await updateAccount("1300-1", { status: "inactive" }, h.accounts, h.ledger);
    expect(deactivated.status).toBe("inactive");
    const reparented = await updateAccount("1105", { parentId: null }, h.accounts, h.ledger);
    expect(reparented.parentId).toBeNull();

    const after = await trialBalance(h);
    expect(after.rows.find((r) => r.accountId === "1300-1")).toMatchObject({ debit: 6200.25, credit: 0 });
    expect(after.reconciliation?.diff).toBe(0);
  });

  it("without a ledger port the guard cannot fire — so the port must stay wired, and this pins the difference", async () => {
    // Documented on purpose: `updateAccount(id, cmd, repo)` with no ledger is the
    // old, unguarded call. Every production caller passes one (app.ts hands the
    // accounts router `options.gl?.ledger`); a future caller that forgets will
    // silently lose the protection, which is exactly what this asserts.
    const flipped = await updateAccount("1300-1", { isHeader: true }, h.accounts);
    expect(flipped.isHeader).toBe(true);
    expect((await trialBalance(h)).reconciliation?.diff).toBe(-6200.25);
  });
});
