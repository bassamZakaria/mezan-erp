import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryTreasuryAccountRepository } from "./test-helpers/in-memory-treasury-account-repository.js";
import { createTreasuryAccount } from "./create-treasury-account.js";
import { updateTreasuryAccount } from "./update-treasury-account.js";
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
