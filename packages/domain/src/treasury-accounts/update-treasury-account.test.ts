import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryTreasuryAccountRepository } from "./test-helpers/in-memory-treasury-account-repository.js";
import { createTreasuryAccount } from "./create-treasury-account.js";
import { updateTreasuryAccount } from "./update-treasury-account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import type { Account } from "../accounts/account.js";
import { TreasuryLedgerAccountUnlinkError } from "./ledger-account.js";
import {
  InvalidGuaranteeFacilityLimitError,
  InvalidOpeningBalanceError,
  NegativeCashBalanceError,
  TreasuryAccountNotFoundError,
} from "./errors.js";

describe("updateTreasuryAccount", () => {
  it("updates fields in place", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق", branchId: "b1" }, repo);
    const updated = await updateTreasuryAccount("ta1", { name: "صندوق نقدي الفرع الرئيسي" }, repo);
    expect(updated.name).toBe("صندوق نقدي الفرع الرئيسي");
  });

  it("404s (throws TreasuryAccountNotFoundError) for an unknown id", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await expect(updateTreasuryAccount("nope", { name: "x" }, repo)).rejects.toThrow(TreasuryAccountNotFoundError);
  });

  it("supports 'إضافة رصيد افتتاحي' — adjusting the opening balance after creation", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-002", name: "صندوق", branchId: "b1" }, repo);
    const updated = await updateTreasuryAccount("ta1", { openingBalance: "338.00", openingBalanceDate: "2026-08-01" }, repo);
    expect(updated.openingBalance.toString()).toBe("338.000000");
    expect(updated.openingBalanceDate).toBe("2026-08-01");
  });

  it("rejects flipping a cash account's opening balance negative", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق", branchId: "b1" }, repo);
    await expect(updateTreasuryAccount("ta1", { openingBalance: "-1.00" }, repo)).rejects.toThrow(NegativeCashBalanceError);
  });

  it("refuses an opening balance too large to round-trip, instead of throwing at the SQLite writer as a 500", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta-bank", code: "BANK-001", name: "بنك", type: "bank", branchId: "b1" }, repo);
    await expect(
      updateTreasuryAccount("ta-bank", { openingBalance: "1000000012000000" }, repo),
    ).rejects.toBeInstanceOf(InvalidOpeningBalanceError);
  });

  it("can deactivate a treasury account via status", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق", branchId: "b1" }, repo);
    const updated = await updateTreasuryAccount("ta1", { status: "inactive" }, repo);
    expect(updated.status).toBe("inactive");
  });
});

function bankAccount() {
  return {
    id: "ta-bank",
    code: "BANK-001",
    name: "البنك الأهلي",
    nameEn: null,
    type: "bank" as const,
    currency: "EGP",
    bankAccountNumber: null,
    branchId: "b1",
    glAccountId: "1310",
    openingBalance: Money.zero(),
    openingBalanceDate: null,
    guaranteeFacilityLimit: null,
    status: "active" as const,
  };
}

describe("حد تسهيلات خطابات الضمان", () => {
  it("stores a facility limit and clears it again", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await repo.create(bankAccount());
    const withLimit = await updateTreasuryAccount("ta-bank", { guaranteeFacilityLimit: "10000000" }, repo);
    expect(withLimit.guaranteeFacilityLimit?.toString()).toBe("10000000.000000");
    const cleared = await updateTreasuryAccount("ta-bank", { guaranteeFacilityLimit: null }, repo);
    expect(cleared.guaranteeFacilityLimit).toBeNull();
  });

  it("refuses a negative limit rather than storing a ceiling below zero", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await repo.create(bankAccount());
    await expect(updateTreasuryAccount("ta-bank", { guaranteeFacilityLimit: "-1" }, repo)).rejects.toBeInstanceOf(
      InvalidGuaranteeFacilityLimitError,
    );
  });

  it("refuses a limit too large to round-trip, instead of throwing at the SQLite writer as a 500", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await repo.create(bankAccount());
    await expect(
      updateTreasuryAccount("ta-bank", { guaranteeFacilityLimit: "1000000012000000" }, repo),
    ).rejects.toBeInstanceOf(InvalidGuaranteeFacilityLimitError);
  });
});

describe("updateTreasuryAccount — its own ledger account (#120)", () => {
  async function chart() {
    const accounts = new InMemoryAccountRepository();
    await accounts.create({ id: "1300", code: "1300", nameAr: "النقدية", nameEn: "Cash", type: "asset", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" });
    await accounts.create({ id: "1300-1", code: "1300-1", nameAr: "صندوق", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" });
    return accounts;
  }

  it("refuses clearing the ledger account of a linked treasury account in Arabic, and opens no leaf", async () => {
    const accounts = await chart();
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1", glAccountId: "1300-1" }, repo, { accounts });
    const refused = updateTreasuryAccount("ta1", { glAccountId: null }, repo, { accounts });
    await expect(refused).rejects.toBeInstanceOf(TreasuryLedgerAccountUnlinkError);
    await expect(refused).rejects.toThrow(/لا يمكن فك ربط حساب الخزينة/);
    await expect(updateTreasuryAccount("ta1", { glAccountId: "" }, repo, { accounts })).rejects.toBeInstanceOf(TreasuryLedgerAccountUnlinkError);
    expect((await repo.findById("ta1"))?.glAccountId).toBe("1300-1");
    expect(await accounts.list()).toHaveLength(2);
  });

  it("opens one leaf for an unlinked account, and none on the next save", async () => {
    const accounts = await chart();
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1" }, repo);
    const opened: Account[] = [];
    const deps = { accounts, onOpened: async (leaf: Account) => void opened.push(leaf) };
    const linked = await updateTreasuryAccount("ta1", { name: "صندوق الفرع" }, repo, deps);
    expect(linked.glAccountId).toBe("1300-2");
    expect(opened.map((leaf) => [leaf.id, leaf.nameAr])).toEqual([["1300-2", "صندوق الفرع"]]);
    const again = await updateTreasuryAccount("ta1", { name: "صندوق الفرع ٢" }, repo, deps);
    expect(again.glAccountId).toBe("1300-2");
    expect(opened).toHaveLength(1);
    expect(await accounts.list()).toHaveLength(3);
  });

  it("opens no leaf when the save is refused", async () => {
    const accounts = await chart();
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-9", name: "صندوق", branchId: "b1" }, repo);
    await expect(updateTreasuryAccount("ta1", { openingBalance: "-1.00" }, repo, { accounts })).rejects.toThrow(NegativeCashBalanceError);
    expect(await accounts.list()).toHaveLength(2);
    expect((await repo.findById("ta1"))?.glAccountId).toBeNull();
  });
});
