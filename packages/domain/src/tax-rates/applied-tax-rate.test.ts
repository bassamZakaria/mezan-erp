import { describe, expect, it } from "vitest";
import {
  findSoleActiveTaxRateByPercent,
  resolveAppliedTaxRate,
  resolveZeroRatedTaxRate,
} from "./applied-tax-rate.js";
import { InactiveTaxRateError, TaxRateNotFoundError, TaxRatePercentMismatchError } from "./errors.js";
import type { TaxRateStatus } from "./tax-rate.js";

const rate = (id: string, percent: number, status: TaxRateStatus = "active") => ({ id, rate: percent, status });

const VAT = rate("VAT14", 14);
const EXEMPT = rate("EXEMPT", 0);
const EXPORT = rate("EXPORT", 0);
const RETIRED = rate("OLD5", 5, "inactive");
const MASTER = [VAT, EXEMPT, EXPORT, RETIRED];

describe("resolveAppliedTaxRate — a line names its tax rate (D79)", () => {
  it("takes the percent from the named rate, not from the request", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRateId: "EXEMPT" }, 14)).toEqual({ taxRateId: "EXEMPT", taxRatePercent: 0 });
    expect(resolveAppliedTaxRate(MASTER, { taxRateId: "VAT14" }, 0)).toEqual({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("keeps exempt and zero-rated export apart, though both are 0%", () => {
    const exempt = resolveAppliedTaxRate(MASTER, { taxRateId: "EXEMPT" }, 14);
    const exported = resolveAppliedTaxRate(MASTER, { taxRateId: "EXPORT" }, 14);
    expect(exempt.taxRatePercent).toBe(exported.taxRatePercent);
    expect(exempt.taxRateId).not.toBe(exported.taxRateId);
  });

  it("accepts a percent sent beside the id only when it is the rate's own", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRateId: "VAT14", taxRatePercent: 14 }, 0).taxRateId).toBe("VAT14");
    expect(() => resolveAppliedTaxRate(MASTER, { taxRateId: "VAT14", taxRatePercent: 0 }, 0)).toThrow(
      TaxRatePercentMismatchError,
    );
  });

  it("refuses an id no tax rate has", () => {
    expect(() => resolveAppliedTaxRate(MASTER, { taxRateId: "TAX-1" }, 14)).toThrow(TaxRateNotFoundError);
  });

  it("refuses a deactivated rate on a new line", () => {
    expect(() => resolveAppliedTaxRate(MASTER, { taxRateId: "OLD5" }, 14)).toThrow(InactiveTaxRateError);
  });
});

describe("resolveAppliedTaxRate — a line names only a percent", () => {
  it("stores the one active rate that has the percent", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 14 }, 0)).toEqual({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("stores no id when two active rates share the percent, and keeps the percent", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 0 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 0 });
  });

  it("stores no id when no active rate has the percent", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 5 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 5 });
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 5.04 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 5.04 });
  });

  it("falls to the default percent when the line names neither", () => {
    expect(resolveAppliedTaxRate(MASTER, {}, 14)).toEqual({ taxRateId: "VAT14", taxRatePercent: 14 });
  });
});

describe("resolveZeroRatedTaxRate — policy forces the line to 0%", () => {
  it("keeps a 0% rate the line named", () => {
    expect(resolveZeroRatedTaxRate(MASTER, { taxRateId: "EXPORT" })).toEqual({ taxRateId: "EXPORT", taxRatePercent: 0 });
  });

  it("never stamps a taxed rate's id on a line charged nothing", () => {
    expect(resolveZeroRatedTaxRate(MASTER, { taxRateId: "VAT14", taxRatePercent: 14 })).toEqual({
      taxRateId: null,
      taxRatePercent: 0,
    });
  });

  it("stores the sole active 0% rate when there is exactly one", () => {
    expect(resolveZeroRatedTaxRate([VAT, EXEMPT], { taxRatePercent: 14 })).toEqual({ taxRateId: "EXEMPT", taxRatePercent: 0 });
  });

  it("still refuses an id no tax rate has", () => {
    expect(() => resolveZeroRatedTaxRate(MASTER, { taxRateId: "TAX-1" })).toThrow(TaxRateNotFoundError);
  });
});

describe("findSoleActiveTaxRateByPercent", () => {
  it("ignores inactive rates", () => {
    expect(findSoleActiveTaxRateByPercent(MASTER, 5)).toBeNull();
    expect(findSoleActiveTaxRateByPercent([EXEMPT, rate("EXPORT", 0, "inactive")], 0)?.id).toBe("EXEMPT");
  });
});
