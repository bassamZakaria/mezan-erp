import { describe, it, expect, afterEach } from "vitest";
import { Money, postJournalEntry, type Account, type JournalPostingDeps } from "@mezan/domain";
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

async function post(deps: JournalPostingDeps, id: string, date: string, memo: string, lineMemo?: string) {
  return postJournalEntry(
    {
      id,
      date,
      memo,
      lines: [
        { accountId: "1300-1", debit: Money.fromMajor("100.00"), credit: Money.zero(), memo: lineMemo },
        { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("100.00") },
      ],
    },
    deps,
  );
}

describe("SqliteLedgerStore — the account ledger a reconciliation picker reads", () => {
  it("falls back to the entry's own memo when the line carries none", async () => {
    const { deps, ledger } = await harness();
    await post(deps, "je-1", "2026-08-22", "سند قبض من عميل");

    const lines = await ledger.accountLedger("1300-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.memo).toBe("سند قبض من عميل");
  });

  it("prefers the line's own memo when it has one", async () => {
    const { deps, ledger } = await harness();
    await post(deps, "je-1", "2026-08-22", "سند قبض من عميل", "دفعة أولى");

    const lines = await ledger.accountLedger("1300-1");
    expect(lines[0]!.memo).toBe("دفعة أولى");
  });

  it("bounds the ledger at an as-of date, and reports everything without one", async () => {
    const { deps, ledger } = await harness();
    await post(deps, "je-1", "2026-08-22", "أول");
    await post(deps, "je-2", "2026-09-10", "ثانٍ");

    expect(await ledger.accountLedger("1300-1")).toHaveLength(2);
    expect(await ledger.accountLedger("1300-1", "2026-08-31")).toHaveLength(1);
    expect(await ledger.accountLedger("1300-1", "2026-01-01")).toEqual([]);
  });

  it("reports nothing for an account nothing has ever posted to", async () => {
    const { ledger } = await harness();
    expect(await ledger.accountLedger("9999")).toEqual([]);
  });
});

describe("SqliteLedgerStore — the posted-line reader the reports run on", () => {
  it("bounds the lines by each date end independently", async () => {
    const { deps, ledger } = await harness();
    await post(deps, "je-1", "2026-08-22", "أغسطس");
    await post(deps, "je-2", "2026-09-10", "سبتمبر");

    expect(await ledger.listLines!()).toHaveLength(4);
    expect(await ledger.listLines!({ fromDate: "2026-09-01" })).toHaveLength(2);
    expect(await ledger.listLines!({ toDate: "2026-08-31" })).toHaveLength(2);
    expect(await ledger.listLines!({ fromDate: "2026-08-01", toDate: "2026-08-31" })).toHaveLength(2);
  });

  it("narrows to the accounts asked for, and to none when the list is empty", async () => {
    const { deps, ledger } = await harness();
    await post(deps, "je-1", "2026-08-22", "قيد");

    expect(await ledger.listLines!({ accountIds: ["1300-1"] })).toHaveLength(1);
    expect(await ledger.listLines!({ accountIds: ["1300-1", "4000"] })).toHaveLength(2);
    expect(await ledger.listLines!({ accountIds: [] })).toHaveLength(2);
  });
});

describe("SqliteLedgerStore — an entry that has not been posted yet", () => {
  it("keeps a draft's number, posting time and reversal pointer null", async () => {
    const { ledger } = await harness();
    await ledger.save({
      id: "je-draft",
      entryNo: null,
      date: "2026-08-22",
      memo: "مسودة",
      status: "draft",
      source: "manual",
      createdAt: "2026-08-22T10:00:00.000Z",
      postedAt: null,
      reversesEntryId: null,
      reversedByEntryId: null,
      sourceDocType: null,
      sourceDocId: null,
      sourceDocNumber: null,
      lines: [
        { accountId: "1300-1", debit: Money.fromMajor("10.00"), credit: Money.zero(), memo: null },
        { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("10.00"), memo: null },
      ],
    });

    const fetched = await ledger.findById("je-draft");
    expect(fetched?.entryNo).toBeNull();
    expect(fetched?.postedAt).toBeNull();
    expect(fetched?.reversedByEntryId).toBeNull();
    expect(fetched?.status).toBe("draft");
  });

  it("returns null for an entry that was never saved, by id and by number", async () => {
    const { ledger } = await harness();
    expect(await ledger.findById("nope")).toBeNull();
    expect(await ledger.findByEntryNo("JE-999999")).toBeNull();
  });

  it("leaves a draft out of the account balance until it is posted", async () => {
    const { deps, ledger } = await harness();
    await ledger.save({
      id: "je-draft",
      entryNo: null,
      date: "2026-08-22",
      memo: "مسودة",
      status: "draft",
      source: "manual",
      createdAt: "2026-08-22T10:00:00.000Z",
      postedAt: null,
      reversesEntryId: null,
      reversedByEntryId: null,
      sourceDocType: null,
      sourceDocId: null,
      sourceDocNumber: null,
      lines: [
        { accountId: "1300-1", debit: Money.fromMajor("999.00"), credit: Money.zero(), memo: null },
        { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("999.00"), memo: null },
      ],
    });
    await post(deps, "je-1", "2026-08-22", "قيد مرحّل");

    const balance = await ledger.accountBalance("1300-1");
    expect(balance.debit.toString()).toBe("100.000000");
  });
});
