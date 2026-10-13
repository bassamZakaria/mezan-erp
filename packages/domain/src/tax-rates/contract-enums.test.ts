import { describe, expect, it } from "vitest";
import * as contracts from "@mezan/contracts";
import { EtaVatSubTypeCode, TaxClassificationFilingOutcome, TaxRateStatusCode } from "./index.js";

describe("the tax-rate enums the wire and the domain share", () => {
  it("are the same enum objects, declared once in contracts", () => {
    expect(EtaVatSubTypeCode).toBe(contracts.EtaVatSubTypeCode);
    expect(TaxRateStatusCode).toBe(contracts.TaxRateStatusCode);
    expect(TaxClassificationFilingOutcome).toBe(contracts.TaxClassificationFilingOutcomeCode);
  });
});
