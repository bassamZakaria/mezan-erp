import { describe, it, expect } from "vitest";
import { Money, createPriceList, updatePriceList } from "@mezan/domain";
import { createSqlitePriceListStore } from "./price-list-store.js";

describe("SqlitePriceListStore", () => {
  it("creates and retrieves a price list by id", async () => {
    const repo = createSqlitePriceListStore();
    try {
      await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
      expect(await repo.findById("pl1")).toMatchObject({ code: "RETAIL", nameAr: "قائمة التجزئة", active: true });
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips nullable fields correctly (not the string 'null')", async () => {
    const repo = createSqlitePriceListStore();
    try {
      await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
      const reloaded = await repo.findById("pl1");
      expect(reloaded?.nameEn).toBeNull();
      expect(reloaded?.description).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips lines with exact Money precision", async () => {
    const repo = createSqlitePriceListStore();
    try {
      await createPriceList(
        {
          id: "pl1",
          code: "RETAIL",
          nameAr: "قائمة التجزئة",
          lines: [
            { itemId: "item-1", price: Money.fromMajor("1250.500000") },
            { itemId: "item-2", price: Money.fromMajor("0.000001") },
          ],
        },
        repo,
      );
      const reloaded = await repo.findById("pl1");
      expect(reloaded?.lines).toHaveLength(2);
      expect(reloaded?.lines[0]).toEqual({ itemId: "item-1", price: Money.fromMajor("1250.500000") });
      expect(reloaded?.lines[1]).toEqual({ itemId: "item-2", price: Money.fromMajor("0.000001") });
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace, including swapping out the lines", async () => {
    const repo = createSqlitePriceListStore();
    try {
      const created = await createPriceList(
        { id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة", lines: [{ itemId: "item-1", price: Money.fromMajor("100.00") }] },
        repo,
      );
      await updatePriceList("pl1", { lines: [{ itemId: "item-2", price: Money.fromMajor("50.00") }] }, repo);
      const reloaded = await repo.findById("pl1");
      expect(reloaded?.lines).toEqual([{ itemId: "item-2", price: Money.fromMajor("50.00") }]);
      expect(created.id).toBe("pl1");
    } finally {
      repo.close();
    }
  });

  it("update() persists a status flip (active -> inactive)", async () => {
    const repo = createSqlitePriceListStore();
    try {
      await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
      await updatePriceList("pl1", { active: false }, repo);
      expect((await repo.findById("pl1"))?.active).toBe(false);
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted price list", async () => {
    const repo = createSqlitePriceListStore();
    try {
      await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
      await createPriceList({ id: "pl2", code: "WHOLESALE", nameAr: "قائمة الجملة" }, repo);
      const all = await repo.list();
      expect(all.map((pl) => pl.code).sort()).toEqual(["RETAIL", "WHOLESALE"]);
    } finally {
      repo.close();
    }
  });

  it("list({ active }) filters by active status", async () => {
    const repo = createSqlitePriceListStore();
    try {
      await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
      await createPriceList({ id: "pl2", code: "WHOLESALE", nameAr: "قائمة الجملة" }, repo);
      await updatePriceList("pl2", { active: false }, repo);

      const activeOnly = await repo.list({ active: true });
      expect(activeOnly.map((pl) => pl.code)).toEqual(["RETAIL"]);

      const inactiveOnly = await repo.list({ active: false });
      expect(inactiveOnly.map((pl) => pl.code)).toEqual(["WHOLESALE"]);
    } finally {
      repo.close();
    }
  });

  it("enforces code uniqueness at the SQL layer", async () => {
    const repo = createSqlitePriceListStore();
    try {
      await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
      await expect(repo.save({ id: "pl2", code: "RETAIL", nameAr: "dup", nameEn: null, description: null, isBase: false, active: true, lines: [], createdAt: new Date().toISOString() })).rejects.toThrow();
    } finally {
      repo.close();
    }
  });
});
