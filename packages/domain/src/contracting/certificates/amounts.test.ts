import { describe, expect, it } from "vitest";
import { Money, Qty } from "../../money/index.js";
import type { WorksContractTerms } from "../contracts/contract.js";
import type { CertificateComputation, CertificateMaterialLine, CertificateWorkLine } from "./certificate.js";
import { completionPercentOf, computeCertificate, extendQty, percentOf, vatEffectiveRatePercent } from "./amounts.js";

const TERMS: Pick<
  WorksContractTerms,
  | "tenderDiscountPercent"
  | "retentionPercent"
  | "retentionCapPercent"
  | "advanceRecoveryPercent"
  | "deemedWagePercent"
  | "socialInsuranceRatePercent"
  | "withholdingTaxPercent"
  | "stampDutyPercent"
  | "vatBasis"
> = {
  tenderDiscountPercent: "4.5",
  retentionPercent: "5",
  retentionCapPercent: null,
  advanceRecoveryPercent: "10",
  deemedWagePercent: "20",
  socialInsuranceRatePercent: "18.75",
  withholdingTaxPercent: "1",
  stampDutyPercent: "0",
  vatBasis: "standard",
};

function workLine(cumulativeQty: string, unitRate: string, previousCumulativeValue = "0"): CertificateWorkLine {
  const qty = Qty.fromMajor(cumulativeQty);
  const rate = Money.fromMajor(unitRate);
  const cumulativeValue = extendQty(qty, rate);
  return {
    id: "W1",
    boqLineId: "B1",
    code: "1",
    descriptionAr: "أعمال الحفر والردم",
    unit: "m3",
    unitRate: rate,
    thisPeriodQty: qty,
    previousCumulativeQty: Qty.zero(),
    cumulativeQty: qty,
    contractedQty: Qty.fromMajor("12000"),
    completionPercent: completionPercentOf(qty, Qty.fromMajor("12000")),
    previousCumulativeValue: Money.fromMajor(previousCumulativeValue),
    cumulativeValue,
    thisPeriodValue: Money.fromScaled(cumulativeValue.scaled - Money.fromMajor(previousCumulativeValue).scaled),
    sortOrder: 1,
  };
}

function materialLine(cumulativeQty: string, unitRate: string, percent: string): CertificateMaterialLine {
  const qty = Qty.fromMajor(cumulativeQty);
  const rate = Money.fromMajor(unitRate);
  return {
    id: "M1",
    materialKey: "REBAR",
    descriptionAr: "حديد تسليح",
    unit: "ton",
    qty,
    unitRate: rate,
    previousCumulativeQty: Qty.zero(),
    cumulativeQty: qty,
    value: percentOf(extendQty(qty, rate), percent),
    previousValue: Money.zero(),
    sortOrder: 1,
  };
}

const NO_MANUAL = {
  penalties: Money.zero(),
  suspended: Money.zero(),
  employerMaterials: Money.zero(),
  waterElectricity: Money.zero(),
};

function compute(
  workLines: CertificateWorkLine[],
  previous: CertificateComputation | null,
  overrides: Partial<Parameters<typeof computeCertificate>[0]> = {},
): CertificateComputation {
  return computeCertificate({
    terms: TERMS,
    workLines,
    materialLines: [],
    manual: NO_MANUAL,
    previous,
    contractValueAfterVariations: Money.fromMajor("24940000"),
    advanceReceived: Money.fromMajor("60000"),
    advanceOutstanding: Money.fromMajor("60000"),
    ...overrides,
  });
}

