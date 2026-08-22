import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import { CashBalanceWouldGoNegativeError } from "./errors.js";

async function payFromCash(h: ReturnType<typeof buildTestService>, id: string, amount: string) {
  await h.service.createVoucher({
    id,
    date: "2026-08-22",
    voucherType: "other_expense",
    amount: Money.fromMajor(amount),
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "5900",
  });
  return h.service.confirmVoucher(id);
}

describe("cash-negative guard", () => {
  it("blocks a cash payment that would overdraw the cash drawer", async () => {
    const h = buildTestService({ preventNegativeCashBalance: true });
    await h.seedCashBalance("1300-1", "100");
    await expect(payFromCash(h, "p1", "150")).rejects.toBeInstanceOf(CashBalanceWouldGoNegativeError);
    // Nothing posted — balance intact.
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("100.000000");
  });

  it("allows a cash payment fully covered by the balance", async () => {
    const h = buildTestService({ preventNegativeCashBalance: true });
    await h.seedCashBalance("1300-1", "100");
    await expect(payFromCash(h, "p2", "100")).resolves.toMatchObject({ held: false });
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("0.000000");
  });

  it("allows a BANK account to overdraft (overdraft permitted)", async () => {
    const h = buildTestService({ preventNegativeCashBalance: true });
    await h.service.createVoucher({
      id: "b1v",
      date: "2026-08-22",
      voucherType: "other_expense",
      amount: Money.fromMajor("500"),
      branchId: "b1",
      paymentMethod: "bank",
      treasuryAccountId: "ta-bank1",
      treasuryGlAccountId: "1310",
      counterpartyGlAccountId: "5900",
    });
    await expect(h.service.confirmVoucher("b1v")).resolves.toMatchObject({ held: false });
    expect((await h.ledger.accountBalance("1310")).balance.toString()).toBe("-500.000000");
  });

  it("does not block receipts (money in never overdraws)", async () => {
    const h = buildTestService({ preventNegativeCashBalance: true });
    await h.service.createVoucher({
      id: "r1",
      date: "2026-08-22",
      voucherType: "other_income",
      amount: Money.fromMajor("100"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "4900",
    });
    await expect(h.service.confirmVoucher("r1")).resolves.toMatchObject({ held: false });
  });

  it("allows an overdrawing cash payment when the policy is OFF", async () => {
    const h = buildTestService({ preventNegativeCashBalance: false });
    await h.seedCashBalance("1300-1", "100");
    await expect(payFromCash(h, "p3", "150")).resolves.toMatchObject({ held: false });
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("-50.000000");
  });

  it("blocks a transfer that would overdraw the SOURCE cash account", async () => {
    const h = buildTestService({ preventNegativeCashBalance: true });
    await h.seedCashBalance("1300-1", "40");
    await h.service.createVoucher({
      id: "t1",
      date: "2026-08-22",
      voucherType: "inter_treasury_transfer",
      amount: Money.fromMajor("60"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterTreasuryAccountId: "ta-cash2",
      counterTreasuryGlAccountId: "1300-2",
    });
    await expect(h.service.confirmVoucher("t1")).rejects.toBeInstanceOf(CashBalanceWouldGoNegativeError);
  });
});
