import { describe, expect, it } from "vitest";
import {
  inferTaxRateByPercent,
  resolveAppliedTaxRate,
  resolveDocumentLineTax,
  resolveInheritedTaxRate,
  resolveZeroRatedTaxRate,
} from "./applied-tax-rate.js";
import {
  InactiveTaxRateError,
  TaxRateNotFoundError,
  TaxRatePercentMismatchError,
  TaxRateUnverifiableError,
} from "./errors.js";
import { TaxRateStatusCode, type TaxRateStatus } from "./tax-rate.js";

const rate = (id: string, name: string, percent: number, status: TaxRateStatus = TaxRateStatusCode.Active) => ({
  id,
  name,
  rate: percent,
  status,
});

const VAT = rate("VAT14", "ضريبة القيمة المضافة", 14);
const EXEMPT = rate("EXEMPT", "معفى", 0);
const EXPORT = rate("EXPORT", "تصدير", 0);
const RETIRED = rate("OLD5", "ضريبة قديمة", 5, TaxRateStatusCode.Inactive);
const MASTER = [VAT, EXEMPT, EXPORT, RETIRED];
const ONLY_EXEMPT_AT_ZERO = [VAT, EXEMPT];
const ONLY_EXPORT_AT_ZERO = [VAT, EXPORT];

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

  it("refuses a deactivated rate on a new line, naming the rate rather than quoting its id", () => {
    expect(() => resolveAppliedTaxRate(MASTER, { taxRateId: "OLD5" }, 14)).toThrow(InactiveTaxRateError);
    expect(() => resolveAppliedTaxRate(MASTER, { taxRateId: "OLD5" }, 14)).toThrow(/ضريبة قديمة/);
    expect(() => resolveAppliedTaxRate(MASTER, { taxRateId: "VAT14", taxRatePercent: 5 }, 14)).toThrow(/ضريبة القيمة المضافة/);
  });
});

describe("resolveAppliedTaxRate — a line names only a percent", () => {
  it("infers the one active rate at a percent above zero", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 14 }, 0)).toEqual({ taxRateId: "VAT14", taxRatePercent: 14 });
    expect(resolveAppliedTaxRate(MASTER, {}, 14)).toEqual({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("NEVER infers a rate at 0% — not even when the tenant holds exactly one 0% rate", () => {
    // Guards review finding 1: with only «معفى» at 0%, a retention release or a
    // tax-exempt customer's sale would otherwise be stored, and filed, as exempt.
    expect(resolveAppliedTaxRate(ONLY_EXEMPT_AT_ZERO, { taxRatePercent: 0 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 0 });
    expect(resolveAppliedTaxRate(ONLY_EXPORT_AT_ZERO, { taxRatePercent: 0 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 0 });
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 0 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 0 });
  });

  it("stores no id when no active rate has the percent", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 5 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 5 });
    expect(resolveAppliedTaxRate(MASTER, { taxRatePercent: 5.04 }, 14)).toEqual({ taxRateId: null, taxRatePercent: 5.04 });
  });

  it("treats an explicit null as 'this line names no rate' and infers nothing, even at 14%", () => {
    expect(resolveAppliedTaxRate(MASTER, { taxRateId: null, taxRatePercent: 14 }, 0)).toEqual({ taxRateId: null, taxRatePercent: 14 });
  });
});

describe("resolveZeroRatedTaxRate — policy forces the line to 0%", () => {
  it("keeps a 0% rate the line named", () => {
    expect(resolveZeroRatedTaxRate(MASTER, { taxRateId: "EXPORT" })).toEqual({ taxRateId: "EXPORT", taxRatePercent: 0 });
  });

  it("never stamps a taxed rate's id on a line charged nothing", () => {
    expect(resolveZeroRatedTaxRate(MASTER, { taxRateId: "VAT14", taxRatePercent: 14 })).toEqual({ taxRateId: null, taxRatePercent: 0 });
  });

  it("stores NO id when the line named none — whichever single 0% rate the tenant happens to hold", () => {
    expect(resolveZeroRatedTaxRate(ONLY_EXEMPT_AT_ZERO, { taxRatePercent: 14 })).toEqual({ taxRateId: null, taxRatePercent: 0 });
    expect(resolveZeroRatedTaxRate(ONLY_EXPORT_AT_ZERO, {})).toEqual({ taxRateId: null, taxRatePercent: 0 });
  });

  it("still refuses an id no tax rate has", () => {
    expect(() => resolveZeroRatedTaxRate(MASTER, { taxRateId: "TAX-1" })).toThrow(TaxRateNotFoundError);
  });
});

