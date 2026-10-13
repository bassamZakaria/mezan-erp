import { describe, it, expect, afterEach } from "vitest";
import {
  Money,
  DuplicateRecordIdError,
  postJournalEntry,
  reverseJournalEntry,
  netBalancesByAccount,
  type Account,
  type JournalPostingDeps,
} from "@mezan/domain";
import { createSqliteLedgerStore, type SqliteLedgerStoreHandle } from "./ledger-store.js";
import { createSqliteAccountRepository, type SqliteAccountRepositoryHandle } from "./account-repository.js";
import { createSqliteFiscalPeriodRepository, type SqliteFiscalPeriodRepositoryHandle } from "./fiscal-period-repository.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
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

async function harness() {
  const ledger = createSqliteLedgerStore() as SqliteLedgerStoreHandle;
  const accounts = createSqliteAccountRepository() as SqliteAccountRepositoryHandle;
  const periods = createSqliteFiscalPeriodRepository() as SqliteFiscalPeriodRepositoryHandle;
  closers.push(ledger, accounts, periods);

  await accounts.create(account("1300-1"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("2200", { type: "liability", naturalBalance: "credit" }));
  for (const n of [8, 9]) {
    await periods.create({
      id: `fp-2026-0${n}`,
      year: 2026,
      periodNumber: n,
      startDate: `2026-0${n}-01`,
      endDate: `2026-0${n}-30`,
      status: "open",
    });
  }

  const deps: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    now: () => "2026-08-22T10:00:00.000Z",
    actor: "u1",
  };
  return { deps, ledger };
}

describe("SqliteLedgerStore — golden fixture: a multi-line entry reconciles exactly", () => {
  it("posts a 3-line cash sale; every account balance and the trial balance are exact to the minor unit", async () => {
    const { deps, ledger } = await harness();

    const posted = await postJournalEntry(
      {
        id: "je-1",
        date: "2026-08-22",
        memo: "Cash sale",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("1150.75"), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("1009.43") },
          { accountId: "2200", debit: Money.zero(), credit: Money.fromMajor("141.32") },
        ],
      },
      deps,
    );
    expect(posted.entryNo).toBe("JE-000001");

    const cash = await ledger.accountBalance("1300-1");
    const revenue = await ledger.accountBalance("4000");
    const vat = await ledger.accountBalance("2200");

    expect(cash.debit.toString()).toBe("1150.750000");
    expect(cash.balance.toString()).toBe("1150.750000");
    expect(revenue.credit.toString()).toBe("1009.430000");
    expect(revenue.balance.toString()).toBe("-1009.430000");
    expect(vat.credit.toString()).toBe("141.320000");
    expect(vat.balance.toString()).toBe("-141.320000");

    // Trial balance: the three net balances sum to exactly zero.
    const trialBalance = Money.sum([cash.balance, revenue.balance, vat.balance]);
    expect(trialBalance.toString()).toBe("0.000000");

    // The account ledger for cash shows exactly the one movement.
    const ledgerLines = await ledger.accountLedger("1300-1");
    expect(ledgerLines).toHaveLength(1);
    expect(ledgerLines[0]).toMatchObject({ entryNo: "JE-000001", debit: expect.anything() });
    expect(ledgerLines[0]?.debit.toString()).toBe("1150.750000");
  });
});

describe("SqliteLedgerStore — an id that is already an entry", () => {
  it("save answers the domain's duplicate refusal, never the storage engine's own error", async () => {
    const { deps, ledger } = await harness();
    const posted = await postJournalEntry(
      {
        id: "je-dup",
        date: "2026-08-10",
        memo: "قيد",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("10"), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("10") },
        ],
      },
      deps,
    );
    const again = ledger.save({ ...posted, entryNo: null, memo: "نسخة" });
    await expect(again).rejects.toBeInstanceOf(DuplicateRecordIdError);
    await expect(again).rejects.toMatchObject({ recordId: "je-dup" });
    expect((await ledger.findById("je-dup"))?.memo).toBe("قيد");
  });
});

describe("SqliteLedgerStore — numbering, reversal, persistence", () => {
  it("allocates gap-free JE numbers across posts", async () => {
    const { deps } = await harness();
    const nos: string[] = [];
    for (const id of ["a", "b", "c"]) {
      const e = await postJournalEntry(
        {
          id,
          date: "2026-08-10",
          memo: id,
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("10"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("10") },
          ],
        },
        deps,
      );
      nos.push(e.entryNo ?? "");
    }
    expect(nos).toEqual(["JE-000001", "JE-000002", "JE-000003"]);
  });

  it("reverses a posted entry and nets the account balances to zero", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(
      {
        id: "je-1",
        date: "2026-08-22",
        memo: "Cash sale",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("500"), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("500") },
        ],
      },
      deps,
    );

    const { original, reversal } = await reverseJournalEntry("je-1", deps, { reversalId: "je-1-rev" });
    expect(original.status).toBe("reversed");
    expect(original.reversedByEntryId).toBe("je-1-rev");
    expect(reversal.entryNo).toBe("JE-000002");

    expect((await ledger.accountBalance("1300-1")).balance.toString()).toBe("0.000000");
    expect((await ledger.accountBalance("4000")).balance.toString()).toBe("0.000000");
    expect((await ledger.findById("je-1"))?.status).toBe("reversed");
  });

  it("honours an as-of date when summing balances", async () => {
    const { deps, ledger } = await harness();
    for (const [id, date] of [["aug", "2026-08-15"], ["sep", "2026-09-15"]] as const) {
      await postJournalEntry(
        {
          id,
          date,
          memo: id,
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("100") },
          ],
        },
        deps,
      );
    }
    expect((await ledger.accountBalance("1300-1", "2026-08-31")).balance.toString()).toBe("100.000000");
    expect((await ledger.accountBalance("1300-1")).balance.toString()).toBe("200.000000");
  });

  it("stores money as safe integers — a sum beyond 2^53 stays exact (BigInt path)", async () => {
    const { deps, ledger } = await harness();
    // Two entries of 9,000,000,000 each → scaled 9e15 (safe to insert);
    // their SUM is 1.8e16, past Number.MAX_SAFE_INTEGER (~9.007e15).
    for (const id of ["big-1", "big-2"]) {
      await postJournalEntry(
        {
          id,
          date: "2026-08-10",
          memo: id,
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor("9000000000"), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("9000000000") },
          ],
        },
        deps,
      );
    }
    expect((await ledger.accountBalance("1300-1")).debit.toString()).toBe("18000000000.000000");
  });

  it("persists and re-hydrates the full entry shape", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(
      {
        id: "je-1",
        date: "2026-08-22",
        memo: "Cash sale",
        source: "system",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("500"), credit: Money.zero(), memo: "cash in" },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("500") },
        ],
      },
      deps,
    );
    const fetched = await ledger.findByEntryNo("JE-000001");
    expect(fetched).not.toBeNull();
    expect(fetched?.source).toBe("system");
    expect(fetched?.status).toBe("posted");
    expect(fetched?.lines[0]?.memo).toBe("cash in");
    expect(fetched?.lines[0]?.debit.toString()).toBe("500.000000");
  });
});

