import { describe, it, expect } from "vitest";
import {
  DuplicateItemCodeError,
  ItemNotFoundError,
  InvalidItemError,
  DuplicateItemUnitCodeError,
  ItemUnitNotFoundError,
  InvalidItemUnitError,
  ItemUnitInUseError,
  ItemCategoryNotFoundError,
  InvalidItemCategoryError,
  ItemCategoryInUseError,
  DuplicateItemSpecificationCodeError,
  ItemSpecificationNotFoundError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
} from "./errors.js";

describe("items errors", () => {
  it("DuplicateItemCodeError names the code", () => {
    const err = new DuplicateItemCodeError("ITM-0001");
    expect(err.code).toBe("DUPLICATE_ITEM_CODE");
    expect(err.itemCode).toBe("ITM-0001");
    expect(err.message).toContain("ITM-0001");
  });

  it("ItemNotFoundError names the id", () => {
    const err = new ItemNotFoundError("itm-1");
    expect(err.code).toBe("ITEM_NOT_FOUND");
    expect(err.itemId).toBe("itm-1");
  });

  it("InvalidItemError joins every reason", () => {
    const err = new InvalidItemError([
      { ar: "اسم الصنف بالعربية مطلوب", en: "The Arabic item name is required" },
      { ar: "نسبة الضريبة يجب أن تكون صفرًا أو رقمًا موجبًا", en: "The tax rate must be zero or a positive number" },
    ]);
    expect(err.code).toBe("INVALID_ITEM");
    expect(err.reasons).toHaveLength(2);
    expect(err.message).toBe("بيانات الصنف غير صالحة: اسم الصنف بالعربية مطلوب، نسبة الضريبة يجب أن تكون صفرًا أو رقمًا موجبًا");
    expect(err.messageEn).toBe(
      "Invalid item: The Arabic item name is required; The tax rate must be zero or a positive number",
    );
  });

  it("DuplicateItemUnitCodeError names the code", () => {
    const err = new DuplicateItemUnitCodeError("PCS");
    expect(err.code).toBe("DUPLICATE_ITEM_UNIT_CODE");
    expect(err.unitCode).toBe("PCS");
  });

  it("ItemUnitNotFoundError names the id", () => {
    const err = new ItemUnitNotFoundError("KG");
    expect(err.code).toBe("ITEM_UNIT_NOT_FOUND");
  });

  it("InvalidItemUnitError joins reasons", () => {
    const err = new InvalidItemUnitError([{ ar: "وحدة غير صالحة", en: "The unit is not valid" }]);
    expect(err.code).toBe("INVALID_ITEM_UNIT");
    expect(err.message).toBe("بيانات وحدة الصنف غير صالحة: وحدة غير صالحة");
    expect(err.messageEn).toBe("Invalid item unit: The unit is not valid");
  });

  it("ItemUnitInUseError names the code and reference count", () => {
    const err = new ItemUnitInUseError("PCS", 3);
    expect(err.code).toBe("ITEM_UNIT_IN_USE");
    expect(err.referenceCount).toBe(3);
    expect(err.message).toContain("3");
  });


  it("ItemCategoryNotFoundError names the id", () => {
    const err = new ItemCategoryNotFoundError("cat-1");
    expect(err.code).toBe("ITEM_CATEGORY_NOT_FOUND");
  });

  it("InvalidItemCategoryError joins reasons", () => {
    const err = new InvalidItemCategoryError(["bad category"]);
    expect(err.code).toBe("INVALID_ITEM_CATEGORY");
  });

  it("ItemCategoryInUseError names the code and reference count", () => {
    const err = new ItemCategoryInUseError("CAT-1", 2);
    expect(err.code).toBe("ITEM_CATEGORY_IN_USE");
    expect(err.referenceCount).toBe(2);
  });

  it("DuplicateItemSpecificationCodeError names the code", () => {
    const err = new DuplicateItemSpecificationCodeError("COLOR");
    expect(err.code).toBe("DUPLICATE_ITEM_SPECIFICATION_CODE");
  });

  it("ItemSpecificationNotFoundError names the code", () => {
    const err = new ItemSpecificationNotFoundError("COLOR");
    expect(err.code).toBe("ITEM_SPECIFICATION_NOT_FOUND");
  });

  it("InvalidItemSpecificationError joins reasons", () => {
    const err = new InvalidItemSpecificationError(["nameAr is required"]);
    expect(err.code).toBe("INVALID_ITEM_SPECIFICATION");
  });

  it("ItemSpecificationInUseError names the code and reference count", () => {
    const err = new ItemSpecificationInUseError("COLOR", 5);
    expect(err.code).toBe("ITEM_SPECIFICATION_IN_USE");
    expect(err.referenceCount).toBe(5);
  });
});
