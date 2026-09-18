import { describe, expect, it } from "vitest";
import type { TreasuryAccountDTO } from "@mezan/contracts";
import { treasuryBalanceById } from "./partner-balances";

describe("treasuryBalanceById", () => {
  it("reads each account's balance from its own GL account, debit less credit", () => {
    const balance = treasuryBalanceById(
      [{ id: "T1", glAccountId: "1310" } as TreasuryAccountDTO],
      [{ accountId: "1310", debit: 141396, credit: 0 }],
    );
    expect(balance.get("T1")).toBe(141396);
  });

  it("nets a credit against a debit on the same account", () => {
    const balance = treasuryBalanceById(
      [{ id: "T1", glAccountId: "1310" } as TreasuryAccountDTO],
      [{ accountId: "1310", debit: 1000, credit: 400 }],
    );
    expect(balance.get("T1")).toBe(600);
  });

  it("reports zero for an account with no GL account behind it", () => {
    const balance = treasuryBalanceById([{ id: "T1", glAccountId: null } as TreasuryAccountDTO], []);
    expect(balance.get("T1")).toBe(0);
  });

  it("reports zero for a GL account with no movement rather than undefined", () => {
    const balance = treasuryBalanceById(
      [{ id: "T1", glAccountId: "1399" } as TreasuryAccountDTO],
      [{ accountId: "1310", debit: 500, credit: 0 }],
    );
    expect(balance.get("T1")).toBe(0);
  });

  it("never invents a balance for an account it was not given", () => {
    const balance = treasuryBalanceById([], [{ accountId: "1310", debit: 500, credit: 0 }]);
    expect(balance.size).toBe(0);
  });
});
