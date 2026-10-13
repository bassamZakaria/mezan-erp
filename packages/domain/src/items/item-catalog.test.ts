import { describe, it, expect } from "vitest";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";
import { insertOnly } from "../records/test-helpers/insert-only.js";
import {
  createItemUnit,
  updateItemUnit,
  createItemCategory,
  updateItemCategory,
  DuplicateItemUnitCodeError,
  ItemUnitNotFoundError,
  ItemCategoryNotFoundError,
  InvalidItemCategoryError,
  type ItemUnit,
  type ItemUnitRepository,
  type ItemCategory,
  type ItemCategoryRepository,
} from "./item-catalog.js";

class InMemoryItemUnits implements ItemUnitRepository {
  readonly rows = new Map<string, ItemUnit>();
  async findByCode(code: string): Promise<ItemUnit | null> {
    return this.rows.get(code) ?? null;
  }
  async list(): Promise<ItemUnit[]> {
    return [...this.rows.values()];
  }
  async create(unit: ItemUnit): Promise<void> {
    this.rows.set(unit.code, unit);
  }
  async update(unit: ItemUnit): Promise<void> {
    this.rows.set(unit.code, unit);
  }
}

class InMemoryItemCategories implements ItemCategoryRepository {
  readonly rows = new Map<string, ItemCategory>();
  async findById(id: string): Promise<ItemCategory | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<ItemCategory[]> {
    return [...this.rows.values()];
  }
  async create(category: ItemCategory): Promise<void> {
    insertOnly(this.rows, category.id, category);
  }
  async update(category: ItemCategory): Promise<void> {
    this.rows.set(category.id, category);
  }
}

describe("item units", () => {
  it("creates a unit, uppercasing the code, defaulting to active", async () => {
    const repo = new InMemoryItemUnits();
    const unit = await createItemUnit({ code: "pcs", nameAr: "قطعة" }, repo);
    expect(unit.code).toBe("PCS");
    expect(unit.status).toBe("active");
    expect(await repo.findByCode("PCS")).toEqual(unit);
  });

  it("rejects a duplicate unit code (case-insensitive via uppercasing)", async () => {
    const repo = new InMemoryItemUnits();
    await createItemUnit({ code: "PCS", nameAr: "قطعة" }, repo);
    await expect(createItemUnit({ code: "pcs", nameAr: "نسخة" }, repo)).rejects.toThrow(DuplicateItemUnitCodeError);
  });

  it("updates a unit's name and status, leaving the code fixed", async () => {
    const repo = new InMemoryItemUnits();
    await createItemUnit({ code: "PCS", nameAr: "قطعة" }, repo);
    const updated = await updateItemUnit("PCS", { nameAr: "قطعة واحدة", status: "inactive" }, repo);
    expect(updated.nameAr).toBe("قطعة واحدة");
    expect(updated.status).toBe("inactive");
  });

  it("404s updating an unknown unit", async () => {
    const repo = new InMemoryItemUnits();
    await expect(updateItemUnit("NOPE", { nameAr: "x" }, repo)).rejects.toThrow(ItemUnitNotFoundError);
  });

  it("clears nameEn explicitly when the patch sets it to null", async () => {
    const repo = new InMemoryItemUnits();
    await createItemUnit({ code: "PCS", nameAr: "قطعة", nameEn: "Piece" }, repo);
    const updated = await updateItemUnit("PCS", { nameEn: null }, repo);
    expect(updated.nameEn).toBeNull();
  });
});

describe("item categories", () => {
  it("creates a root category with no parent", async () => {
    const repo = new InMemoryItemCategories();
    const category = await createItemCategory({ id: "cat-1", nameAr: "مشروبات" }, repo);
    expect(category.parentId).toBeNull();
    expect(category.status).toBe("active");
  });

  it("creates a nested category under a real parent", async () => {
    const repo = new InMemoryItemCategories();
    await createItemCategory({ id: "cat-1", nameAr: "مشروبات" }, repo);
    const child = await createItemCategory({ id: "cat-2", nameAr: "مياه غازية", parentId: "cat-1" }, repo);
    expect(child.parentId).toBe("cat-1");
  });

  it("rejects a duplicate category id", async () => {
    const repo = new InMemoryItemCategories();
    await createItemCategory({ id: "cat-1", nameAr: "مشروبات" }, repo);
    await expect(createItemCategory({ id: "cat-1", nameAr: "نسخة" }, repo)).rejects.toThrow(DuplicateRecordIdError);
  });

  it("404s a parentId that does not resolve", async () => {
    const repo = new InMemoryItemCategories();
    await expect(createItemCategory({ id: "cat-2", nameAr: "فرعي", parentId: "nope" }, repo)).rejects.toThrow(
      ItemCategoryNotFoundError,
    );
  });

  it("rejects a category naming itself as its own parent", async () => {
    const repo = new InMemoryItemCategories();
    await expect(createItemCategory({ id: "cat-1", nameAr: "مشروبات", parentId: "cat-1" }, repo)).rejects.toThrow(
      InvalidItemCategoryError,
    );
  });

  it("updates a category's name, parent and status", async () => {
    const repo = new InMemoryItemCategories();
    await createItemCategory({ id: "cat-1", nameAr: "مشروبات" }, repo);
    await createItemCategory({ id: "cat-2", nameAr: "أخرى" }, repo);
    const updated = await updateItemCategory("cat-2", { nameAr: "أطعمة", parentId: "cat-1", status: "inactive" }, repo);
    expect(updated.nameAr).toBe("أطعمة");
    expect(updated.parentId).toBe("cat-1");
    expect(updated.status).toBe("inactive");
  });

  it("re-validates the parent on update: rejects re-parenting a category onto itself", async () => {
    const repo = new InMemoryItemCategories();
    await createItemCategory({ id: "cat-1", nameAr: "مشروبات" }, repo);
    await expect(updateItemCategory("cat-1", { parentId: "cat-1" }, repo)).rejects.toThrow(InvalidItemCategoryError);
  });

  it("404s updating an unknown category", async () => {
    const repo = new InMemoryItemCategories();
    await expect(updateItemCategory("nope", { nameAr: "x" }, repo)).rejects.toThrow(ItemCategoryNotFoundError);
  });

  it("clearing a category's parent (making it root again) is allowed", async () => {
    const repo = new InMemoryItemCategories();
    await createItemCategory({ id: "cat-1", nameAr: "مشروبات" }, repo);
    await createItemCategory({ id: "cat-2", nameAr: "فرعي", parentId: "cat-1" }, repo);
    const updated = await updateItemCategory("cat-2", { parentId: null }, repo);
    expect(updated.parentId).toBeNull();
  });
});