/**
 * Q-6: the trial balance and the by-item reconciliations used to fold every
 * posted line in JS. These aggregates replace that fold and must answer
 * EXACTLY what the fold answered — `netBalancesByAccount` is the reference.
 */
describe("SqliteLedgerStore — SQL aggregates equal the JS fold (guards Q-6)", () => {
  async function seeded() {
    const { deps, ledger } = await harness();
    const post = (id: string, date: string, cash: string, sourceDocType: string | null) =>
      postJournalEntry(
        {
          id,
          date,
          memo: id,
          ...(sourceDocType ? { sourceDocType, sourceDocId: id } : {}),
          lines: [
            { accountId: "1300-1", debit: Money.fromMajor(cash), credit: Money.zero() },
            { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor(cash) },
          ],
        },
        deps,
      );
    await post("je-a", "2026-08-05", "1150.75", "SALES_INVOICE");
    await post("je-b", "2026-08-20", "0.01", "SALES_INVOICE");
    await post("je-c", "2026-09-02", "999.99", "PURCHASE_INVOICE");
    const reversible = await post("je-d", "2026-08-25", "42.50", null);
    await reverseJournalEntry(reversible.id, deps, { reversalId: "je-d-rev" });
    return { ledger, deps };
  }

  it("accountBalances matches netBalancesByAccount over the same slice", async () => {
    const { ledger } = await seeded();
    for (const toDate of [undefined, "2026-08-21", "2026-08-31", "2026-12-31"]) {
      const entries = [...(await ledger.list({ status: "posted" })), ...(await ledger.list({ status: "reversed" }))];
      const expected = netBalancesByAccount(entries, toDate ? { to: toDate } : {});
      const actual = await ledger.accountBalances!(toDate ? { toDate } : {});
      // A zero-net account is present in the fold and in the aggregate alike;
      // compare the maps entry for entry rather than trusting the key sets.
      const keys = new Set([...expected.keys(), ...actual.keys()]);
      for (const key of keys) {
        expect(actual.get(key)?.toString() ?? "0.000000", `${key} @ ${toDate ?? "all"}`).toBe(
          expected.get(key)?.toString() ?? "0.000000",
        );
      }
    }
  });

  it("sumLines is GROSS debit and credit, restricted by date, account and source document type", async () => {
    const { ledger } = await seeded();
    const fold = async (opts: { from: string; to: string; docTypes?: readonly string[] }) => {
      let debit = Money.zero();
      let credit = Money.zero();
      for (const entry of await ledger.list({ status: "posted" })) {
        if (entry.date < opts.from || entry.date > opts.to) continue;
        if (opts.docTypes && !opts.docTypes.includes(entry.sourceDocType ?? "")) continue;
        for (const line of entry.lines) {
          if (line.accountId !== "4000") continue;
          debit = debit.add(line.debit);
          credit = credit.add(line.credit);
        }
      }
      return { debit: debit.toString(), credit: credit.toString() };
    };

    for (const opts of [
      { from: "2026-01-01", to: "2026-12-31" },
      { from: "2026-08-01", to: "2026-08-31" },
      { from: "2026-01-01", to: "2026-12-31", docTypes: ["SALES_INVOICE"] as const },
      { from: "2026-01-01", to: "2026-12-31", docTypes: ["NOTHING_POSTS_THIS"] as const },
    ]) {
      const sums = await ledger.sumLines!({
        statuses: ["posted"],
        fromDate: opts.from,
        toDate: opts.to,
        accountIds: ["4000"],
        ...(opts.docTypes ? { sourceDocTypes: opts.docTypes } : {}),
      });
      expect({ debit: sums.debit.toString(), credit: sums.credit.toString() }).toEqual(await fold(opts));
    }
  });

  it("an empty account or status set matches nothing rather than everything", async () => {
    const { ledger } = await seeded();
    expect((await ledger.accountBalances!({ accountIds: [] })).size).toBe(0);
    expect((await ledger.accountBalances!({ statuses: [] })).size).toBe(0);
    const sums = await ledger.sumLines!({ accountIds: [] });
    expect(sums.debit.toString()).toBe("0.000000");
  });
});
