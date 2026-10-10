import { describe, it, expect } from "vitest";
import { InMemoryTaxRateRepository } from "./test-helpers/in-memory-tax-rate-repository.js";
import { createTaxRate } from "./create-tax-rate.js";
import { updateTaxRate } from "./update-tax-rate.js";
import { InvalidTaxRateError, TaxRateInUseError, TaxRateNotFoundError } from "./errors.js";

describe("updateTaxRate — a rate stored lines name keeps its percent and its ETA sub-type (D79)", () => {
  const referenced = { isReferenced: async () => true };
  const unreferenced = { isReferenced: async () => false };
  async function seeded() {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "EXEMPT", name: "معفى", rate: 0, etaSubType: "V003" }, repo);
    return repo;
  }

  it("refuses a new percent, naming the rate and telling the user to create another", async () => {
    const repo = await seeded();
    await expect(updateTaxRate("t1", { rate: 5 }, repo, referenced)).rejects.toBeInstanceOf(TaxRateInUseError);
    await expect(updateTaxRate("t1", { rate: 5 }, repo, referenced)).rejects.toThrow(/معفى/);
    expect((await repo.findById("t1"))?.rate).toBe(0);
  });

  it("refuses a new ETA sub-type — exempt cannot become export under documents already filed", async () => {
    const repo = await seeded();
    await expect(updateTaxRate("t1", { etaSubType: "V001" }, repo, referenced)).rejects.toBeInstanceOf(TaxRateInUseError);
    expect((await repo.findById("t1"))?.etaSubType).toBe("V003");
  });

  it("still lets a referenced rate be renamed, re-sent unchanged, and deactivated", async () => {
    const repo = await seeded();
    const updated = await updateTaxRate("t1", { name: "معفى من الضريبة", rate: 0, etaSubType: "V003", status: "inactive" }, repo, referenced);
    expect(updated).toMatchObject({ name: "معفى من الضريبة", status: "inactive", rate: 0, etaSubType: "V003" });
  });

  it("lets a rate nothing references change freely", async () => {
    const repo = await seeded();
    const updated = await updateTaxRate("t1", { rate: 5, etaSubType: "V009" }, repo, unreferenced);
    expect(updated).toMatchObject({ rate: 5, etaSubType: "V009" });
  });
});

const NOT_REFERENCED = { isReferenced: async () => false };

describe("updateTaxRate", () => {
  it("updates fields in place", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
    const updated = await updateTaxRate("t1", { rate: 15, calculationType: "inclusive" }, repo, NOT_REFERENCED);
    expect(updated.rate).toBe(15);
    expect(updated.calculationType).toBe("inclusive");
  });

  it("404s (throws TaxRateNotFoundError) for an unknown id", async () => {
    const repo = new InMemoryTaxRateRepository();
    await expect(updateTaxRate("nope", { rate: 10 }, repo, NOT_REFERENCED)).rejects.toThrow(TaxRateNotFoundError);
  });

  it("rejects an out-of-range rate", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
    await expect(updateTaxRate("t1", { rate: 101 }, repo, NOT_REFERENCED)).rejects.toThrow(InvalidTaxRateError);
  });

  it("flips off the previous default when this rate becomes the new default", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14, isDefault: true }, repo);
    await createTaxRate({ id: "t2", code: "VAT0", name: "VAT 0%", rate: 0 }, repo);

    const updated = await updateTaxRate("t2", { isDefault: true }, repo, NOT_REFERENCED);
    expect(updated.isDefault).toBe(true);
    expect((await repo.findById("t1"))?.isDefault).toBe(false);
  });

  it("leaves other defaults untouched when isDefault is not part of the patch", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14, isDefault: true }, repo);
    await updateTaxRate("t1", { name: "ضريبة القيمة المضافة 14%" }, repo, NOT_REFERENCED);
    expect((await repo.findById("t1"))?.isDefault).toBe(true);
  });

  it("can deactivate a tax rate via status", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
    const updated = await updateTaxRate("t1", { status: "inactive" }, repo, NOT_REFERENCED);
    expect(updated.status).toBe("inactive");
  });
});
