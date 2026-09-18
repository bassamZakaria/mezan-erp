import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { PostedLine } from "../gl/ledger.js";
import { computeFxRevaluation, deriveOpenFxBalances, FX_REVALUATION_LINE_MEMO } from "../fx-revaluation/revaluation.js";
import { settlementSplit, type AllocatableInvoice } from "./allocation.js";
import { buildRealisedFxLines, FX_REALISED_LINE_MEMO, FX_SETTLEMENT_LINE_MEMO, type RealisedFxPostingInput } from "./realised-fx.js";

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

describe("buildRealisedFxLines — the posting shapes (D221, D260)", () => {
  function input(kind: "sales" | "purchase", diff: string, money: { currency: string | null; fxRate: string | null } = { currency: "EGP", fxRate: null }): RealisedFxPostingInput {
    const invoice: AllocatableInvoice = { id: "inv", invoiceNo: "INV-1", kind, partyId: "party", date: "2026-08-22", total: m("4800"), allocated: m("0") };
    return {
      allocationId: "al",
      invoice,
      split: { relief: m("4800"), fxDifference: m(diff), capacity: m("5000") },
      currency: "USD",
      invoiceRate: "48",
      money,
      date: "2026-08-26",
      controlAccountId: kind === "sales" ? "1105" : "2100",
      reference: "CV-1",
    };
  }
  const accounts = { gainAccountId: "4900", lossAccountId: "5900" };
  const shape = (lines: ReturnType<typeof buildRealisedFxLines>) =>
    lines!.map((l) => `${l.accountId} ${l.currency ?? "-"}@${l.fxRate ?? "-"} Dr ${l.debit.toString()} Cr ${l.credit.toString()}`);

  it("customer gain in EGP: the receipt comes off 1105 in base, USD 100 is relieved at 48.00, Cr gain", () => {
    const lines = buildRealisedFxLines(input("sales", "200"), accounts)!;
    expect(shape(lines)).toEqual([
      "1105 -@- Dr 5000.000000 Cr 0.000000",
      "1105 USD@48 Dr 0.000000 Cr 4800.000000",
      "4900 -@- Dr 0.000000 Cr 200.000000",
    ]);
    expect(lines.slice(0, 2).every((line) => line.partyId === "party" && line.memo === FX_SETTLEMENT_LINE_MEMO)).toBe(true);
    expect(lines[2]?.memo).toBe(FX_REALISED_LINE_MEMO);
  });

  it("customer loss: Dr 1105 base 4,600 / Cr 1105 USD 4,800 / Dr loss 200", () => {
    expect(shape(buildRealisedFxLines(input("sales", "-200"), accounts))).toEqual([
      "1105 -@- Dr 4600.000000 Cr 0.000000",
      "1105 USD@48 Dr 0.000000 Cr 4800.000000",
      "5900 -@- Dr 200.000000 Cr 0.000000",
    ]);
  });

  it("supplier loss (paid more base than booked): Cr 2100 base 4,830 / Dr 2100 USD 4,800 / Dr loss 30", () => {
    expect(shape(buildRealisedFxLines(input("purchase", "30"), accounts))).toEqual([
      "2100 -@- Dr 0.000000 Cr 4830.000000",
      "2100 USD@48 Dr 4800.000000 Cr 0.000000",
      "5900 -@- Dr 30.000000 Cr 0.000000",
    ]);
  });

  it("supplier gain (paid less base than booked): Cr 2100 base 4,770 / Dr 2100 USD 4,800 / Cr gain 30", () => {
    expect(shape(buildRealisedFxLines(input("purchase", "-30"), accounts))).toEqual([
      "2100 -@- Dr 0.000000 Cr 4770.000000",
      "2100 USD@48 Dr 4800.000000 Cr 0.000000",
      "4900 -@- Dr 0.000000 Cr 30.000000",
    ]);
  });

  it("EGP at the booked rate realises nothing but still moves the settled USD off the position (D260)", () => {
    expect(shape(buildRealisedFxLines(input("sales", "0"), accounts))).toEqual([
      "1105 -@- Dr 4800.000000 Cr 0.000000",
      "1105 USD@48 Dr 0.000000 Cr 4800.000000",
    ]);
  });

  it("USD money at another rate moves its own USD line and relieves the invoice's", () => {
    expect(shape(buildRealisedFxLines(input("sales", "200", { currency: "USD", fxRate: "50" }), accounts))).toEqual([
      "1105 USD@50 Dr 5000.000000 Cr 0.000000",
      "1105 USD@48 Dr 0.000000 Cr 4800.000000",
      "4900 -@- Dr 0.000000 Cr 200.000000",
    ]);
  });

  it("USD money at the booked rate already closed the position: no entry", () => {
    expect(buildRealisedFxLines(input("sales", "0", { currency: "USD", fxRate: "48.00" }), accounts)).toBeNull();
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

describe("deriveOpenFxBalances — a settlement in any currency closes the foreign amount it relieved (D260)", () => {
  const ar: Account = { id: "1105", code: "1105", nameAr: "عملاء", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" };
  const accounts = { gainAccountId: "4940", lossAccountId: "5940" };
  function line(entryId: string, debit: string, credit: string, currency: string | null, fxRate: string | null, memo: string | null = null): PostedLine {
    return { entryId, entryNo: null, date: "2026-08-26", accountId: "1105", debit: m(debit), credit: m(credit), memo, currency, fxRate, source: "system" } as unknown as PostedLine;
  }
  function settle(amount: string, relief: string, diff: string, total = "4800", rate = "48"): PostedLine[] {
    const lines = buildRealisedFxLines(
      {
        allocationId: `al-${amount}`,
        invoice: { id: "inv", invoiceNo: "INV-1", kind: "sales", partyId: "party", date: "2026-08-22", total: m(total), allocated: m("0") },
        split: { relief: m(relief), fxDifference: m(diff), capacity: m("0") },
        currency: "USD",
        invoiceRate: rate,
        money: { currency: "EGP", fxRate: null },
        date: "2026-08-26",
        controlAccountId: "1105",
        reference: "CV",
      },
      { gainAccountId: "4920", lossAccountId: "5920" },
    )!;
    return lines
      .filter((l) => l.accountId === "1105")
      .map((l) => line(`fxr-${amount}`, l.debit.toString(), l.credit.toString(), l.currency ?? null, l.fxRate ?? null, l.memo ?? null));
  }
  const closing = (rate: string) => ({ date: "2026-08-31", closingRates: new Map([["USD", rate]]), ...accounts });

  it("USD 100 at 48.00 paid in full by EGP 5,000 is no open position, so a 47.00 close proposes nothing", () => {
    const lines = [line("inv", "4800", "0", "USD", "48"), line("cv", "0", "5000", "EGP", null), ...settle("5000", "4800", "200")];
    const balances = deriveOpenFxBalances(lines, [ar]);
    expect(balances).toEqual([]);
    expect(computeFxRevaluation(balances, closing("47")).hasImpact).toBe(false);
  });

  it("paid half, it restates only the USD 50 still open", () => {
    const lines = [line("inv", "4800", "0", "USD", "48"), line("cv", "0", "2500", "EGP", null), ...settle("2500", "2400", "100")];
    const balances = deriveOpenFxBalances(lines, [ar]);
    expect(balances.map((b) => [b.foreignAmount.toString(), b.bookedBase.toString()])).toEqual([["50.000000", "2400.000000"]]);
    const result = computeFxRevaluation(balances, closing("47"));
    expect(result.details[0]?.delta.toString()).toBe("-50.000000");
    expect(result.totalLoss.toString()).toBe("50.000000");
  });

  it("the settlement undone — by hand, by a voucher reversal or a bounce — reopens the whole USD 100", () => {
    const settled = settle("5000", "4800", "200");
    const mirrored = settled.map((l) => ({ ...l, entryId: `${l.entryId}:REV`, debit: l.credit, credit: l.debit }));
    const lines = [line("inv", "4800", "0", "USD", "48"), line("cv", "0", "5000", "EGP", null), ...settled, ...mirrored, line("cv:rev", "5000", "0", "EGP", null)];
    const balances = deriveOpenFxBalances(lines, [ar]);
    expect(balances.map((b) => [b.foreignAmount.toString(), b.bookedBase.toString()])).toEqual([["100.000000", "4800.000000"]]);
  });

  it("an invoice relieved in parts at an awkward rate closes to the micro-unit", () => {
    const rate = "48.123457";
    const total = "4812.345701";
    const rates = { invoiceRate: rate, settlementRate: "50" };
    const first = settlementSplit(m("1000"), m(total), rates);
    const rest = Money.fromScaled(m(total).scaled - first.relief.scaled);
    const last = settlementSplit(settlementSplit(m("1"), rest, rates).capacity, rest, rates);
    expect(last.relief.toString()).toBe(rest.toString());
    const parts = [first, last].flatMap((split) =>
      settle(Money.fromScaled(split.relief.scaled + split.fxDifference.scaled).toString(), split.relief.toString(), split.fxDifference.toString(), total, rate),
    );
    expect(deriveOpenFxBalances([line("inv", total, "0", "USD", rate), ...parts], [ar])).toEqual([]);
  });

  it("a realised line posted before D260 still reads as base only", () => {
    const legacy = [line("inv", "4800", "0", "USD", "48"), line("cv", "0", "5000", "USD", "50"), line("fxr", "200", "0", "USD", "50", FX_REALISED_LINE_MEMO)];
    expect(deriveOpenFxBalances(legacy, [ar])).toEqual([]);
  });
});
