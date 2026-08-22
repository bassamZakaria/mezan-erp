import { describe, it, expect } from "vitest";
import { InMemoryTreasuryAccountRepository } from "./test-helpers/in-memory-treasury-account-repository.js";
import { createTreasuryAccount, validateNewTreasuryAccount } from "./create-treasury-account.js";
import { DuplicateTreasuryAccountCodeError, NegativeCashBalanceError } from "./errors.js";

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
