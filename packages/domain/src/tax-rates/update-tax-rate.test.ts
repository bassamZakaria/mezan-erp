import { describe, it, expect } from "vitest";
import { InMemoryTaxRateRepository } from "./test-helpers/in-memory-tax-rate-repository.js";
import { createTaxRate } from "./create-tax-rate.js";
import { updateTaxRate } from "./update-tax-rate.js";
import { InvalidTaxRateError, TaxRateNotFoundError } from "./errors.js";

describe("updateTaxRate", () => {
  it("updates fields in place", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
    const updated = await updateTaxRate("t1", { rate: 15, calculationType: "inclusive" }, repo);
    expect(updated.rate).toBe(15);
    expect(updated.calculationType).toBe("inclusive");
  });

  it("404s (throws TaxRateNotFoundError) for an unknown id", async () => {
    const repo = new InMemoryTaxRateRepository();
    await expect(updateTaxRate("nope", { rate: 10 }, repo)).rejects.toThrow(TaxRateNotFoundError);
  });

  it("rejects an out-of-range rate", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
    await expect(updateTaxRate("t1", { rate: 101 }, repo)).rejects.toThrow(InvalidTaxRateError);
  });

  it("flips off the previous default when this rate becomes the new default", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14, isDefault: true }, repo);
    await createTaxRate({ id: "t2", code: "VAT0", name: "VAT 0%", rate: 0 }, repo);

    const updated = await updateTaxRate("t2", { isDefault: true }, repo);
    expect(updated.isDefault).toBe(true);
    expect((await repo.findById("t1"))?.isDefault).toBe(false);
  });

  it("leaves other defaults untouched when isDefault is not part of the patch", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14, isDefault: true }, repo);
    await updateTaxRate("t1", { name: "ضريبة القيمة المضافة 14%" }, repo);
    expect((await repo.findById("t1"))?.isDefault).toBe(true);
  });

  it("can deactivate a tax rate via status", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
    const updated = await updateTaxRate("t1", { status: "inactive" }, repo);
    expect(updated.status).toBe("inactive");
  });
});
