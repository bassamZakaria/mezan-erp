import { describe, it, expect } from "vitest";
import { InMemoryTreasuryAccountRepository } from "./test-helpers/in-memory-treasury-account-repository.js";
import { createTreasuryAccount, validateNewTreasuryAccount } from "./create-treasury-account.js";
import { DuplicateTreasuryAccountCodeError, InvalidOpeningBalanceError, NegativeCashBalanceError } from "./errors.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { DuplicateAccountCodeError, InvalidParentAccountError } from "../accounts/errors.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";
import type { Account } from "../accounts/account.js";

describe("createTreasuryAccount", () => {
  it("creates a cash account with defaults (EGP, zero opening balance, active)", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    const account = await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق نقدي", branchId: "b1" }, repo);
    expect(account).toMatchObject({ code: "CASH-001", type: "cash", currency: "EGP", branchId: "b1", status: "active" });
    expect(account.openingBalance.toString()).toBe("0.000000");
    expect(await repo.findById("ta1")).toEqual(account);
  });

  it("creates a bank account with an opening balance and an explicit GL account", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    const account = await createTreasuryAccount(
      {
        id: "ta1",
        code: "BANK-001",
        name: "البنك الأهلي المصري",
        type: "bank",
        branchId: "b1",
        glAccountId: "1310",
        openingBalance: "50000.00",
        openingBalanceDate: "2026-01-01",
      },
      repo,
    );
    expect(account.type).toBe("bank");
    expect(account.glAccountId).toBe("1310");
    expect(account.openingBalance.toString()).toBe("50000.000000");
  });

  it("rejects a duplicate treasury account code", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق نقدي", branchId: "b1" }, repo);
    await expect(
      createTreasuryAccount({ id: "ta2", code: "CASH-001", name: "نسخة", branchId: "b1" }, repo),
    ).rejects.toThrow(DuplicateTreasuryAccountCodeError);
  });

  it("refuses an opening balance too large to round-trip through the SQLite writer, instead of throwing there as a 500", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await expect(
      createTreasuryAccount(
        { id: "ta1", code: "BANK-001", name: "بنك", type: "bank", branchId: "b1", openingBalance: "1000000012000000" },
        repo,
      ),
    ).rejects.toBeInstanceOf(InvalidOpeningBalanceError);
  });

  it("rejects a negative opening balance for a cash account", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await expect(
      createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق", branchId: "b1", openingBalance: "-10.00" }, repo),
    ).rejects.toThrow(NegativeCashBalanceError);
  });

  it("allows a negative opening balance for a bank account (overdraft)", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    const account = await createTreasuryAccount(
      { id: "ta1", code: "BANK-001", name: "بنك", type: "bank", branchId: "b1", openingBalance: "-500.00" },
      repo,
    );
    expect(account.openingBalance.toString()).toBe("-500.000000");
  });

  it("validateNewTreasuryAccount is a pure pre-check that does not persist anything", () => {
    expect(() => validateNewTreasuryAccount({ id: "x", code: "NEW", name: "n", branchId: "b1" }, [])).not.toThrow();
  });
});

describe("createTreasuryAccount — its own ledger account (#120)", () => {
  async function chart() {
    const accounts = new InMemoryAccountRepository();
    await accounts.create({ id: "1300", code: "1300", nameAr: "النقدية", nameEn: "Cash", type: "asset", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" });
    await accounts.create({ id: "1300-1", code: "1300-1", nameAr: "صندوق", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" });
    return accounts;
  }

  it("opens a leaf under the cash-and-bank header with the next free code and links it", async () => {
    const accounts = await chart();
    const repo = new InMemoryTreasuryAccountRepository();
    const account = await createTreasuryAccount({ id: "ta1", code: "BANK-9", name: "بنك مصر", nameEn: "Banque Misr", type: "bank", branchId: "b1" }, repo, { accounts });
    expect(account.glAccountId).toBe("1300-2");
    expect(await accounts.findById("1300-2")).toMatchObject({ code: "1300-2", nameAr: "بنك مصر", nameEn: "Banque Misr", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" });
    const second = await createTreasuryAccount({ id: "ta2", code: "CASH-9", name: "صندوق ٢", branchId: "b1" }, repo, { accounts });
    expect(second.glAccountId).toBe("1300-3");
  });

  it("keeps the ledger account the caller chose and opens none", async () => {
    const accounts = await chart();
    const repo = new InMemoryTreasuryAccountRepository();
    const account = await createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1", glAccountId: "1300-1" }, repo, { accounts });
    expect(account.glAccountId).toBe("1300-1");
    expect(await accounts.list()).toHaveLength(2);
  });

  it("opens under the routed header, and refuses in Arabic when there is none", async () => {
    const accounts = await chart();
    const repo = new InMemoryTreasuryAccountRepository();
    await expect(
      createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1" }, repo, { accounts, cashAndBankParentAccountId: async () => "9999" }),
    ).rejects.toBeInstanceOf(InvalidParentAccountError);
    expect(await repo.findById("ta1")).toBeNull();
  });

  it("hands the opened leaf to onOpened once, so the caller can audit it", async () => {
    const accounts = await chart();
    const opened: Account[] = [];
    const account = await createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1" }, new InMemoryTreasuryAccountRepository(), {
      accounts,
      onOpened: async (leaf) => {
        opened.push(leaf);
      },
    });
    expect(opened.map((leaf) => leaf.id)).toEqual([account.glAccountId]);
  });

  it("refuses a taken treasury id before opening a leaf, so the refusal leaves no orphan", async () => {
    const accounts = await chart();
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1", glAccountId: "1300-1" }, repo, { accounts });
    await expect(createTreasuryAccount({ id: "ta1", code: "CASH-10", name: "صندوق ٢", branchId: "b1" }, repo, { accounts })).rejects.toBeInstanceOf(DuplicateRecordIdError);
    expect(await accounts.list()).toHaveLength(2);
  });

  it("takes the next free code when another create took the same one first, and answers 409's error when that one is taken too", async () => {
    const accounts = await chart();
    const leaf = (id: string): Account => ({ id, code: id, nameAr: "سباق", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" });
    let raced = 0;
    const racing = {
      findById: (id: string) => accounts.findById(id),
      list: () => accounts.list(),
      create: async (account: Account) => {
        if (raced < 1) {
          raced += 1;
          await accounts.create(leaf(account.id));
        }
        await accounts.create(account);
      },
    };
    const account = await createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1" }, new InMemoryTreasuryAccountRepository(), { accounts: racing });
    expect(account.glAccountId).toBe("1300-3");

    const alwaysRaced = {
      ...racing,
      create: async (account: Account) => {
        await accounts.create(leaf(account.id));
        await accounts.create(account);
      },
    };
    await expect(
      createTreasuryAccount({ id: "ta2", code: "CASH-10", name: "صندوق ٢", branchId: "b1" }, new InMemoryTreasuryAccountRepository(), { accounts: alwaysRaced }),
    ).rejects.toBeInstanceOf(DuplicateAccountCodeError);
  });
});
