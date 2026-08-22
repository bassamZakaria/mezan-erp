import { describe, it, expect } from "vitest";
import { createSupplier, Money } from "@mezan/domain";
import { createSqliteSupplierRepository } from "./supplier-repository.js";

describe("SqliteSupplierRepository", () => {
  it("creates and retrieves a supplier by id and by code", async () => {
    const repo = createSqliteSupplierRepository();
    try {
      const supplier = createSupplier({ id: "s1", code: "S000001", nameAr: "جاري" });
      await repo.save(supplier);
      expect(await repo.findById("s1")).toMatchObject({ code: "S000001", nameAr: "جاري" });
      expect(await repo.findByCode("S000001")).toMatchObject({ id: "s1" });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips Money fields exactly (opening balance) and nulls (not the string 'null')", async () => {
    const repo = createSqliteSupplierRepository();
    try {
      const supplier = createSupplier({
        id: "s1",
        code: "S1",
        nameAr: "مورد",
        nameEn: null,
        openingBalance: Money.fromMajor("2500.123456"),
      });
      await repo.save(supplier);
      const reloaded = await repo.findById("s1");
      expect(reloaded?.nameEn).toBeNull();
      expect(reloaded?.openingBalance.toString()).toBe("2500.123456");
      expect(reloaded?.addressCity).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("save() persists a full replace (e.g. deactivate)", async () => {
    const repo = createSqliteSupplierRepository();
    try {
      const supplier = createSupplier({ id: "s1", code: "S1", nameAr: "مورد" });
      await repo.save(supplier);
      await repo.save({ ...supplier, active: false });
      expect((await repo.findById("s1"))?.active).toBe(false);
    } finally {
      repo.close();
    }
  });

  it("findAll() returns every persisted supplier, ordered by code", async () => {
    const repo = createSqliteSupplierRepository();
    try {
      await repo.save(createSupplier({ id: "s2", code: "S002", nameAr: "ب" }));
      await repo.save(createSupplier({ id: "s1", code: "S001", nameAr: "أ" }));
      const all = await repo.findAll();
      expect(all.map((s) => s.code)).toEqual(["S001", "S002"]);
    } finally {
      repo.close();
    }
  });
});
