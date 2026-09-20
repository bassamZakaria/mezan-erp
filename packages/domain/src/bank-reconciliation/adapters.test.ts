import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { createTreasuryLedgerReader } from "./adapters.js";
import type { AccountLedgerLine, LedgerRepository } from "../gl/ledger.js";
import type { JournalEntry } from "../journal.js";
import type { TreasuryAccount, TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";

function fakeLedger(
  lines: AccountLedgerLine[],
  entryFx: Record<string, { currency: string; fxRate: string }> = {},
): Pick<LedgerRepository, "accountLedger" | "findById"> {
  return {
    async accountLedger(accountId, asOfDate) {
      return lines.filter((l) => (asOfDate ? l.date <= asOfDate : true));
    },
    async findById(id) {
      const line = lines.find((l) => l.entryId === id);
      if (!line) return null;
      const fx = entryFx[id];
      return {
        id: line.entryId,
        entryNo: line.entryNo,
        lines: fx ? [{ accountId: "4910", currency: fx.currency, fxRate: fx.fxRate }] : [],
      } as unknown as JournalEntry;
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
  bankAccountNumber: null,
  branchId: "b1",
  glAccountId: "1310",
  openingBalance: Money.zero(),
  openingBalanceDate: null,
  guaranteeFacilityLimit: null,
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
      { entryId: "je-1", entryNo: "JE-1", date: "2026-08-01", amount: Money.fromMajor("100"), description: "in", currency: "EGP", baseAmount: Money.fromMajor("100"), docNo: null, reference: null, counterparty: null },
      { entryId: "je-2", entryNo: "JE-2", date: "2026-08-02", amount: Money.fromMajor("-30"), description: "out", currency: "EGP", baseAmount: Money.fromMajor("-30"), docNo: null, reference: null, counterparty: null },
    ]);
  });

  it("states a foreign account's candidates in the account's own currency, at the rate the entry was booked at", async () => {
    const usd: TreasuryAccount = { ...BANK_ACCOUNT, id: "ta-usd", currency: "USD", glAccountId: "1310-USD" };
    const lines: AccountLedgerLine[] = [
      { entryId: "je-fx", entryNo: "JE-9", date: "2026-08-05", memo: "wire in", debit: Money.fromMajor("4960"), credit: Money.zero() },
    ];
    const reader = createTreasuryLedgerReader({
      treasuryAccounts: fakeTreasuryAccounts([usd]),
      ledger: fakeLedger(lines, { "je-fx": { currency: "USD", fxRate: "49.60" } }),
    });
    const [candidate] = await reader.entriesForTreasuryAccount("ta-usd", "2026-08-01", "2026-08-31");
    expect(candidate?.amount).toEqual(Money.fromMajor("100"));
    expect(candidate?.currency).toBe("USD");
    expect(candidate?.baseAmount).toEqual(Money.fromMajor("4960"));
    expect(await reader.bookBalance!("ta-usd", "2026-08-31")).toEqual(Money.fromMajor("100"));
  });

  it("leaves a rate-less posting on a foreign account in the base currency, so nothing offers it as a foreign match", async () => {
    const usd: TreasuryAccount = { ...BANK_ACCOUNT, id: "ta-usd", currency: "USD", glAccountId: "1310-USD" };
    const lines: AccountLedgerLine[] = [
      { entryId: "je-plain", entryNo: "JE-8", date: "2026-08-05", memo: null, debit: Money.fromMajor("500"), credit: Money.zero() },
    ];
    const reader = createTreasuryLedgerReader({ treasuryAccounts: fakeTreasuryAccounts([usd]), ledger: fakeLedger(lines) });
    const [candidate] = await reader.entriesForTreasuryAccount("ta-usd", "2026-08-01", "2026-08-31");
    expect(candidate?.currency).toBe("EGP");
    expect(candidate?.amount).toEqual(Money.fromMajor("500"));
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
