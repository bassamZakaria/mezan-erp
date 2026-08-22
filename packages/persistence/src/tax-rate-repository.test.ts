import { describe, it, expect } from "vitest";
import { createTaxRate } from "@mezan/domain";
import { createSqliteTaxRateRepository } from "./tax-rate-repository.js";

describe("SqliteTaxRateRepository", () => {
  it("creates and retrieves a tax rate by id and by code", async () => {
    const repo = createSqliteTaxRateRepository();
    try {
      await createTaxRate({ id: "t1", code: "VAT14", name: "ضريبة القيمة المضافة 14%", rate: 14 }, repo);
      expect(await repo.findById("t1")).toMatchObject({ code: "VAT14", rate: 14 });
      expect(await repo.findByCode("VAT14")).toMatchObject({ id: "t1" });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips null GL account overrides correctly (not the string 'null')", async () => {
    const repo = createSqliteTaxRateRepository();
    try {
      await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
      const reloaded = await repo.findById("t1");
      expect(reloaded?.outputTaxAccountId).toBeNull();
      expect(reloaded?.inputTaxAccountId).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips the isDefault boolean and GL account overrides", async () => {
    const repo = createSqliteTaxRateRepository();
    try {
      await createTaxRate(
        {
          id: "t1",
          code: "VAT14",
          name: "VAT 14%",
          rate: 14,
          isDefault: true,
          outputTaxAccountId: "2200",
          inputTaxAccountId: "1400",
          etaSubType: "V009",
        },
        repo,
      );
      const reloaded = await repo.findById("t1");
      expect(reloaded?.isDefault).toBe(true);
      expect(reloaded?.outputTaxAccountId).toBe("2200");
      expect(reloaded?.inputTaxAccountId).toBe("1400");
      expect(reloaded?.etaSubType).toBe("V009");
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. status flip)", async () => {
    const repo = createSqliteTaxRateRepository();
    try {
      const created = await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
      await repo.update({ ...created, status: "inactive" });
      expect((await repo.findById("t1"))?.status).toBe("inactive");
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted tax rate", async () => {
    const repo = createSqliteTaxRateRepository();
    try {
      await createTaxRate({ id: "t1", code: "VAT14", name: "VAT 14%", rate: 14 }, repo);
      await createTaxRate({ id: "t2", code: "VAT0", name: "VAT 0%", rate: 0 }, repo);
      const all = await repo.list();
      expect(all.map((t) => t.code).sort()).toEqual(["VAT0", "VAT14"]);
    } finally {
      repo.close();
    }
  });
});