describe("certificate arithmetic", () => {
  it("nets the tender discount off the certificate total before any deduction", () => {
    const computed = compute([workLine("1600", "185")], null);
    expect(computed.certificateTotal.toString()).toBe("296000.000000");
    expect(computed.tenderDiscount.toString()).toBe("13320.000000");
    expect(computed.netCertified.toString()).toBe("282680.000000");
  });

  it("certifies materials on site at the contract's own percentage", () => {
    const computed = computeCertificate({
      terms: TERMS,
      workLines: [],
      materialLines: [materialLine("18.35", "46500", "75")],
      manual: NO_MANUAL,
      previous: null,
      contractValueAfterVariations: Money.fromMajor("24940000"),
      advanceReceived: Money.zero(),
      advanceOutstanding: Money.zero(),
    });
    // 18.35 × 46,500 = 853,275 → 75% = 639,956.25
    expect(computed.materialsOnSite.toString()).toBe("639956.250000");
  });

  it("carries cumulative → delta across three certificates so every figure ties", () => {
    const first = compute([workLine("1600", "185")], null);
    const second = compute([workLine("2800", "185", "296000")], first);
    const third = compute([workLine("4000", "185", "518000")], second);

    // Each certificate's own net certified is the difference of two snapshots.
    expect(second.previousNetCertified.toString()).toBe(first.netCertified.toString());
    expect(third.previousNetCertified.toString()).toBe(second.netCertified.toString());
    expect(
      Money.sum([
        first.thisCertificateNetCertified,
        second.thisCertificateNetCertified,
        third.thisCertificateNetCertified,
      ]).toString(),
    ).toBe(third.netCertified.toString());

    // الدفعات السابقة is the previous certificate's cumulative net payable.
    expect(third.previousPayments.toString()).toBe(second.cumulativeNetPayable.toString());
    expect(third.cumulativeNetPayable.toString()).toBe(
      Money.sum([
        first.netPayableThisCertificate,
        second.netPayableThisCertificate,
        third.netPayableThisCertificate,
      ]).toString(),
    );

    // And every deduction's cumulative column equals the sum of its deltas.
    for (const key of ["retention", "advanceRecovery", "socialInsurance", "withholdingTax"] as const) {
      const deltas = [first, second, third].map((c) => c.deductions.find((d) => d.key === key)!.thisCertificate);
      expect(Money.sum(deltas).toString()).toBe(
        third.deductions.find((d) => d.key === key)!.cumulative.toString(),
      );
    }
  });

  it("computes social insurance as deemed wage × employer rate, once, at the named boundary", () => {
    const computed = compute([workLine("1600", "185")], null);
    const row = computed.deductions.find((d) => d.key === "socialInsurance")!;
    // 20% × 18.75% = 3.75% of 282,680
    expect(row.percent).toBe("3.750000");
    expect(row.cumulative.toString()).toBe("10600.500000");
  });

  it("caps cumulative retention at the contract's ceiling, forward only (D-08)", () => {
    const capped = compute([workLine("4000", "185")], null, {
      terms: { ...TERMS, retentionCapPercent: "0.1" },
      contractValueAfterVariations: Money.fromMajor("24940000"),
    });
    const row = capped.deductions.find((d) => d.key === "retention")!;
    expect(row.capped).toBe(true);
    // 0.1% of 24,940,000 = 24,940 — below the 5% the certificate would otherwise carry.
    expect(row.cumulative.toString()).toBe("24940.000000");
  });

  it("withholds NOTHING on a public contract secured by a تأمين نهائي letter, and says why", () => {
    const publicContract = compute([workLine("1600", "185")], null, {
      contractType: "public",
      finalSecurityPercent: "5",
    });
    const row = publicContract.deductions.find((d) => d.key === "retention")!;
    expect(row.cumulative.toString()).toBe("0.000000");
    expect(row.thisCertificate.toString()).toBe("0.000000");
    expect(row.percent).toBe("0");
    expect(row.noteAr).toBe("تأمين نهائي بخطاب ضمان");
    expect(publicContract.retentionHeldCumulative.toString()).toBe("0.000000");

    // Every other deduction is untouched, and the money not retained is payable.
    const privateContract = compute([workLine("1600", "185")], null);
    const retained = privateContract.deductions.find((d) => d.key === "retention")!;
    expect(retained.cumulative.toString()).toBe("14134.000000");
    expect(retained.noteAr).toBeNull();
    expect(
      publicContract.netPayableThisCertificate.scaled - privateContract.netPayableThisCertificate.scaled,
    ).toBe(retained.cumulative.scaled);
  });

  it("keeps the cash retention on a public contract whose تأمين نهائي is zero", () => {
    const computed = compute([workLine("1600", "185")], null, {
      contractType: "public",
      finalSecurityPercent: "0",
    });
    const row = computed.deductions.find((d) => d.key === "retention")!;
    expect(row.cumulative.toString()).toBe("14134.000000");
    expect(row.noteAr).toBeNull();
  });

  it("never recovers more advance than was actually received", () => {
    const computed = compute([workLine("4000", "185")], null, {
      advanceReceived: Money.fromMajor("60000"),
    });
    const row = computed.deductions.find((d) => d.key === "advanceRecovery")!;
    expect(row.capped).toBe(true);
    expect(row.cumulative.toString()).toBe("60000.000000");
  });

  it("adds VAT at 14% on the standard basis and 5.04% on the transitional one", () => {
    expect(vatEffectiveRatePercent("standard")).toBe("14");
    expect(vatEffectiveRatePercent("transitional")).toBe("5.040000");

    const standard = compute([workLine("1600", "185")], null);
    expect(standard.vat.toString()).toBe("39575.200000");

    const transitional = compute([workLine("1600", "185")], null, {
      terms: { ...TERMS, vatBasis: "transitional" },
    });
    // 14% × 36% × 282,680 = 14,247.07
    expect(transitional.vat.toString()).toBe("14247.070000");
    expect(transitional.vatStatutoryRatePercent).toBe("14");
  });

  it("excludes التعليات from the invoiced base and releases it when it falls", () => {
    const held = compute([workLine("1600", "185")], null, {
      manual: { ...NO_MANUAL, suspended: Money.fromMajor("25000") },
    });
    expect(held.invoiceBase.toString()).toBe("257680.000000");
    expect(held.suspendedBalance.toString()).toBe("25000.000000");
    // التعليات never reaches the ledger — it is withheld, not taken.
    expect(held.deductions.find((d) => d.key === "suspended")!.posted).toBe(false);

    const released = compute([workLine("2800", "185", "296000")], held, {
      manual: { ...NO_MANUAL, suspended: Money.fromMajor("10000") },
    });
    // The 15,000 released is added back into the second certificate's base.
    expect(released.invoiceBase.toString()).toBe(
      Money.fromScaled(released.thisCertificateNetCertified.scaled + 15_000_000_000n).toString(),
    );
  });

  it("reads the completion percentage off cumulative ÷ contracted", () => {
    expect(completionPercentOf(Qty.fromMajor("10200"), Qty.fromMajor("12000"))).toBe("85.0");
    expect(completionPercentOf(Qty.fromMajor("0"), Qty.fromMajor("0"))).toBe("0.0");
  });
});
