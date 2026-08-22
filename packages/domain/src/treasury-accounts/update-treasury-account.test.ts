import { describe, it, expect } from "vitest";
import { InMemoryTreasuryAccountRepository } from "./test-helpers/in-memory-treasury-account-repository.js";
import { createTreasuryAccount } from "./create-treasury-account.js";
import { updateTreasuryAccount } from "./update-treasury-account.js";
import { NegativeCashBalanceError, TreasuryAccountNotFoundError } from "./errors.js";

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

  it("can deactivate a treasury account via status", async () => {
    const repo = new InMemoryTreasuryAccountRepository();
    await createTreasuryAccount({ id: "ta1", code: "CASH-001", name: "صندوق", branchId: "b1" }, repo);
    const updated = await updateTreasuryAccount("ta1", { status: "inactive" }, repo);
    expect(updated.status).toBe("inactive");
  });
});
