import {
  DuplicateItemCategoryCodeError,
  InvalidItemCategoryError,
  ItemCategoryInUseError,
  ItemCategoryNotFoundError,
} from "./errors.js";
import type { ItemRepository } from "./item.js";

/**
 * Item category (docs/catalog/03-inventory.md "تصنيفات الأصناف") — a nestable
 * grouping over the item catalog. A tenant defines its own tree; nothing is
 * seeded, so the list legitimately starts empty.
 */
export interface ItemCategory {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly parentId: string | null;
  readonly active: boolean;
}

export interface ItemCategoryRepository {
  list(): Promise<ItemCategory[]>;
  findById(id: string): Promise<ItemCategory | null>;
  findByCode(code: string): Promise<ItemCategory | null>;
  save(category: ItemCategory): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CreateItemCategoryCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly parentId?: string | null;
  readonly active?: boolean;
}

export interface UpdateItemCategoryCommand {
  readonly nameAr?: string;
  readonly parentId?: string | null;
  readonly active?: boolean;
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;

function validate(category: ItemCategory): string[] {
  const reasons: string[] = [];
  if (category.id.trim() === "") reasons.push("id is required");
  if (!CODE_PATTERN.test(category.code)) {
    reasons.push("code must be 1-20 uppercase alphanumeric/-/_ characters");
  }
  if (category.nameAr.trim() === "") reasons.push("nameAr is required");
  if (category.parentId !== null && category.parentId === category.id) {
    reasons.push("a category cannot be its own parent");
  }
  return reasons;
}

/** Walks up from `parentId`; throws when the chain reaches `id` (a cycle) or a missing node. */
async function assertParentResolves(
  category: ItemCategory,
  repo: ItemCategoryRepository,
): Promise<void> {
  let cursor = category.parentId;
  const seen = new Set<string>([category.id]);
  while (cursor !== null) {
    if (seen.has(cursor)) throw new InvalidItemCategoryError(["parent chain forms a cycle"]);
    seen.add(cursor);
    const parent = await repo.findById(cursor);
    if (!parent) throw new InvalidItemCategoryError([`parent category "${cursor}" does not exist`]);
    cursor = parent.parentId;
  }
}

export async function createItemCategory(
  command: CreateItemCategoryCommand,
  repo: ItemCategoryRepository,
): Promise<ItemCategory> {
  const category: ItemCategory = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    parentId: command.parentId ?? null,
    active: command.active ?? true,
  };
  const reasons = validate(category);
  if (reasons.length > 0) throw new InvalidItemCategoryError(reasons);
  if (await repo.findByCode(category.code)) throw new DuplicateItemCategoryCodeError(category.code);
  await assertParentResolves(category, repo);
  await repo.save(category);
  return category;
}

/** Applies a patch to an existing category. `code` is immutable after creation. */
export async function updateItemCategory(
  id: string,
  patch: UpdateItemCategoryCommand,
  repo: ItemCategoryRepository,
): Promise<ItemCategory> {
  const current = await repo.findById(id);
  if (!current) throw new ItemCategoryNotFoundError(id);
  const next: ItemCategory = {
    ...current,
    nameAr: patch.nameAr ?? current.nameAr,
    parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
    active: patch.active ?? current.active,
  };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidItemCategoryError(reasons);
  if (next.parentId !== current.parentId) await assertParentResolves(next, repo);
  await repo.save(next);
  return next;
}

/** Deletes a category no item is filed under and no other category nests below. */
export async function deleteItemCategory(
  id: string,
  repo: ItemCategoryRepository,
  items: ItemRepository,
): Promise<void> {
  const category = await repo.findById(id);
  if (!category) throw new ItemCategoryNotFoundError(id);

  const usedByItems = (await items.list()).filter((item) => item.categoryId === id).length;
  const children = (await repo.list()).filter((other) => other.parentId === id).length;
  if (usedByItems + children > 0) {
    throw new ItemCategoryInUseError(category.code, usedByItems + children);
  }

  await repo.delete(id);
}
