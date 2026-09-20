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
import type { PostedLine } from "../gl/ledger.js";
import { computeFxRevaluation, deriveOpenFxBalances, postFxRevaluation, nextDay, fxRevaluationNet, type OpenFxBalance, type FxRevaluationConfig } from "./revaluation.js";

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

/**
 * D194 — the aging ladders age each invoice at its booked rate, so the one
 * amount a control account holds that no invoice does is the unreversed
 * revaluation. `fxRevaluationNet` finds it by the memo every revaluation line
 * and every reversal line carries.
 */
describe("fxRevaluationNet", () => {
  async function linesOf(ledger: InMemoryLedgerRepository, toDate: string) {
    const entries = await ledger.list();
    return entries
      .filter((e) => e.date <= toDate)
      .flatMap((e) => e.lines.map((l) => ({ accountId: l.accountId, memo: l.memo ?? null, source: e.source ?? "manual", debit: l.debit, credit: l.credit })));
  }
  const balances: OpenFxBalance[] = [
    { accountId: "1100", currency: "USD", foreignAmount: Money.fromMajor("100"), bookedBase: Money.fromMajor("5000"), naturalBalance: "debit" },
  ];

  it("is the restatement on the revaluation date and nothing once the auto-reversal has posted", async () => {
    const { deps, ledger } = await harness();
    await postFxRevaluation(balances, config, deps, { id: "reval-1", reversalId: "reval-1-rev" });
    expect(fxRevaluationNet(await linesOf(ledger, "2026-08-31"), "1100").toString()).toBe(Money.fromMajor("500").toString());
    expect(fxRevaluationNet(await linesOf(ledger, "2026-09-01"), "1100").toString()).toBe(Money.zero().toString());
  });

  it("ignores a manual journal that happens to reuse the memo", () => {
    const lines = [{ accountId: "1100", memo: "إعادة تقييم عملات أجنبية", source: "manual" as const, debit: Money.fromMajor("9"), credit: Money.zero() }];
    expect(fxRevaluationNet(lines, "1100").toString()).toBe(Money.zero().toString());
  });
});

/**
 * guards D322 — a foreign receipt credits its revenue account once, at the spot
 * rate of the day the income was earned, and `deriveOpenFxBalances` collected
 * that line as an open position: the seeded USD receipt put GL 4910 إيرادات
 * أخرى in the preview as USD 1,200.00 booked at 58,680.00 and restated the
 * whole tenant by 540.00 every month end, for income settled the day it was
 * booked.
 */
describe("deriveOpenFxBalances — only a monetary item is an open FX position (IAS 21 ¶23)", () => {
  const accounts: Account[] = [
    account("1105", { nameAr: "ذمم عملاء تجارية" }),
    account("2100", { type: "liability", naturalBalance: "credit", nameAr: "ذمم موردين" }),
    account("1310", { nameAr: "بنك بالدولار" }),
    account("4910", { type: "revenue", naturalBalance: "credit", nameAr: "إيرادات أخرى" }),
    account("5910", { type: "expense", naturalBalance: "debit", nameAr: "مصروفات أخرى" }),
    account("3100", { type: "equity", naturalBalance: "credit", nameAr: "رأس المال" }),
    account("9100", { type: "memorandum", naturalBalance: "debit", nameAr: "حسابات نظامية" }),
  ];

  function line(accountId: string, debit: string, credit: string): PostedLine {
    return {
      entryId: `je-${accountId}`,
      entryNo: null,
      date: "2026-09-01",
      source: "system",
      accountId,
      costCenterId: null,
      projectId: null,
      costCategory: null,
      branchId: null,
      currency: "USD",
      fxRate: "48.90",
      memo: null,
      debit: Money.fromMajor(debit),
      credit: Money.fromMajor(credit),
    };
  }

  it("ignores the revenue leg of a foreign receipt that settled the day it was booked", () => {
    const open = deriveOpenFxBalances([line("4910", "0", "58680.00")], accounts);
    expect(open).toEqual([]);
  });

  it("ignores expense, equity and memorandum accounts too", () => {
    const open = deriveOpenFxBalances(
      [line("5910", "4890.00", "0"), line("3100", "0", "4890.00"), line("9100", "4890.00", "0")],
      accounts,
    );
    expect(open).toEqual([]);
  });

  it("still collects the receivable, the payable and the foreign bank account", () => {
    const open = deriveOpenFxBalances(
      [line("1105", "48900.00", "0"), line("2100", "0", "24450.00"), line("1310", "9780.00", "0"), line("4910", "0", "58680.00")],
      accounts,
    );
    expect(open.map((b) => b.accountId)).toEqual(["1105", "1310", "2100"]);
    expect(open.map((b) => b.foreignAmount.toString())).toEqual(["1000.000000", "200.000000", "500.000000"]);
  });
});
