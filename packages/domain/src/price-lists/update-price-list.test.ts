import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryPriceListRepository } from "./test-helpers/in-memory-price-list-repository.js";
import { createPriceList } from "./create-price-list.js";
import { updatePriceList } from "./update-price-list.js";
import { InvalidPriceListError, PriceListNotFoundError } from "./errors.js";

describe("updatePriceList", () => {
  it("updates fields in place", async () => {
    const repo = new InMemoryPriceListRepository();
    await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
    const updated = await updatePriceList("pl1", { nameAr: "قائمة التجزئة المعدلة", nameEn: "Retail v2" }, repo);
    expect(updated.nameAr).toBe("قائمة التجزئة المعدلة");
    expect(updated.nameEn).toBe("Retail v2");
  });

  it("404s (throws PriceListNotFoundError) for an unknown id", async () => {
    const repo = new InMemoryPriceListRepository();
    await expect(updatePriceList("nope", { nameAr: "x" }, repo)).rejects.toThrow(PriceListNotFoundError);
  });

  it("rejects an empty nameAr patch", async () => {
    const repo = new InMemoryPriceListRepository();
    await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
    await expect(updatePriceList("pl1", { nameAr: "   " }, repo)).rejects.toThrow(InvalidPriceListError);
  });

  it("replaces lines wholesale and re-validates them", async () => {
    const repo = new InMemoryPriceListRepository();
    await createPriceList(
      { id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة", lines: [{ itemId: "item-1", price: Money.fromMajor("100.00") }] },
      repo,
    );
    const updated = await updatePriceList(
      "pl1",
      { lines: [{ itemId: "item-2", price: Money.fromMajor("50.00") }] },
      repo,
    );
    expect(updated.lines).toEqual([{ itemId: "item-2", price: Money.fromMajor("50.00") }]);
  });

  it("rejects a lines patch with duplicate itemId", async () => {
    const repo = new InMemoryPriceListRepository();
    await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
    await expect(
      updatePriceList(
        "pl1",
        {
          lines: [
            { itemId: "item-1", price: Money.fromMajor("10.00") },
            { itemId: "item-1", price: Money.fromMajor("20.00") },
          ],
        },
        repo,
      ),
    ).rejects.toThrow(InvalidPriceListError);
  });

  it("can deactivate a price list via active", async () => {
    const repo = new InMemoryPriceListRepository();
    await createPriceList({ id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة" }, repo);
    const updated = await updatePriceList("pl1", { active: false }, repo);
    expect(updated.active).toBe(false);
  });

  it("leaves lines untouched when the patch does not include them", async () => {
    const repo = new InMemoryPriceListRepository();
    await createPriceList(
      { id: "pl1", code: "RETAIL", nameAr: "قائمة التجزئة", lines: [{ itemId: "item-1", price: Money.fromMajor("100.00") }] },
      repo,
    );
    const updated = await updatePriceList("pl1", { description: "desc" }, repo);
    expect(updated.lines).toEqual([{ itemId: "item-1", price: Money.fromMajor("100.00") }]);
  });
});
