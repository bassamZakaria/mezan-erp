import { describe, it, expect } from "vitest";
import { InMemoryTaxRateRepository } from "./test-helpers/in-memory-tax-rate-repository.js";
import { createTaxRate, validateNewTaxRate } from "./create-tax-rate.js";
import { DuplicateTaxCodeError, InvalidTaxRateError } from "./errors.js";

describe("createTaxRate", () => {
  it("creates a tax rate with defaults (exclusive, non-default, auto ETA sub-type, active)", async () => {
    const repo = new InMemoryTaxRateRepository();
    const tax = await createTaxRate({ id: "t1", code: "VAT14", name: "ضريبة القيمة المضافة 14%", rate: 14 }, repo);
    expect(tax).toMatchObject({
      code: "VAT14",
      rate: 14,
      calculationType: "exclusive",
      isDefault: false,
      outputTaxAccountId: null,
      inputTaxAccountId: null,
      etaSubType: "auto",
      status: "active",
    });
    expect(await repo.findById("t1")).toEqual(tax);
  });

  it("accepts explicit GL account overrides and an ETA sub-type", async () => {
    const repo = new InMemoryTaxRateRepository();
    const tax = await createTaxRate(
      {
        id: "t1",
        code: "VAT14",
        name: "ضريبة القيمة المضافة 14%",
        rate: 14,
        outputTaxAccountId: "2200",
        inputTaxAccountId: "1400",
        etaSubType: "V009",
      },
      repo,
    );
    expect(tax.outputTaxAccountId).toBe("2200");
    expect(tax.inputTaxAccountId).toBe("1400");
    expect(tax.etaSubType).toBe("V009");
  });

  it("rejects a duplicate tax code", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
    await expect(createTaxRate({ id: "t2", code: "VAT14", name: "dup", rate: 14 }, repo)).rejects.toThrow(
      DuplicateTaxCodeError,
    );
  });

  it("rejects a rate outside 0–100", async () => {
    const repo = new InMemoryTaxRateRepository();
    await expect(createTaxRate({ id: "t1", code: "BAD", name: "bad", rate: 150 }, repo)).rejects.toThrow(
      InvalidTaxRateError,
    );
    await expect(createTaxRate({ id: "t2", code: "NEG", name: "neg", rate: -1 }, repo)).rejects.toThrow(
      InvalidTaxRateError,
    );
  });

  it("flips off any previously-default tax rate when a new one is created as default", async () => {
    const repo = new InMemoryTaxRateRepository();
    const first = await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14, isDefault: true }, repo);
    expect(first.isDefault).toBe(true);

    const second = await createTaxRate({ id: "t2", code: "VAT0", name: "VAT 0%", rate: 0, isDefault: true }, repo);
    expect(second.isDefault).toBe(true);
    expect((await repo.findById("t1"))?.isDefault).toBe(false);
  });

  it("validateNewTaxRate is a pure pre-check that does not persist anything", () => {
    expect(() => validateNewTaxRate({ id: "x", code: "NEW", name: "n", rate: 5 }, [])).not.toThrow();
  });
});
