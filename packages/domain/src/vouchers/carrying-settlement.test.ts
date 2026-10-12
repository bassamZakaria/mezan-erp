import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { FX_REVALUATION_LINE_MEMO } from "../fx-revaluation/revaluation.js";
import { settlementSplit, type AllocatableInvoice } from "./allocation.js";
import { buildRealisedFxLines, FX_REALISED_LINE_MEMO, type RealisedFxPostingInput } from "./realised-fx.js";

const m = (v: string) => Money.fromMajor(v);

describe("settlementSplit — a revalued invoice is relieved at what it is carried at", () => {
  it("USD 1,000 booked at 48.00, restated by +450 and settled at 48.70: 450 of the 700 was already recognised, 250 is realised", () => {
    const split = settlementSplit(m("48700"), m("48000"), { invoiceRate: "48", settlementRate: "48.70" }, m("450"));
    expect(split.relief.toString()).toBe("48000.000000");
    expect(split.revaluationShare?.toString()).toBe("450.000000");
    expect(split.fxDifference.toString()).toBe("250.000000");
  });

  it("USD 400 of it takes 180 of the restatement and the rest takes the other 270", () => {
    const rates = { invoiceRate: "48", settlementRate: "48.70" };
    const first = settlementSplit(m("19480"), m("48000"), rates, m("450"));
    expect([first.relief.toString(), first.revaluationShare?.toString(), first.fxDifference.toString()]).toEqual(["19200.000000", "180.000000", "100.000000"]);
    const last = settlementSplit(m("29220"), m("28800"), rates, m("270"));
    expect([last.relief.toString(), last.revaluationShare?.toString(), last.fxDifference.toString()]).toEqual(["28800.000000", "270.000000", "150.000000"]);
  });

  it("a downward restatement of 450 settled lower still is a realised loss of 250, not 700", () => {
    const split = settlementSplit(m("47300"), m("48000"), { invoiceRate: "48", settlementRate: "47.30" }, m("-450"));
    expect(split.revaluationShare?.toString()).toBe("-450.000000");
    expect(split.fxDifference.toString()).toBe("-250.000000");
  });

  it("settled at the booked rate the restatement still comes off, as a realised difference the other way", () => {
    const split = settlementSplit(m("48000"), m("48000"), { invoiceRate: "48", settlementRate: "48.00" }, m("450"));
    expect([split.relief.toString(), split.revaluationShare?.toString(), split.fxDifference.toString()]).toEqual(["48000.000000", "450.000000", "-450.000000"]);
  });

  it("three uneven parts consume the whole restatement to the micro-unit", () => {
    const rates = { invoiceRate: "48.123457", settlementRate: "49.5" };
    let outstanding = m("1000.000001");
    let unconsumed = m("100.000001");
    let consumed = 0n;
    for (const amount of ["333.33", "333.33"]) {
      const part = settlementSplit(m(amount), outstanding, rates, unconsumed);
      outstanding = Money.fromScaled(outstanding.scaled - part.relief.scaled);
      unconsumed = Money.fromScaled(unconsumed.scaled - (part.revaluationShare?.scaled ?? 0n));
      consumed += part.revaluationShare?.scaled ?? 0n;
    }
    const rest = settlementSplit(settlementSplit(m("1"), outstanding, rates, unconsumed).capacity, outstanding, rates, unconsumed);
    expect(rest.relief.toString()).toBe(outstanding.toString());
    expect((consumed + (rest.revaluationShare?.scaled ?? 0n)).toString()).toBe(m("100.000001").scaled.toString());
  });
});

describe("buildRealisedFxLines — the restatement a settlement consumes leaves the control account with it", () => {
  function input(kind: "sales" | "purchase", share: string, diff: string, amount: string): RealisedFxPostingInput {
    const invoice: AllocatableInvoice = { id: "inv", invoiceNo: "INV-1", kind, partyId: "party", date: "2026-08-22", total: m("48000"), allocated: m("0") };
    return {
      allocationId: "al",
      invoice,
      split: { relief: m("48000"), revaluationShare: m(share), fxDifference: m(diff), capacity: m(amount) },
      currency: "USD",
      invoiceRate: "48",
      money: { currency: "EGP", fxRate: null },
      date: "2026-09-10",
      controlAccountId: kind === "sales" ? "1105" : "2100",
      reference: "CV-1",
    };
  }
  const accounts = { gainAccountId: "4920", lossAccountId: "5920" };
  const shape = (lines: ReturnType<typeof buildRealisedFxLines>) =>
    lines!.map((l) => `${l.accountId} ${l.currency ?? "-"}@${l.fxRate ?? "-"} Dr ${l.debit.toString()} Cr ${l.credit.toString()} ${l.memo}`);

  it("customer: Dr 1105 48,700 / Cr 1105 USD 48,000 / Cr 1105 the 450 restatement / Cr gain 250", () => {
    const lines = buildRealisedFxLines(input("sales", "450", "250", "48700"), accounts)!;
    expect(shape(lines).slice(2)).toEqual([
      `1105 USD@48 Dr 0.000000 Cr 450.000000 ${FX_REVALUATION_LINE_MEMO}`,
      `4920 -@- Dr 0.000000 Cr 250.000000 ${FX_REALISED_LINE_MEMO}`,
    ]);
    expect(lines[0]?.debit.toString()).toBe("48700.000000");
    expect(lines[2]?.partyId).toBe("party");
  });

  it("supplier: a payable restated down by 450 and paid at 47,300 is Cr 2100 47,300 / Dr 2100 USD 48,000 / Cr 2100 450 / Cr gain 250", () => {
    const lines = buildRealisedFxLines(input("purchase", "-450", "-250", "47300"), accounts)!;
    expect(shape(lines)).toEqual([
      "2100 -@- Dr 0.000000 Cr 47300.000000 تسوية فاتورة بعملة أجنبية",
      "2100 USD@48 Dr 48000.000000 Cr 0.000000 تسوية فاتورة بعملة أجنبية",
      `2100 USD@48 Dr 0.000000 Cr 450.000000 ${FX_REVALUATION_LINE_MEMO}`,
      `4920 -@- Dr 0.000000 Cr 250.000000 ${FX_REALISED_LINE_MEMO}`,
    ]);
    const net = lines.reduce((sum, l) => sum + l.debit.scaled - l.credit.scaled, 0n);
    expect(net).toBe(0n);
  });
});
