import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { createTreasuryLedgerReader } from "./adapters.js";
import type { AccountLedgerLine, LedgerRepository } from "../gl/ledger.js";
import type { TreasuryAccount, TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";

function fakeLedger(lines: AccountLedgerLine[]): Pick<LedgerRepository, "accountLedger"> {
  return {
    async accountLedger(accountId, asOfDate) {
      return lines.filter((l) => (asOfDate ? l.date <= asOfDate : true));
    },
  };
}

function fakeTreasuryAccounts(accounts: TreasuryAccount[]): Pick<TreasuryAccountRepository, "findById"> {
  return {
    async findById(id) {
      return accounts.find((a) => a.id === id) ?? null;
    },
  };
}

const BANK_ACCOUNT: TreasuryAccount = {
  id: "ta-bank1",
  code: "BANK-001",
  name: "بنك", nameEn: null,
  type: "bank",
  currency: "EGP",
  branchId: "b1",
  glAccountId: "1310",
  openingBalance: Money.zero(),
  openingBalanceDate: null,
  status: "active",
};

describe("createTreasuryLedgerReader", () => {
  it("converts debit-natural ledger lines to signed candidates (debit = money in)", async () => {
    const lines: AccountLedgerLine[] = [
      { entryId: "je-1", entryNo: "JE-1", date: "2026-08-01", memo: "in", debit: Money.fromMajor("100"), credit: Money.zero() },
      { entryId: "je-2", entryNo: "JE-2", date: "2026-08-02", memo: "out", debit: Money.zero(), credit: Money.fromMajor("30") },
    ];
    const reader = createTreasuryLedgerReader({ treasuryAccounts: fakeTreasuryAccounts([BANK_ACCOUNT]), ledger: fakeLedger(lines) });
    const candidates = await reader.entriesForTreasuryAccount("ta-bank1", "2026-08-01", "2026-08-31");
    expect(candidates).toEqual([
      { entryId: "je-1", date: "2026-08-01", amount: Money.fromMajor("100"), description: "in" },
      { entryId: "je-2", date: "2026-08-02", amount: Money.fromMajor("-30"), description: "out" },
    ]);
  });

  it("filters out lines before fromDate", async () => {
    const lines: AccountLedgerLine[] = [
      { entryId: "je-1", entryNo: "JE-1", date: "2026-07-15", memo: null, debit: Money.fromMajor("1"), credit: Money.zero() },
    ];
    const reader = createTreasuryLedgerReader({ treasuryAccounts: fakeTreasuryAccounts([BANK_ACCOUNT]), ledger: fakeLedger(lines) });
    const candidates = await reader.entriesForTreasuryAccount("ta-bank1", "2026-08-01", "2026-08-31");
    expect(candidates).toEqual([]);
  });

  it("returns no candidates for an account with no gl account configured", async () => {
    const account: TreasuryAccount = { ...BANK_ACCOUNT, id: "ta-cash", glAccountId: null };
    const reader = createTreasuryLedgerReader({ treasuryAccounts: fakeTreasuryAccounts([account]), ledger: fakeLedger([]) });
    expect(await reader.entriesForTreasuryAccount("ta-cash", "2026-08-01", "2026-08-31")).toEqual([]);
  });

  it("returns no candidates for an unknown treasury account", async () => {
    const reader = createTreasuryLedgerReader({ treasuryAccounts: fakeTreasuryAccounts([]), ledger: fakeLedger([]) });
    expect(await reader.entriesForTreasuryAccount("nope", "2026-08-01", "2026-08-31")).toEqual([]);
  });
});
