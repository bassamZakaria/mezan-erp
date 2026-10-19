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
import { isZeroRatedLineUnclassified, lineTaxPercent } from "./tax-subtype.js";

const rate = (id: string, percent: number, etaSubType: string, status = "active") => ({ id, rate: percent, etaSubType, status });
const VAT = rate("VAT14", 14, "V009");
const EXEMPT = rate("EXEMPT", 0, "V003");
const EXPORT = rate("EXPORT", 0, "V001");

const NOT_SUBJECT = rate("NOT-SUBJECT", 0, "V004");
const AUTO_ZERO = rate("ZERO-AUTO", 0, "auto");

describe("isZeroRatedLineUnclassified", () => {
  it("is true for a 0% line with no stored rate once the tenant holds ANY specific zero classification — one is enough", () => {
    expect(isZeroRatedLineUnclassified([VAT, EXEMPT], { taxRateId: null, taxRatePercent: 0 })).toBe(true);
    expect(isZeroRatedLineUnclassified([VAT, EXPORT], { taxRatePercent: 0 })).toBe(true);
    expect(isZeroRatedLineUnclassified([VAT, EXEMPT, EXPORT], { taxRateId: null, taxRatePercent: 0 })).toBe(true);
  });

  it("is false once the line names its rate", () => {
    expect(isZeroRatedLineUnclassified([VAT, EXEMPT, EXPORT], { taxRateId: "EXEMPT", taxRatePercent: 0 })).toBe(false);
  });

  it("is false when the tenant holds no specific zero classification, when its only one is inactive, and for a taxed line", () => {
    expect(isZeroRatedLineUnclassified([VAT], { taxRateId: null, taxRatePercent: 0 })).toBe(false);
    expect(isZeroRatedLineUnclassified([VAT, NOT_SUBJECT, AUTO_ZERO], { taxRateId: null, taxRatePercent: 0 })).toBe(false);
    expect(isZeroRatedLineUnclassified([rate("EXPORT", 0, "V001", "inactive")], { taxRateId: null, taxRatePercent: 0 })).toBe(false);
    expect(isZeroRatedLineUnclassified([VAT, EXEMPT, EXPORT], { taxRateId: null, taxRatePercent: 14 })).toBe(false);
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
    taxClassificationMissing: false,
    netTotal: "100",
    taxAmount: "0",
    ...overrides,
  });
  const findingsFor = (l: EtaPrevalidationLineInput) =>
    prevalidateEtaInvoice(
      { branchCode: "1", receiver: { type: "B", registrationNumber: "300112233", customerId: "c1" }, lines: [l], totalNet: "100", totalTax: "0", totalAmount: "100" },
      config,
    ).filter((f) => f.code === EtaPrevalidationRuleCode.TaxSubtypeNotMapped);

  it("BLOCKS submission when the tenant holds a specific zero classification and the line names no rate", () => {
    const findings = findingsFor(line({ taxClassificationMissing: true }));
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

  it("BLOCKS a line whose tax percent is unknown instead of filing it at 0% (D79)", () => {
    const findings = findingsFor(line({ taxRateUnknown: true, lineRef: "L3" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: EtaPrevalidationSeverity.Blocking, fixRefId: "L3" });
    expect(findings[0]?.messageAr).toContain("0%");
  });

  it("reads a missing percent off the rate the line names, and answers null — never 0 — when it names none", () => {
    const rates = [{ id: "EXEMPT", rate: 0 }, { id: "VAT14", rate: 14 }];
    expect(lineTaxPercent(rates, { taxRateId: "VAT14", taxRatePercent: null })).toBe(14);
    expect(lineTaxPercent(rates, { taxRateId: "EXEMPT" })).toBe(0);
    expect(lineTaxPercent(rates, { taxRateId: null, taxRatePercent: null })).toBeNull();
    expect(lineTaxPercent(rates, { taxRateId: "GONE", taxRatePercent: undefined })).toBeNull();
    expect(lineTaxPercent(rates, { taxRateId: "VAT14", taxRatePercent: 5 })).toBe(5);
  });

  it("points the blocking finding at the LINE, so the screen can open «تصنيف ضريبة البند» on it", () => {
    const [found] = findingsFor(line({ taxClassificationMissing: true, lineRef: "L7" }));
    expect(found?.fixRefId).toBe("L7");
  });

  it("warns about an unnamed 0% line on the DOCUMENT and offers the classify action, when the tenant has no specific 0% rate", () => {
    const [found] = findingsFor(line({ lineRef: "L7" }));
    expect(found).toMatchObject({ severity: EtaPrevalidationSeverity.Warning, fixScreen: EtaPrevalidationFixScreen.SourceDocument, fixRefId: "L7" });
    expect(found?.fixHintAr).toContain("تصنيف ضريبة البند");
  });

  it("still sends a line whose NAMED rate carries the automatic sub-type to the tax rates screen", () => {
    const [found] = findingsFor(line({ etaTaxSubType: "auto", lineRef: "L7" }));
    expect(found).toMatchObject({ severity: EtaPrevalidationSeverity.Warning, fixScreen: EtaPrevalidationFixScreen.TaxRates });
    expect(found?.fixRefId ?? null).toBeNull();
  });

  it("raises nothing for a 0% line that stored its classified rate", () => {
    expect(findingsFor(line({ etaTaxSubType: "V003" }))).toEqual([]);
  });
});
