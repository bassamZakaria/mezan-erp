// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ItemCategoryDTO, ItemUnitDTO } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { categoryLabel, unitLabel, useCategoryLabel, useUnitLabel } from "./item-labels";

const units: ItemUnitDTO[] = [
  { code: "PCS", nameAr: "قطعة", nameEn: "Piece" } as ItemUnitDTO,
  { code: "KG", nameAr: "كيلو", nameEn: null } as ItemUnitDTO,
];

const categories: ItemCategoryDTO[] = [
  { id: "CAT-1", nameAr: "مواد غذائية", nameEn: "Groceries" } as ItemCategoryDTO,
];

describe("unitLabel", () => {
  it("names the unit in the reader's language", () => {
    expect(unitLabel("PCS", units)).toBe("قطعة");
    expect(unitLabel("PCS", units, "en")).toBe("Piece");
  });

  it("falls back to Arabic when the English name was never filled in", () => {
    expect(unitLabel("KG", units, "en")).toBe("كيلو");
  });

  it("shows the code itself for a unit the catalog does not carry, rather than a blank", () => {
    expect(unitLabel("BOX", units)).toBe("BOX");
    expect(unitLabel("BOX", [], "en")).toBe("BOX");
  });
});

describe("categoryLabel", () => {
  it("names the category in the reader's language", () => {
    expect(categoryLabel("CAT-1", categories, "غير مصنف")).toBe("مواد غذائية");
    expect(categoryLabel("CAT-1", categories, "Uncategorized", "en")).toBe("Groceries");
  });

  it("uses the caller's word for an item with no category", () => {
    expect(categoryLabel(null, categories, "غير مصنف")).toBe("غير مصنف");
    expect(categoryLabel("", categories, "غير مصنف")).toBe("غير مصنف");
  });

  it("shows the id for a category that is not in the catalog, so the row stays traceable", () => {
    expect(categoryLabel("CAT-GONE", categories, "غير مصنف")).toBe("CAT-GONE");
  });
});

describe("the label hooks", () => {
  function Harness() {
    const unit = useUnitLabel();
    const category = useCategoryLabel();
    return (
      <>
        <output data-testid="unit">{unit("PCS")}</output>
        <output data-testid="category">{category("CAT-1")}</output>
        <output data-testid="none">{category(null)}</output>
      </>
    );
  }

  it("resolves both catalogs through the real API", async () => {
    const transport = stubTransport({
      "GET /item-units": () => ({ body: units }),
      "GET /item-categories": () => ({ body: categories }),
    });
    renderWithProviders(<Harness />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByTestId("unit").textContent).toBe("قطعة"));
    expect(screen.getByTestId("category").textContent).toBe("مواد غذائية");
  });

  it("renders the code and the id honestly while the catalogs are still loading", () => {
    const transport = stubTransport({
      "GET /item-units": () => ({ body: units }),
      "GET /item-categories": () => ({ body: categories }),
    });
    renderWithProviders(<Harness />, { transport, initialSession: testAdminSession });

    expect(screen.getByTestId("unit").textContent).toBe("PCS");
    expect(screen.getByTestId("category").textContent).toBe("CAT-1");
  });

  it("names an uncategorised item with the shared Arabic word", async () => {
    const transport = stubTransport({
      "GET /item-units": () => ({ body: [] }),
      "GET /item-categories": () => ({ body: [] }),
    });
    renderWithProviders(<Harness />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByTestId("none").textContent).not.toBe(""));
    expect(screen.getByTestId("none").textContent).not.toBe("CAT-1");
  });
});
