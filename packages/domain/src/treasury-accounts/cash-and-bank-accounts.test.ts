import { describe, expect, it } from "vitest";
import type { Account } from "../accounts/account.js";
import { cashAndBankLedgerAccountIds } from "./cash-and-bank-accounts.js";
import { assertTreasuryLedgerAccount, InvalidTreasuryLedgerAccountError } from "./ledger-account.js";

const account = (id: string, parentId: string | null, extra: Partial<Account> = {}): Account => ({
  id,
  code: id,
  nameAr: id,
  nameEn: null,
  type: "asset",
  naturalBalance: "debit",
  parentId,
  isHeader: false,
  status: "active",
  ...extra,
});

const CHART: readonly Account[] = [
  account("1000", null, { isHeader: true }),
  account("1300", "1000", { isHeader: true }),
  account("1300-1", "1300"),
  account("1300-2", "1300"),
  account("1300-ALEX", "1300"),
  account("1310", "1300", { isHeader: true }),
  account("1310-EGP", "1310"),
  account("1310-USD", "1310"),
  account("1340", "1300"),
  account("1350", "1000"),
  account("1105", "1000"),
  account("2100", "1300", { type: "liability", naturalBalance: "credit" }),
];

describe("cashAndBankLedgerAccountIds", () => {
  it("is every postable asset under the cash-and-bank header, at any depth — a drawer added later is in without anyone listing it", () => {
    expect(cashAndBankLedgerAccountIds(CHART, { parentAccountId: "1300" })).toEqual(["1300-1", "1300-2", "1300-ALEX", "1310-EGP", "1310-USD", "1340"]);
  });

  it("leaves out what the tenant holds as restricted cash", () => {
    expect(cashAndBankLedgerAccountIds(CHART, { parentAccountId: "1300", restrictedAccountIds: ["1340"] })).not.toContain("1340");
  });

  it("includes a ledger account a treasury account posts through even when the chart files it elsewhere", () => {
    const ids = cashAndBankLedgerAccountIds(CHART, { parentAccountId: "1300", treasuryLedgerAccountIds: ["1350", null, "", "1300-1", "GONE"] });
    expect(ids).toContain("1350");
    expect(ids).not.toContain("GONE");
    expect(ids.filter((id) => id === "1300-1")).toHaveLength(1);
  });

  it("follows the header the tenant routed, not a fixed id", () => {
    const recoded = [account("11", null, { isHeader: true }), account("1101", "11"), account("1300", null, { isHeader: true }), account("1300-1", "1300")];
    expect(cashAndBankLedgerAccountIds(recoded, { parentAccountId: "11" })).toEqual(["1101"]);
  });

  it("never returns a header, a non-asset or anything outside the subtree, and survives a cycle in the chart", () => {
    const looped = [account("A", "B", { isHeader: true }), account("B", "A", { isHeader: true }), account("LEAF", "A")];
    expect(cashAndBankLedgerAccountIds(looped, { parentAccountId: "A" })).toEqual(["LEAF"]);
    const ids = cashAndBankLedgerAccountIds(CHART, { parentAccountId: "1300" });
    for (const excluded of ["1300", "1310", "1105", "1350", "2100"]) expect(ids).not.toContain(excluded);
  });
});

describe("assertTreasuryLedgerAccount — the cash-and-bank header is the tenant's, not a fixed id", () => {
  const recoded = [account("11", null, { isHeader: true }), account("1101", "11"), account("1300", null, { isHeader: true }), account("1300-1", "1300")];
  const accounts = { findById: async (id: string) => recoded.find((entry) => entry.id === id) ?? null };
  const drawer = (glAccountId: string) => ({ id: "TR-1", glAccountId, currency: "EGP" });

  it("accepts a leaf under the routed header and refuses one under the standard chart's 1300 the tenant no longer uses for cash", async () => {
    const deps = { accounts, cashAndBankParentAccountId: async () => "11" };
    await expect(assertTreasuryLedgerAccount(drawer("1101"), deps)).resolves.toBeUndefined();
    await expect(assertTreasuryLedgerAccount(drawer("1300-1"), deps)).rejects.toBeInstanceOf(InvalidTreasuryLedgerAccountError);
  });

  it("falls back to the routing slot's shipped default when no routing is supplied", async () => {
    await expect(assertTreasuryLedgerAccount(drawer("1300-1"), { accounts })).resolves.toBeUndefined();
    await expect(assertTreasuryLedgerAccount(drawer("1101"), { accounts })).rejects.toBeInstanceOf(InvalidTreasuryLedgerAccountError);
  });
});
