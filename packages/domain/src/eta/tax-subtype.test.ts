import { describe, expect, it } from "vitest";
import { resolveEtaVatSubType, findLineTaxRate, resolveLineTaxRate } from "./tax-subtype.js";

describe("resolveEtaVatSubType", () => {
  it("uses the sub-type the tax rate declares, whatever the rate is", () => {
    expect(resolveEtaVatSubType("V003", 0)).toBe("V003");
    expect(resolveEtaVatSubType("V001", 0)).toBe("V001");
    expect(resolveEtaVatSubType("V009", 14)).toBe("V009");
    expect(resolveEtaVatSubType("V002", 14)).toBe("V002");
  });

  it("falls back to basic sales tax for a taxed line when the rate says 'auto'", () => {
    expect(resolveEtaVatSubType("auto", 14)).toBe("V009");
    expect(resolveEtaVatSubType("auto", 5)).toBe("V009");
    expect(resolveEtaVatSubType("auto", 0.5)).toBe("V009");
  });

  it("falls back to not-subject for an untaxed line when the rate says 'auto'", () => {
    expect(resolveEtaVatSubType("auto", 0)).toBe("V004");
  });

  it("treats a missing configuration exactly as 'auto'", () => {
    expect(resolveEtaVatSubType(null, 14)).toBe("V009");
    expect(resolveEtaVatSubType(undefined, 14)).toBe("V009");
    expect(resolveEtaVatSubType("", 14)).toBe("V009");
    expect(resolveEtaVatSubType(null, 0)).toBe("V004");
    expect(resolveEtaVatSubType(undefined, 0)).toBe("V004");
    expect(resolveEtaVatSubType("", 0)).toBe("V004");
  });

  it("D79: an exempt line files V003 and a zero-rated export files V001, read off the rate each line stored", () => {
    const master = [
      { id: "EXEMPT", status: "active", rate: 0, etaSubType: "V003" },
      { id: "EXPORT", status: "active", rate: 0, etaSubType: "V001" },
    ];
    const subTypeOf = (taxRateId: string | null): string =>
      resolveEtaVatSubType(resolveLineTaxRate(master, { taxRateId, taxRatePercent: 0 })?.etaSubType, 0);

    expect(subTypeOf("EXEMPT")).toBe("V003");
    expect(subTypeOf("EXPORT")).toBe("V001");
    // Guards D79: only a line with NO stored id is still filed as the neutral V004.
    expect(subTypeOf(null)).toBe("V004");
  });

  it("never returns 'auto' itself, which the authority would reject", () => {
    for (const rate of [0, 0.1, 5, 14, 100]) {
      expect(resolveEtaVatSubType("auto", rate)).not.toBe("auto");
      expect(resolveEtaVatSubType(null, rate)).not.toBe("auto");
    }
  });

  it("treats a negative rate as untaxed rather than as a taxed line", () => {
    expect(resolveEtaVatSubType("auto", -14)).toBe("V004");
  });
});

describe("resolveLineTaxRate — the stored id decides, the percent only for a line without one (D79)", () => {
  const master = [
    { id: "VAT14", status: "active", rate: 14, etaSubType: "V009" },
    { id: "EXEMPT", status: "active", rate: 0, etaSubType: "V003" },
    { id: "EXPORT", status: "active", rate: 0, etaSubType: "V001" },
    { id: "OLD-EXPORT", status: "inactive", rate: 0, etaSubType: "V002" },
  ];

  it("reads the rate the line stored, whichever other rates share its percent", () => {
    expect(resolveLineTaxRate(master, { taxRateId: "EXEMPT", taxRatePercent: 0 })?.etaSubType).toBe("V003");
    expect(resolveLineTaxRate(master, { taxRateId: "EXPORT", taxRatePercent: 0 })?.etaSubType).toBe("V001");
  });

  it("still answers for a rate deactivated after the line was posted", () => {
    expect(resolveLineTaxRate(master, { taxRateId: "OLD-EXPORT", taxRatePercent: 0 })?.etaSubType).toBe("V002");
  });

  it("matches the percent for a legacy line with no stored id", () => {
    expect(resolveLineTaxRate(master, { taxRateId: null, taxRatePercent: 14 })?.id).toBe("VAT14");
    expect(resolveLineTaxRate(master, { taxRatePercent: 14 })?.id).toBe("VAT14");
  });

  it("refuses to guess for a legacy 0% line when exempt and export are both configured", () => {
    expect(resolveLineTaxRate(master, { taxRateId: null, taxRatePercent: 0 })).toBeNull();
  });

  it("falls back to the percent when the stored id names a row that no longer exists", () => {
    expect(resolveLineTaxRate(master, { taxRateId: "GONE", taxRatePercent: 14 })?.id).toBe("VAT14");
  });
});

describe("findLineTaxRate — the rate value cannot decide a classification (D79)", () => {
  const rate = (etaSubType: string, r = 0, status = "active") => ({ status, rate: r, etaSubType });

  it("returns the rate when exactly one active rate carries the value", () => {
    const found = findLineTaxRate([rate("V003"), rate("V009", 14)], 14);
    expect(found?.etaSubType).toBe("V009");
  });

  it("refuses to choose between exempt and export, which are both 0% and not interchangeable", () => {
    // «معفى» V003 and «تصدير» V001 are both zero-rated. Picking the first
    // defined one filed an exempt sale as an export, and a tenant whose rates
    // were created in the other order got the opposite answer.
    expect(findLineTaxRate([rate("V003"), rate("V001")], 0)).toBeNull();
  });

  it("still answers above 0% when several rates at the percent all classify the same way — the ambiguity is only in the name", () => {
    const found = findLineTaxRate([rate("V009", 14), rate("V009", 14)], 14);
    expect(found?.etaSubType).toBe("V009");
    expect(findLineTaxRate([rate("V009", 14), rate("V010", 14)], 14)).toBeNull();
  });

  it("ignores an inactive rate, so a retired classification cannot make the live one ambiguous", () => {
    const found = findLineTaxRate([rate("V010", 14, "inactive"), rate("V009", 14)], 14);
    expect(found?.etaSubType).toBe("V009");
  });

  it("infers nothing at 0%, even when exactly one active 0% rate exists or every 0% rate classifies the same way", () => {
    expect(findLineTaxRate([rate("V003")], 0)).toBeNull();
    expect(findLineTaxRate([rate("V003"), rate("V003")], 0)).toBeNull();
    expect(findLineTaxRate([rate("V001", 0, "inactive"), rate("V003")], 0)).toBeNull();
    expect(resolveEtaVatSubType(findLineTaxRate([rate("V003")], 0)?.etaSubType, 0)).toBe("V004");
  });

  it("returns null when nothing matches, rather than the nearest rate", () => {
    expect(findLineTaxRate([rate("V009", 14)], 5)).toBeNull();
  });

  it("falls back to the neutral V004 when the classification is ambiguous, never to a specific claim", () => {
    const ambiguous = findLineTaxRate([rate("V003"), rate("V001")], 0);
    expect(resolveEtaVatSubType(ambiguous?.etaSubType, 0)).toBe("V004");
  });
});
