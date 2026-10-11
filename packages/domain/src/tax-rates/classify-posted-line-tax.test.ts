import { describe, expect, it } from "vitest";
import {
  planTaxClassification,
  PostedLineNotFoundError,
  TaxClassificationSharedPostingError,
  type PostedTaxLine,
} from "./classify-posted-line-tax.js";
import {
  InactiveTaxRateError,
  TaxRateAlreadyClassifiedError,
  TaxRateClassificationPercentError,
  TaxRateNotFoundError,
  TaxRateUnverifiableError,
} from "./errors.js";
import { TaxRateStatusCode, type TaxRateStatus } from "./tax-rate.js";

const rate = (id: string, percent: number, status: TaxRateStatus = TaxRateStatusCode.Active) => ({ id, name: `ضريبة ${id}`, rate: percent, status });
const MASTER = [rate("VAT14", 14), rate("VAT14B", 14), rate("EXEMPT", 0), rate("EXPORT", 0), rate("OLD0", 0, TaxRateStatusCode.Inactive)];

const line = (lineRef: string, taxRatePercent: number, taxRateId: string | null = null): PostedTaxLine => ({
  lineRef,
  label: `بند ${lineRef}`,
  stored: { taxRateId, taxRatePercent },
});

describe("planTaxClassification — naming the rate of a posted line that stored none (D79 round 4)", () => {
  it("names a NULL line with an active rate at exactly its stored percent, and changes nothing else about it", () => {
    const plan = planTaxClassification(MASTER, [line("L1", 0), line("L2", 14, "VAT14")], { lineRef: "L1", taxRateId: "EXEMPT" });
    expect(plan).toEqual({ lineRefs: ["L1"], before: { taxRateId: null, taxRatePercent: 0 }, after: { taxRateId: "EXEMPT", taxRatePercent: 0 }, taxRateName: "ضريبة EXEMPT" });
  });

  it("refuses a rate at any other percent — a 14% line cannot become exempt, a 0% line cannot become taxed", () => {
    expect(() => planTaxClassification(MASTER, [line("L1", 14)], { lineRef: "L1", taxRateId: "EXEMPT" })).toThrow(TaxRateClassificationPercentError);
    expect(() => planTaxClassification(MASTER, [line("L1", 0)], { lineRef: "L1", taxRateId: "VAT14" })).toThrow(TaxRateClassificationPercentError);
  });

  it("refuses a line that already names the very rate asked for — a repeat is not a second classification", () => {
    expect(() => planTaxClassification(MASTER, [line("L1", 0, "EXEMPT"), line("L2", 0)], { lineRef: "L1", taxRateId: "EXEMPT" })).toThrow(TaxRateAlreadyClassifiedError);
  });

  it("never moves a line from one rate to another", () => {
    expect(() => planTaxClassification(MASTER, [line("L1", 0, "EXEMPT")], { lineRef: "L1", taxRateId: "EXPORT" })).toThrow(TaxRateAlreadyClassifiedError);
    expect(() => planTaxClassification(MASTER, [line("L1", 14, "VAT14")], { lineRef: "L1", taxRateId: "VAT14B" })).toThrow(TaxRateAlreadyClassifiedError);
  });

  it("refuses an inactive rate, an unknown rate, an unknown line, and a master it cannot read", () => {
    expect(() => planTaxClassification(MASTER, [line("L1", 0)], { lineRef: "L1", taxRateId: "OLD0" })).toThrow(InactiveTaxRateError);
    expect(() => planTaxClassification(MASTER, [line("L1", 0)], { lineRef: "L1", taxRateId: "NOPE" })).toThrow(TaxRateNotFoundError);
    expect(() => planTaxClassification(MASTER, [line("L1", 0)], { lineRef: "L9", taxRateId: "EXEMPT" })).toThrow(PostedLineNotFoundError);
    expect(() => planTaxClassification(null, [line("L1", 0)], { lineRef: "L1", taxRateId: "EXEMPT" })).toThrow(TaxRateUnverifiableError);
  });

  it("refuses to classify one of several unnamed lines at the same percent until the caller names them all — they share a journal line", () => {
    const lines = [line("L1", 0), line("L2", 0), line("L3", 14), line("L4", 0, "EXPORT")];
    try {
      planTaxClassification(MASTER, lines, { lineRef: "L1", taxRateId: "EXEMPT" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TaxClassificationSharedPostingError);
      expect((err as TaxClassificationSharedPostingError).sharedLineRefs).toEqual(["L2"]);
      expect((err as Error).message).toContain("بند L2");
    }
    const plan = planTaxClassification(MASTER, lines, { lineRef: "L1", withLineRefs: ["L2"], taxRateId: "EXEMPT" });
    expect(plan.lineRefs).toEqual(["L1", "L2"]);
  });

  it("refuses a companion line that is at another percent or already names another rate", () => {
    const lines = [line("L1", 0), line("L3", 14), line("L4", 0, "EXPORT")];
    expect(() => planTaxClassification(MASTER, lines, { lineRef: "L1", withLineRefs: ["L3"], taxRateId: "EXEMPT" })).toThrow(TaxRateClassificationPercentError);
    expect(() => planTaxClassification(MASTER, lines, { lineRef: "L1", withLineRefs: ["L4"], taxRateId: "EXEMPT" })).toThrow(TaxRateAlreadyClassifiedError);
  });
});
