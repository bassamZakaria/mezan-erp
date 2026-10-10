import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_CONFIG } from "./config.js";
import {
  EtaPrevalidationFixScreen,
  EtaPrevalidationRuleCode,
  EtaPrevalidationSeverity,
  hasBlockingEtaFindings,
  prevalidateEtaInvoice,
  type EtaPrevalidationLineInput,
} from "./prevalidate.js";
import { isZeroRatedClassificationAmbiguous } from "./tax-subtype.js";

const rate = (id: string, percent: number, etaSubType: string, status = "active") => ({ id, rate: percent, etaSubType, status });
const VAT = rate("VAT14", 14, "V009");
const EXEMPT = rate("EXEMPT", 0, "V003");
const EXPORT = rate("EXPORT", 0, "V001");

describe("isZeroRatedClassificationAmbiguous", () => {
  it("is true for a 0% line with no stored rate when the tenant holds two 0% classifications", () => {
    expect(isZeroRatedClassificationAmbiguous([VAT, EXEMPT, EXPORT], { taxRateId: null, taxRatePercent: 0 })).toBe(true);
  });

  it("is false once the line names its rate", () => {
    expect(isZeroRatedClassificationAmbiguous([VAT, EXEMPT, EXPORT], { taxRateId: "EXEMPT", taxRatePercent: 0 })).toBe(false);
  });

  it("is false with one 0% classification, with none, when the second is inactive, and for a taxed line", () => {
    expect(isZeroRatedClassificationAmbiguous([VAT, EXEMPT], { taxRateId: null, taxRatePercent: 0 })).toBe(false);
    expect(isZeroRatedClassificationAmbiguous([VAT], { taxRateId: null, taxRatePercent: 0 })).toBe(false);
    expect(isZeroRatedClassificationAmbiguous([EXEMPT, rate("EXPORT", 0, "V001", "inactive")], { taxRateId: null, taxRatePercent: 0 })).toBe(false);
    expect(isZeroRatedClassificationAmbiguous([VAT, EXEMPT, EXPORT], { taxRateId: null, taxRatePercent: 14 })).toBe(false);
  });
});

describe("prevalidateEtaInvoice — a 0% line nobody classified (D79)", () => {
  const config = { ...DEFAULT_ETA_CONFIG, taxRegistrationNumber: "100200300", activityCode: "4610" };
  const line = (overrides: Partial<EtaPrevalidationLineInput>): EtaPrevalidationLineInput => ({
    itemId: "item-1",
    itemLabel: "خدمة",
    itemCode: "EG-1",
    itemCodeType: "EGS",
    unitCode: "PCS",
    etaUnitCode: "EA",
    taxRatePercent: 0,
    etaTaxSubType: null,
    taxClassificationAmbiguous: false,
    netTotal: "100",
    taxAmount: "0",
    ...overrides,
  });
  const findingsFor = (l: EtaPrevalidationLineInput) =>
    prevalidateEtaInvoice(
      { branchCode: "1", receiver: { type: "B", registrationNumber: "300112233", customerId: "c1" }, lines: [l], totalNet: "100", totalTax: "0", totalAmount: "100" },
      config,
    ).filter((f) => f.code === EtaPrevalidationRuleCode.TaxSubtypeNotMapped);

  it("BLOCKS submission when the tenant holds more than one 0% classification and the line names none", () => {
    const findings = findingsFor(line({ taxClassificationAmbiguous: true }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: EtaPrevalidationSeverity.Blocking, fixScreen: EtaPrevalidationFixScreen.SourceDocument });
    expect(findings[0]?.messageAr).toMatch(/[؀-ۿ]/);
    expect(hasBlockingEtaFindings(findings)).toBe(true);
  });

  it("only warns when there is nothing to choose between — the line files as not-subject", () => {
    const findings = findingsFor(line({}));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe(EtaPrevalidationSeverity.Warning);
    expect(hasBlockingEtaFindings(findings)).toBe(false);
  });

  it("raises nothing for a 0% line that stored its classified rate", () => {
    expect(findingsFor(line({ etaTaxSubType: "V003" }))).toEqual([]);
  });
});
