import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { InMemoryPriceListRepository } from "./test-helpers/in-memory-price-list-repository.js";
import { createPriceList, validateNewPriceList } from "./create-price-list.js";
import { DuplicatePriceListError, InvalidPriceListError } from "./errors.js";

describe("createPriceList", () => {
  it("creates a price list with defaults (not base, active, no lines)", async () => {
    const repo = new InMemoryPriceListRepository();
    const pl = await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
    expect(pl).toMatchObject({
      code: "RETAIL",
      nameAr: "قائمة التجزئة",
      nameEn: null,
      description: null,
      isBase: false,
      active: true,
      lines: [],
    });
    expect(await repo.findById("pl1")).toEqual(pl);
  });

  it("accepts explicit lines, nameEn, description, and isBase", async () => {
    const repo = new InMemoryPriceListRepository();
    const pl = await createPriceList(
      {
        id: "pl1",
        code: "RETAIL",
        nameAr: "قائمة التجزئة",
        nameEn: "Retail",
        description: "قائمة أسعار التجزئة",
        isBase: true,
        lines: [{ itemId: "item-1", unitCode: null, minQty: Qty.zero(), price: Money.fromMajor("100.00") }],
      },
      repo,
    );
    expect(pl.nameEn).toBe("Retail");
    expect(pl.description).toBe("قائمة أسعار التجزئة");
    expect(pl.isBase).toBe(true);
    expect(pl.lines).toHaveLength(1);
    expect(pl.lines[0]).toEqual({ itemId: "item-1", unitCode: null, minQty: Qty.zero(), price: Money.fromMajor("100.00") });
  });

  it("rejects a duplicate price list code", async () => {
    const repo = new InMemoryPriceListRepository();
    await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
    await expect(createPriceList({ id: "pl2", code: "RETAIL", nameAr: "dup" }, repo)).rejects.toThrow(
      DuplicatePriceListError,
    );
  });

  it("rejects an empty nameAr", async () => {
    const repo = new InMemoryPriceListRepository();
    await expect(createPriceList({ id: "pl1", code: "RETAIL", nameAr: "   " }, repo)).rejects.toThrow(
      InvalidPriceListError,
    );
  });

  it("rejects duplicate itemId across lines", async () => {
    const repo = new InMemoryPriceListRepository();
    await expect(
      createPriceList(
        {
          id: "pl1",
          code: "RETAIL",
          nameAr: "قائمة التجزئة",
          lines: [
            { itemId: "item-1", unitCode: null, minQty: Qty.zero(), price: Money.fromMajor("100.00") },
            { itemId: "item-1", unitCode: null, minQty: Qty.zero(), price: Money.fromMajor("90.00") },
          ],
        },
        repo,
      ),
    ).rejects.toThrow(InvalidPriceListError);
  });

  it("rejects a negative line price", async () => {
    const repo = new InMemoryPriceListRepository();
    await expect(
      createPriceList(
        {
          id: "pl1",
          code: "RETAIL",
          nameAr: "قائمة التجزئة",
          lines: [{ itemId: "item-1", unitCode: null, minQty: Qty.zero(), price: Money.fromMajor("-1.00") }],
        },
        repo,
      ),
    ).rejects.toThrow(InvalidPriceListError);
  });

  it("validateNewPriceList is a pure pre-check that does not persist anything", () => {
    expect(() => validateNewPriceList({ id: "x", code: "NEW", nameAr: "n" }, [])).not.toThrow();
  });
});
