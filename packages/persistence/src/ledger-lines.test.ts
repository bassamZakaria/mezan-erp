import { describe, it, expect, afterEach } from "vitest";
import { Money, postJournalEntry, type Account, type JournalPostingDeps } from "@mezan/domain";
import { createSqliteLedgerStore, type SqliteLedgerStoreHandle } from "./ledger-store.js";
import { createSqliteAccountRepository } from "./account-repository.js";
import { createSqliteFiscalPeriodRepository } from "./fiscal-period-repository.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

async function harness() {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(ledger, accounts, periods);
  await accounts.create(account("1300-1"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("5000", { type: "expense", naturalBalance: "debit" }));
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  const deps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" };
  return { deps, ledger };
}

describe("SqliteLedgerStore.listLines — dimensional query", () => {
  it("persists and reads back cost-center and currency dimensions on posted lines", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(
      {
        id: "je-1", date: "2026-08-10", memo: "sale", source: "system",
        lines: [
          { accountId: "1300-1", debit: Money.fromMajor("1000"), credit: Money.zero(), currency: "USD", fxRate: "50" },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("1000"), costCenterId: "cc-a" },
        ],
      },
      deps,
    );
    const lines = await (ledger as SqliteLedgerStoreHandle).listLines!();
    expect(lines).toHaveLength(2);
    const revenue = lines.find((l) => l.accountId === "4000")!;
    expect(revenue.costCenterId).toBe("cc-a");
    expect(revenue.source).toBe("system");
    const cash = lines.find((l) => l.accountId === "1300-1")!;
    expect(cash.currency).toBe("USD");
    expect(cash.fxRate).toBe("50");
  });

  it("filters by cost center and account", async () => {
    const { deps, ledger } = await harness();
    await postJournalEntry(
      {
        id: "je-2", date: "2026-08-11", memo: "expense",
        lines: [
          { accountId: "5000", debit: Money.fromMajor("300"), credit: Money.zero(), costCenterId: "cc-b" },
          { accountId: "1300-1", debit: Money.zero(), credit: Money.fromMajor("300") },
        ],
      },
      deps,
    );
    const store = ledger as SqliteLedgerStoreHandle;
    expect(await store.listLines!({ costCenterId: "cc-b" })).toHaveLength(1);
    expect(await store.listLines!({ accountIds: ["5000"] })).toHaveLength(1);
    expect(await store.listLines!({ accountIds: ["9999"] })).toHaveLength(0);
  });
});
