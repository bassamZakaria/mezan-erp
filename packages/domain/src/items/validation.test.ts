import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/index.js";
import { validateAlternateUnits, validateGlAccountRefs, collectItemFieldErrors } from "./validation.js";
import type { Item } from "./item.js";

function baseItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "itm-1",
    code: "ITM-0001",
    nameAr: "صنف",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null,
    description: null,
    defaultSupplierId: null,
    seasonId: null,
    specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: null,
    taxRatePercent: 14,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  };
}

const POSTABLE_ACCOUNT: Account = {
  id: "1200",
  code: "1200",
  nameAr: "المخزون",
  nameEn: "Inventory",
  type: "asset",
  naturalBalance: "debit",
  parentId: null,
  isHeader: false,
  status: "active",
};

const HEADER_ACCOUNT: Account = {
  id: "1000",
  code: "1000",
  nameAr: "الأصول",
  nameEn: "Assets",
  type: "asset",
  naturalBalance: "debit",
  parentId: null,
  isHeader: true,
  status: "active",
};

describe("validateAlternateUnits — unit conversion rules", () => {
  it("accepts a well-formed alternate unit with a positive factor", () => {
    expect(validateAlternateUnits("PCS", [{ code: "CTN", name: "كرتونة", factor: 24 }])).toEqual([]);
  });

  it("accepts multiple distinct alternate units, e.g. لفة = 12 متر style conversions", () => {
    expect(
      validateAlternateUnits("M", [
        { code: "ROLL", name: "لفة", factor: 12 },
        { code: "BOX", name: "صندوق", factor: 100 },
      ]),
    ).toEqual([]);
  });

  it("rejects a blank unit code", () => {
    expect(validateAlternateUnits("PCS", [{ code: "  ", name: "x", factor: 1 }])).toEqual([
      "alternate unit code is required",
    ]);
  });

  it("rejects an alternate unit that repeats the base unit code", () => {
    expect(validateAlternateUnits("PCS", [{ code: "PCS", name: "قطعة", factor: 1 }])).toEqual([
      'alternate unit "PCS" cannot repeat the base unit',
    ]);
  });

  it("rejects duplicated alternate unit codes", () => {
    const reasons = validateAlternateUnits("PCS", [
      { code: "CTN", name: "كرتونة", factor: 24 },
      { code: "CTN", name: "كرتونة كبيرة", factor: 48 },
    ]);
    expect(reasons).toContain('alternate unit code "CTN" is duplicated');
  });

  it("rejects a zero conversion factor", () => {
    expect(validateAlternateUnits("PCS", [{ code: "CTN", name: "كرتونة", factor: 0 }])).toEqual([
      'alternate unit "CTN" must have a positive conversion factor',
    ]);
  });

  it("rejects a negative conversion factor", () => {
    expect(validateAlternateUnits("PCS", [{ code: "CTN", name: "كرتونة", factor: -5 }])).toEqual([
      'alternate unit "CTN" must have a positive conversion factor',
    ]);
  });

  it("rejects a non-finite conversion factor", () => {
    expect(validateAlternateUnits("PCS", [{ code: "CTN", name: "كرتونة", factor: Infinity }])).toEqual([
      'alternate unit "CTN" must have a positive conversion factor',
    ]);
  });

  it("returns no errors for an item with no alternate units at all", () => {
    expect(validateAlternateUnits("PCS", [])).toEqual([]);
  });
});

describe("validateGlAccountRefs", () => {
  it("skips the check entirely when no accounts list is supplied", () => {
    expect(validateGlAccountRefs({ revenueAccountId: "9999", cogsAccountId: null, inventoryAccountId: null })).toEqual([]);
  });

  it("accepts a mapping that resolves to a postable account", () => {
    expect(
      validateGlAccountRefs(
        { revenueAccountId: null, cogsAccountId: null, inventoryAccountId: "1200" },
        [POSTABLE_ACCOUNT, HEADER_ACCOUNT],
      ),
    ).toEqual([]);
  });

  it("rejects a mapping pointing at an account that does not exist", () => {
    const reasons = validateGlAccountRefs(
      { revenueAccountId: "9999", cogsAccountId: null, inventoryAccountId: null },
      [POSTABLE_ACCOUNT],
    );
    expect(reasons).toEqual(['حساب الإيراد: account "9999" was not found']);
  });

  it("rejects a mapping pointing at a header (non-postable) account", () => {
    const reasons = validateGlAccountRefs(
      { revenueAccountId: null, cogsAccountId: null, inventoryAccountId: "1000" },
      [POSTABLE_ACCOUNT, HEADER_ACCOUNT],
    );
    expect(reasons).toEqual(['حساب المخزون: account "1000" is not a postable detail account']);
  });

  it("skips fields left null", () => {
    expect(
      validateGlAccountRefs({ revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null }, [POSTABLE_ACCOUNT]),
    ).toEqual([]);
  });
});

