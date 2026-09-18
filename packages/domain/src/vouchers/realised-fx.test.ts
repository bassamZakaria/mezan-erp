import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { PostedLine } from "../gl/ledger.js";
import { deriveOpenFxBalances, FX_REVALUATION_LINE_MEMO } from "../fx-revaluation/revaluation.js";
import { settlementSplit, type AllocatableInvoice } from "./allocation.js";
import { buildRealisedFxLines, FX_REALISED_LINE_MEMO, type RealisedFxPostingInput } from "./realised-fx.js";

const m = (v: string) => Money.fromMajor(v);

describe("settlementSplit — what base money settles on a foreign invoice (D221)", () => {
  const rates = { invoiceRate: "48", settlementRate: "50" };

  it("EGP 5,000 at 50.00 settles all of USD 100 booked at 48.00: relief 4,800, gain 200", () => {
    const split = settlementSplit(m("5000"), m("4800"), rates);
    expect(split.relief.toString()).toBe("4800.000000");
    expect(split.fxDifference.toString()).toBe("200.000000");
    expect(split.capacity.toString()).toBe("5000.000000");
  });

  it("EGP 4,600 at 46.00 settles all of it too: relief 4,800, loss 200", () => {
    const split = settlementSplit(m("4600"), m("4800"), { invoiceRate: "48", settlementRate: "46" });
    expect(split.relief.toString()).toBe("4800.000000");
    expect(split.fxDifference.toString()).toBe("-200.000000");
  });

  it("a partial settlement relieves the foreign amount it buys, at the booked rate", () => {
    const split = settlementSplit(m("1000"), m("4800"), rates);
    expect(split.relief.toString()).toBe("960.000000");
    expect(split.fxDifference.toString()).toBe("40.000000");
  });

  it("the last partial settlement relieves exactly what is outstanding, leaving no residue", () => {
    const first = settlementSplit(m("1000"), m("4800.000001"), { invoiceRate: "48.123457", settlementRate: "50" });
    const rest = Money.fromScaled(m("4800.000001").scaled - first.relief.scaled);
    const last = settlementSplit(settlementSplit(m("1"), rest, { invoiceRate: "48.123457", settlementRate: "50" }).capacity, rest, { invoiceRate: "48.123457", settlementRate: "50" });
    expect(last.relief.toString()).toBe(rest.toString());
  });

  it("at the booked rate, or with no rates, the amount is the relief", () => {
    expect(settlementSplit(m("100"), m("4800"), { invoiceRate: "48.00", settlementRate: "48" }).fxDifference.toString()).toBe("0.000000");
    expect(settlementSplit(m("100"), m("4800")).relief.toString()).toBe("100.000000");
  });
});

describe("buildRealisedFxLines — the posting shapes (D221)", () => {
  function input(kind: "sales" | "purchase", diff: string): RealisedFxPostingInput {
    const invoice: AllocatableInvoice = { id: "inv", invoiceNo: "INV-1", kind, partyId: "party", date: "2026-08-22", total: m("4800"), allocated: m("0") };
    return {
      allocationId: "al",
      invoice,
      split: { relief: m("4800"), fxDifference: m(diff), capacity: m("5000") },
      currency: "USD",
      settlementRate: "50",
      date: "2026-08-26",
      controlAccountId: kind === "sales" ? "1105" : "2100",
      reference: "CV-1",
    };
  }
  const accounts = { gainAccountId: "4900", lossAccountId: "5900" };
  const shape = (lines: ReturnType<typeof buildRealisedFxLines>) =>
    lines!.map((l) => `${l.accountId} Dr ${l.debit.toString()} Cr ${l.credit.toString()}`);

  it("customer gain: Dr 1105 / Cr gain, the AR line naming the customer in the invoice's currency", () => {
    const lines = buildRealisedFxLines(input("sales", "200"), accounts)!;
    expect(shape(lines)).toEqual(["1105 Dr 200.000000 Cr 0.000000", "4900 Dr 0.000000 Cr 200.000000"]);
    expect(lines[0]).toMatchObject({ partyId: "party", currency: "USD", fxRate: "50", memo: FX_REALISED_LINE_MEMO });
  });

  it("customer loss: Dr loss / Cr 1105", () => {
    expect(shape(buildRealisedFxLines(input("sales", "-200"), accounts))).toEqual(["1105 Dr 0.000000 Cr 200.000000", "5900 Dr 200.000000 Cr 0.000000"]);
  });

  it("supplier loss (paid more base than booked): Dr loss / Cr 2100", () => {
    expect(shape(buildRealisedFxLines(input("purchase", "30"), accounts))).toEqual(["2100 Dr 0.000000 Cr 30.000000", "5900 Dr 30.000000 Cr 0.000000"]);
  });

  it("supplier gain (paid less base than booked): Dr 2100 / Cr gain", () => {
    expect(shape(buildRealisedFxLines(input("purchase", "-30"), accounts))).toEqual(["2100 Dr 30.000000 Cr 0.000000", "4900 Dr 0.000000 Cr 30.000000"]);
  });

  it("no difference, no entry", () => {
    expect(buildRealisedFxLines(input("sales", "0"), accounts)).toBeNull();
  });
});

describe("deriveOpenFxBalances — restatements move base only (D221)", () => {
  const ar: Account = { id: "1105", code: "1105", nameAr: "عملاء", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" };
  function line(debit: string, credit: string, fxRate: string, memo: string | null): PostedLine {
    return {
      entryId: `e-${debit}-${credit}-${memo}`,
      entryNo: null,
      date: "2026-08-31",
      accountId: "1105",
      debit: m(debit),
      credit: m(credit),
      memo,
      currency: "USD",
      fxRate,
      source: "system",
    } as unknown as PostedLine;
  }

  it("a revalued USD 100 invoice is still USD 100, not USD 102.04", () => {
    const [balance] = deriveOpenFxBalances([line("4800", "0", "48", null), line("100", "0", "49", FX_REVALUATION_LINE_MEMO)], [ar]);
    expect(balance?.foreignAmount.toString()).toBe("100.000000");
    expect(balance?.bookedBase.toString()).toBe("4900.000000");
  });

  it("a settled invoice with its realised difference is no open position at all", () => {
    const balances = deriveOpenFxBalances(
      [line("4800", "0", "48", null), line("0", "5000", "50", null), line("200", "0", "50", FX_REALISED_LINE_MEMO)],
      [ar],
    );
    expect(balances).toEqual([]);
  });
});
