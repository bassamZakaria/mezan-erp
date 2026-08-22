import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
} from "../gl/test-helpers/in-memory-ledger-repository.js";
import type { JournalPostingDeps } from "../gl/post.js";
import { FxRateMissingError } from "../exchange-rates/convert.js";
import { computeFxRevaluation, postFxRevaluation, nextDay, type OpenFxBalance, type FxRevaluationConfig } from "./revaluation.js";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

async function harness() {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  await accounts.create(account("1100")); // AR (asset)
  await accounts.create(account("2100", { type: "liability", naturalBalance: "credit" })); // AP (liability)
  await accounts.create(account("4900", { type: "revenue", naturalBalance: "credit" })); // FX gain
  await accounts.create(account("5900", { type: "expense", naturalBalance: "debit" })); // FX loss
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  await periods.create({ id: "fp-09", year: 2026, periodNumber: 9, startDate: "2026-09-01", endDate: "2026-09-30", status: "open" });
  const deps: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => "2026-08-31T12:00:00.000Z",
    actor: "u1",
  };
  return { deps, ledger };
}

const config: FxRevaluationConfig = {
  date: "2026-08-31",
  closingRates: new Map([["USD", "55"], ["EUR", "60"]]),
  gainAccountId: "4900",
  lossAccountId: "5900",
};

describe("computeFxRevaluation — math", () => {
  it("revalues an asset balance up at the closing rate → gain, and builds a balanced entry", () => {
    // AR $100 booked at rate 50 = 5000; closing 55 → 5500; delta +500 gain.
    const balances: OpenFxBalance[] = [
      { accountId: "1100", currency: "USD", foreignAmount: Money.fromMajor("100"), bookedBase: Money.fromMajor("5000"), naturalBalance: "debit", label: "عميل" },
    ];
    const r = computeFxRevaluation(balances, config);
    expect(r.details[0]!.revaluedBase.toString()).toBe(Money.fromMajor("5500").toString());
    expect(r.details[0]!.delta.toString()).toBe(Money.fromMajor("500").toString());
    expect(r.totalGain.toString()).toBe(Money.fromMajor("500").toString());
    expect(r.totalLoss.toString()).toBe(Money.fromMajor("0").toString());
    // Dr AR 500 / Cr FX gain 500.
    const debit = Money.sum(r.lines.map((l) => l.debit));
    const credit = Money.sum(r.lines.map((l) => l.credit));
    expect(debit.toString()).toBe(credit.toString());
    expect(r.lines.find((l) => l.accountId === "1100")!.debit.toString()).toBe(Money.fromMajor("500").toString());
    expect(r.lines.find((l) => l.accountId === "4900")!.credit.toString()).toBe(Money.fromMajor("500").toString());
  });

  it("treats a liability whose base value rises as a loss (credit AP, debit FX loss)", () => {
    // AP $100 booked 5000; closing 55 → 5500; liability up 500 → loss.
    const balances: OpenFxBalance[] = [
      { accountId: "2100", currency: "USD", foreignAmount: Money.fromMajor("100"), bookedBase: Money.fromMajor("5000"), naturalBalance: "credit" },
    ];
    const r = computeFxRevaluation(balances, config);
    expect(r.totalLoss.toString()).toBe(Money.fromMajor("500").toString());
    expect(r.lines.find((l) => l.accountId === "2100")!.credit.toString()).toBe(Money.fromMajor("500").toString());
    expect(r.lines.find((l) => l.accountId === "5900")!.debit.toString()).toBe(Money.fromMajor("500").toString());
  });

  it("nets gains and losses across balances and rounds conversion without floats", () => {
    // EUR balance: €33.333333 * 60 = 1999.99998 → rounds to 1999.999980.
    const balances: OpenFxBalance[] = [
      { accountId: "1100", currency: "EUR", foreignAmount: Money.fromMajor("33.333333"), bookedBase: Money.fromMajor("2000"), naturalBalance: "debit" },
    ];
    const r = computeFxRevaluation(balances, config);
    expect(r.details[0]!.revaluedBase.toString()).toBe("1999.999980");
    expect(r.hasImpact).toBe(true);
  });

  it("enforces the strict fx-rate-missing policy", () => {
    const balances: OpenFxBalance[] = [
      { accountId: "1100", currency: "GBP", foreignAmount: Money.fromMajor("100"), bookedBase: Money.fromMajor("5000"), naturalBalance: "debit" },
    ];
    expect(() => computeFxRevaluation(balances, config)).toThrow(FxRateMissingError);
  });

  it("reports no impact when nothing moved", () => {
    const balances: OpenFxBalance[] = [
      { accountId: "1100", currency: "USD", foreignAmount: Money.fromMajor("100"), bookedBase: Money.fromMajor("5500"), naturalBalance: "debit" },
    ];
    const r = computeFxRevaluation(balances, config);
    expect(r.hasImpact).toBe(false);
    expect(r.lines).toHaveLength(0);
  });
});

describe("postFxRevaluation — posting + auto-reversal", () => {
  const balances: OpenFxBalance[] = [
    { accountId: "1100", currency: "USD", foreignAmount: Money.fromMajor("100"), bookedBase: Money.fromMajor("5000"), naturalBalance: "debit" },
  ];

  it("posts the revaluation entry and an auto-reversal dated the next day (default on)", async () => {
    const { deps, ledger } = await harness();
    const result = await postFxRevaluation(balances, config, deps, { id: "fx-1", reversalId: "fx-1-rev" });
    expect(result.entry).not.toBeNull();
    expect(result.entry!.date).toBe("2026-08-31");
    expect(result.entry!.source).toBe("system");
    expect(result.reversal).not.toBeNull();
    expect(result.reversal!.date).toBe("2026-09-01");
    // The reversal offsets the original: net AR movement across both is zero.
    const arBalance = await ledger.accountBalance("1100");
    expect(arBalance.balance.toString()).toBe(Money.fromMajor("0").toString());
    // The original entry is now marked reversed.
    const original = await ledger.findById("fx-1");
    expect(original!.status).toBe("reversed");
    expect(original!.reversedByEntryId).toBe("fx-1-rev");
  });

  it("does not post a reversal when autoReverse is off", async () => {
    const { deps, ledger } = await harness();
    const result = await postFxRevaluation(balances, config, deps, { id: "fx-2", autoReverse: false });
    expect(result.entry).not.toBeNull();
    expect(result.reversal).toBeNull();
    // Only the revaluation impact remains on the books (500 gain on AR).
    const arBalance = await ledger.accountBalance("1100");
    expect(arBalance.balance.toString()).toBe(Money.fromMajor("500").toString());
  });

  it("posts nothing when there is no rate movement", async () => {
    const { deps } = await harness();
    const flat: OpenFxBalance[] = [
      { accountId: "1100", currency: "USD", foreignAmount: Money.fromMajor("100"), bookedBase: Money.fromMajor("5500"), naturalBalance: "debit" },
    ];
    const result = await postFxRevaluation(flat, config, deps, { id: "fx-3", reversalId: "fx-3-rev" });
    expect(result.entry).toBeNull();
    expect(result.reversal).toBeNull();
  });

  it("is period-gated — a closing date in no open period is rejected", async () => {
    const { deps } = await harness();
    const closed: FxRevaluationConfig = { ...config, date: "2026-12-31" };
    await expect(postFxRevaluation(balances, closed, deps, { id: "fx-4", reversalId: "fx-4-rev" })).rejects.toThrow();
  });

  it("nextDay rolls month boundaries in UTC", () => {
    expect(nextDay("2026-08-31")).toBe("2026-09-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});