describe("collectItemFieldErrors", () => {
  it("passes for a well-formed stock item", () => {
    expect(collectItemFieldErrors(baseItem())).toEqual([]);
  });

  it("accepts an item with no category — a valid, unclassified state", () => {
    const item = baseItem({ categoryId: null });
    expect(collectItemFieldErrors(item)).toEqual([]);
    expect(item.categoryId).toBeNull();
  });

  it("accepts a sale/cost price carried to the full six-decimal scale", () => {
    const item = baseItem({ salePrice: Money.fromMajor("12.345678"), costPrice: Money.fromMajor("0.000001") });
    expect(collectItemFieldErrors(item)).toEqual([]);
    expect(item.salePrice?.toString()).toBe("12.345678");
    expect(item.costPrice?.toString()).toBe("0.000001");
  });

  it("rejects a blank Arabic name", () => {
    expect(collectItemFieldErrors(baseItem({ nameAr: "  " }))).toContain("nameAr is required");
  });

  it("rejects a blank base unit code", () => {
    expect(collectItemFieldErrors(baseItem({ baseUnitCode: " " }))).toContain("baseUnitCode is required");
  });

  it("rejects a type that cannot track stock but is asked to (asked as a capability, not a literal type check)", () => {
    const reasons = collectItemFieldErrors(baseItem({ type: "recipe", trackInventory: true }));
    expect(reasons).toContain("an item of type recipe cannot track inventory");
  });

  it("rejects batch/expiry tracking without trackInventory", () => {
    expect(collectItemFieldErrors(baseItem({ trackInventory: false, trackBatches: true }))).toContain(
      "batch/expiry tracking requires trackInventory",
    );
    expect(collectItemFieldErrors(baseItem({ trackInventory: false, trackExpiry: true }))).toContain(
      "batch/expiry tracking requires trackInventory",
    );
  });

  it("rejects a negative tax rate but accepts zero", () => {
    expect(collectItemFieldErrors(baseItem({ taxRatePercent: -1 }))).toContain(
      "taxRatePercent must be zero or a positive number",
    );
    expect(collectItemFieldErrors(baseItem({ taxRatePercent: 0 }))).toEqual([]);
  });

  it("rejects a negative reorderPoint or reorderQty", () => {
    expect(collectItemFieldErrors(baseItem({ reorderPoint: -1 }))).toContain("reorderPoint cannot be negative");
    expect(collectItemFieldErrors(baseItem({ reorderQty: -1 }))).toContain("reorderQty cannot be negative");
  });

  it("rejects a negative salePrice or costPrice", () => {
    expect(collectItemFieldErrors(baseItem({ salePrice: Money.fromMajor("-1") }))).toContain(
      "salePrice cannot be negative",
    );
    expect(collectItemFieldErrors(baseItem({ costPrice: Money.fromMajor("-1") }))).toContain(
      "costPrice cannot be negative",
    );
  });

  it("rejects a blank barcode", () => {
    expect(collectItemFieldErrors(baseItem({ barcodes: [""] }))).toContain("barcode cannot be blank");
  });

  it("rejects duplicate barcodes on the same item", () => {
    const reasons = collectItemFieldErrors(baseItem({ barcodes: ["6221234567890", "6221234567890"] }));
    expect(reasons).toContain('barcode "6221234567890" is duplicated');
  });

  it("accepts several distinct barcodes", () => {
    expect(collectItemFieldErrors(baseItem({ barcodes: ["111", "222", "333"] }))).toEqual([]);
  });

  it("folds in alternate-unit validation errors", () => {
    const reasons = collectItemFieldErrors(
      baseItem({ alternateUnits: [{ code: "PCS", name: "قطعة", factor: 1 }] }),
    );
    expect(reasons).toContain('alternate unit "PCS" cannot repeat the base unit');
  });

  it("accumulates every violation at once, not just the first", () => {
    const reasons = collectItemFieldErrors(
      baseItem({ nameAr: "", baseUnitCode: "", taxRatePercent: -1, reorderPoint: -1 }),
    );
    expect(reasons.length).toBeGreaterThanOrEqual(4);
  });
});
