import { describe, expect, it } from "vitest";
import { Money, Qty } from "../../money/index.js";
import { computeCertificate } from "../certificates/amounts.js";
import {
  computeSubcontractClientValue,
  computeSubcontractValue,
  lineMarginVsClient,
  subcontractCertificateTerms,
} from "./amounts.js";
import type { SubcontractTerms } from "./subcontract.js";

const TERMS: SubcontractTerms = {
  retentionPercent: "5",
  retentionCapPercent: null,
  advancePercent: "10",
  advanceRecoveryPercent: "10",
  withholdingTaxPercent: "1",
  deemedWagePercent: "20",
  socialInsuranceRatePercent: "18.75",
  withholdSocialInsurance: false,
  socialInsuranceNote: null,
  penaltyCapPercent: "10",
  paymentTermDays: 30,
  defectsLiabilityMonths: 12,
  vatBasis: "standard",
};

function line(qty: string, rate: string, clientRate: string) {
  return { qty: Qty.fromMajor(qty), unitRate: Money.fromMajor(rate), clientUnitRate: Money.fromMajor(clientRate) };
}

describe("subcontract amounts", () => {
  it("values the package at the sub's rates and the same work at the client's", () => {
    const lines = [line("12000", "140", "185"), line("1450", "1650", "1980")];
    expect(computeSubcontractValue(lines).toString()).toBe("4072500.000000");
    expect(computeSubcontractClientValue(lines).toString()).toBe("5091000.000000");
  });

  it("reports a negative margin rather than hiding it", () => {
    expect(lineMarginVsClient(Money.fromMajor("140"), Money.fromMajor("185")).toString()).toBe("-45.000000");
  });

  it("collapses التأمينات to zero when the contractor does not withhold it", () => {
    const off = subcontractCertificateTerms(TERMS);
    expect(off.deemedWagePercent).toBe("0");
    expect(off.socialInsuranceRatePercent).toBe("0");
    const on = subcontractCertificateTerms({ ...TERMS, withholdSocialInsurance: true });
    expect(on.deemedWagePercent).toBe("20");
    expect(on.socialInsuranceRatePercent).toBe("18.75");
  });

  it("carries no tender discount and no stamp duty — both are the employer's, not the sub's", () => {
    const terms = subcontractCertificateTerms(TERMS);
    expect(terms.tenderDiscountPercent).toBe("0");
    expect(terms.stampDutyPercent).toBe("0");
  });

  /**
   * The whole point of the mirror: the sub certificate reuses the client
   * certificate's block, so the cumulative-then-difference rule has exactly one
   * implementation. These are the figures SMST-DEMO-2 produces in the seed.
   */
  it("differences the second certificate against the first, cumulatively", () => {
    const terms = subcontractCertificateTerms(TERMS);
    const work = (cumulativeValue: string) => ({
      id: "w",
      boqLineId: "l",
      code: "1",
      descriptionAr: "بند",
      unit: "m3" as const,
      unitRate: Money.fromMajor("140"),
      thisPeriodQty: Qty.zero(),
      previousCumulativeQty: Qty.zero(),
      cumulativeQty: Qty.zero(),
      contractedQty: Qty.fromMajor("12000"),
      completionPercent: "0.0",
      previousCumulativeValue: Money.zero(),
      cumulativeValue: Money.fromMajor(cumulativeValue),
      thisPeriodValue: Money.zero(),
      sortOrder: 1,
    });
    const manual = {
      penalties: Money.zero(),
      suspended: Money.zero(),
      employerMaterials: Money.zero(),
      waterElectricity: Money.zero(),
    };
    const first = computeCertificate({
      terms,
      workLines: [work("243000")],
      materialLines: [],
      manual,
      previous: null,
      contractValueAfterVariations: Money.fromMajor("4072500"),
      advanceReceived: Money.fromMajor("150000"),
      advanceOutstanding: Money.fromMajor("150000"),
    });
    expect(first.deductionsThisCertificate.toString()).toBe("38880.000000");
    expect(first.netPayableThisCertificate.toString()).toBe("238140.000000");

    const second = computeCertificate({
      terms,
      workLines: [work("524000")],
      materialLines: [],
      manual,
      previous: first,
      contractValueAfterVariations: Money.fromMajor("4072500"),
      advanceReceived: Money.fromMajor("150000"),
      advanceOutstanding: Money.fromMajor("97600"),
    });
    expect(second.thisCertificateNetCertified.toString()).toBe("281000.000000");
    expect(second.deductionsThisCertificate.toString()).toBe("44960.000000");
    expect(second.netPayableThisCertificate.toString()).toBe("275380.000000");
    const retention = second.deductions.find((d) => d.key === "retention");
    expect(retention?.cumulative.toString()).toBe("26200.000000");
    expect(retention?.thisCertificate.toString()).toBe("14050.000000");
  });

  it("caps the advance recovery at what was actually paid to the sub", () => {
    const terms = subcontractCertificateTerms({ ...TERMS, advanceRecoveryPercent: "50" });
    const computed = computeCertificate({
      terms,
      workLines: [
        {
          id: "w",
          boqLineId: "l",
          code: "1",
          descriptionAr: "بند",
          unit: "m3",
          unitRate: Money.fromMajor("100"),
          thisPeriodQty: Qty.zero(),
          previousCumulativeQty: Qty.zero(),
          cumulativeQty: Qty.zero(),
          contractedQty: Qty.fromMajor("100"),
          completionPercent: "0.0",
          previousCumulativeValue: Money.zero(),
          cumulativeValue: Money.fromMajor("100000"),
          thisPeriodValue: Money.zero(),
          sortOrder: 1,
        },
      ],
      materialLines: [],
      manual: {
        penalties: Money.zero(),
        suspended: Money.zero(),
        employerMaterials: Money.zero(),
        waterElectricity: Money.zero(),
      },
      previous: null,
      contractValueAfterVariations: Money.fromMajor("100000"),
      advanceReceived: Money.fromMajor("10000"),
      advanceOutstanding: Money.fromMajor("10000"),
    });
    const advance = computed.deductions.find((d) => d.key === "advanceRecovery");
    expect(advance?.cumulative.toString()).toBe("10000.000000");
    expect(advance?.capped).toBe(true);
  });
});