describe("resolveDocumentLineTax — the tax rate master may not be wired", () => {
  const policy = { defaultPercent: 14, zeroRated: false };

  it("keeps the percent and stores no id for a line that names no rate", () => {
    expect(resolveDocumentLineTax(null, { taxRatePercent: 5 }, policy)).toEqual({ taxRateId: null, taxRatePercent: 5 });
    expect(resolveDocumentLineTax(null, {}, { ...policy, zeroRated: true })).toEqual({ taxRateId: null, taxRatePercent: 0 });
  });

  it("refuses a line that NAMES a rate it cannot verify, rather than dropping the id behind a success", () => {
    expect(() => resolveDocumentLineTax(null, { taxRateId: "EXEMPT" }, policy)).toThrow(TaxRateUnverifiableError);
  });
});

describe("resolveInheritedTaxRate — a line copied from a document that already resolved its tax", () => {
  it("keeps a rate deactivated since, at the percent it was resolved at", () => {
    expect(resolveInheritedTaxRate(MASTER, { taxRateId: "OLD5", taxRatePercent: 5 })).toEqual({ taxRateId: "OLD5", taxRatePercent: 5 });
  });

  it("keeps a line that stored no rate exactly as it is", () => {
    expect(resolveInheritedTaxRate(MASTER, { taxRateId: null, taxRatePercent: 0 })).toEqual({ taxRateId: null, taxRatePercent: 0 });
    expect(resolveInheritedTaxRate(null, { taxRateId: null, taxRatePercent: 14 })).toEqual({ taxRateId: null, taxRatePercent: 14 });
  });

  it("names the one active rate at a taxed percent for a source that stored none — a quote written before quotes stored a rate", () => {
    expect(resolveInheritedTaxRate(MASTER, { taxRateId: null, taxRatePercent: 14 })).toEqual({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("infers nothing for such a source at 0%, at a retired percent, or when two active rates share the percent", () => {
    expect(resolveInheritedTaxRate(ONLY_EXEMPT_AT_ZERO, { taxRateId: null, taxRatePercent: 0 })).toEqual({ taxRateId: null, taxRatePercent: 0 });
    expect(resolveInheritedTaxRate(MASTER, { taxRateId: null, taxRatePercent: 5 })).toEqual({ taxRateId: null, taxRatePercent: 5 });
    expect(resolveInheritedTaxRate([VAT, rate("VAT14B", "ضريبة أخرى", 14)], { taxRateId: null, taxRatePercent: 14 })).toEqual({ taxRateId: null, taxRatePercent: 14 });
  });

  it("refuses a rate row that no longer exists, and one it cannot verify", () => {
    expect(() => resolveInheritedTaxRate(MASTER, { taxRateId: "GONE", taxRatePercent: 14 })).toThrow(TaxRateNotFoundError);
    expect(() => resolveInheritedTaxRate(null, { taxRateId: "VAT14", taxRatePercent: 14 })).toThrow(TaxRateUnverifiableError);
  });
});

describe("inferTaxRateByPercent", () => {
  it("ignores inactive rates, and answers nothing at zero or below", () => {
    expect(inferTaxRateByPercent(MASTER, 5)).toBeNull();
    expect(inferTaxRateByPercent(ONLY_EXEMPT_AT_ZERO, 0)).toBeNull();
    expect(inferTaxRateByPercent(MASTER, 14)?.id).toBe("VAT14");
  });

  it("answers nothing when two active rates share the percent", () => {
    expect(inferTaxRateByPercent([VAT, rate("VAT14B", "ضريبة أخرى", 14)], 14)).toBeNull();
  });
});
