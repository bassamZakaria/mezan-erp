import { describe, expect, it } from "vitest";
import { resolveEtaVatSubType } from "./tax-subtype.js";

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

  it("LIMITATION (D79): an unconfigured 0% line is filed as V004 whether it is exempt or a zero-rated export", () => {
    // Both an exempt item (V003) and a zero-rated export (V001) carry a rate of
    // zero. With nothing configured on the tax rate they are indistinguishable
    // here, and both go to the authority as V004 — the reason a tenant selling
    // exports must set `TaxRate.etaSubType` explicitly rather than leave it on
    // "auto". If the resolver ever learns to tell them apart, this expectation
    // is the one to change.
    const exempt = resolveEtaVatSubType(null, 0);
    const zeroRatedExport = resolveEtaVatSubType(null, 0);
    expect(exempt).toBe("V004");
    expect(zeroRatedExport).toBe("V004");
    expect(exempt).toBe(zeroRatedExport);

    // Configured explicitly, they are correctly distinct.
    expect(resolveEtaVatSubType("V003", 0)).not.toBe(resolveEtaVatSubType("V001", 0));
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
