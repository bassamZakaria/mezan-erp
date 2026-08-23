/**
 * Item master-data catalogs (docs/catalog/03 §"وحدة القياس" / §"تصنيفات
 * الأصناف"): units of measure and item categories. Both are tenant records an
 * `Item` points at — `baseUnitCode`/alternate-unit codes resolve to an
 * `ItemUnit`, `categoryId` to an `ItemCategory`.
 */

export type ItemCatalogStatus = "active" | "inactive";

export interface ItemUnit {
  /** Uppercase code (`PCS`, `KG`, …) — the value items store, so it is the identity. */
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly status: ItemCatalogStatus;
}

export interface ItemCategory {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** Optional parent for a nested catalog; null for a root category. */
  readonly parentId: string | null;
  readonly status: ItemCatalogStatus;
}

export interface ItemUnitRepository {
  findByCode(code: string): Promise<ItemUnit | null>;
  list(): Promise<ItemUnit[]>;
  create(unit: ItemUnit): Promise<void>;
  update(unit: ItemUnit): Promise<void>;
}

export interface ItemCategoryRepository {
  findById(id: string): Promise<ItemCategory | null>;
  list(): Promise<ItemCategory[]>;
  create(category: ItemCategory): Promise<void>;
  update(category: ItemCategory): Promise<void>;
}

export class DuplicateItemUnitCodeError extends Error {
  readonly code = "DUPLICATE_ITEM_UNIT_CODE";
  constructor(readonly unitCode: string) {
    super(`Unit code "${unitCode}" already exists.`);
    this.name = "DuplicateItemUnitCodeError";
  }
}

export class ItemUnitNotFoundError extends Error {
  readonly code = "ITEM_UNIT_NOT_FOUND";
  constructor(readonly unitCode: string) {
    super(`Unit "${unitCode}" was not found.`);
    this.name = "ItemUnitNotFoundError";
  }
}

export class DuplicateItemCategoryError extends Error {
  readonly code = "DUPLICATE_ITEM_CATEGORY";
  constructor(readonly categoryId: string) {
    super(`Item category "${categoryId}" already exists.`);
    this.name = "DuplicateItemCategoryError";
  }
}

export class ItemCategoryNotFoundError extends Error {
  readonly code = "ITEM_CATEGORY_NOT_FOUND";
  constructor(readonly categoryId: string) {
    super(`Item category "${categoryId}" was not found.`);
    this.name = "ItemCategoryNotFoundError";
  }
}

export class InvalidItemCategoryError extends Error {
  readonly code = "INVALID_ITEM_CATEGORY";
  constructor(message: string) {
    super(message);
    this.name = "InvalidItemCategoryError";
  }
}

export interface CreateItemUnitCommand {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
}

export interface UpdateItemUnitCommand {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly status?: ItemCatalogStatus;
}

export async function createItemUnit(command: CreateItemUnitCommand, repo: ItemUnitRepository): Promise<ItemUnit> {
  const code = command.code.toUpperCase();
  if (await repo.findByCode(code)) throw new DuplicateItemUnitCodeError(code);
  const unit: ItemUnit = { code, nameAr: command.nameAr, nameEn: command.nameEn ?? null, status: "active" };
  await repo.create(unit);
  return unit;
}

export async function updateItemUnit(
  code: string,
  command: UpdateItemUnitCommand,
  repo: ItemUnitRepository,
): Promise<ItemUnit> {
  const current = await repo.findByCode(code);
  if (!current) throw new ItemUnitNotFoundError(code);
  const next: ItemUnit = {
    ...current,
    nameAr: command.nameAr ?? current.nameAr,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    status: command.status ?? current.status,
  };
  await repo.update(next);
  return next;
}

export interface CreateItemCategoryCommand {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly parentId?: string | null;
}

export interface UpdateItemCategoryCommand {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly parentId?: string | null;
  readonly status?: ItemCatalogStatus;
}

async function assertParentResolves(
  categoryId: string,
  parentId: string | null,
  repo: ItemCategoryRepository,
): Promise<void> {
  if (parentId === null) return;
  if (parentId === categoryId) throw new InvalidItemCategoryError("A category cannot be its own parent.");
  if (!(await repo.findById(parentId))) throw new ItemCategoryNotFoundError(parentId);
}

export async function createItemCategory(
  command: CreateItemCategoryCommand,
  repo: ItemCategoryRepository,
): Promise<ItemCategory> {
  if (await repo.findById(command.id)) throw new DuplicateItemCategoryError(command.id);
  const parentId = command.parentId ?? null;
  await assertParentResolves(command.id, parentId, repo);
  const category: ItemCategory = {
    id: command.id,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    parentId,
    status: "active",
  };
  await repo.create(category);
  return category;
}

export async function updateItemCategory(
  id: string,
  command: UpdateItemCategoryCommand,
  repo: ItemCategoryRepository,
): Promise<ItemCategory> {
  const current = await repo.findById(id);
  if (!current) throw new ItemCategoryNotFoundError(id);
  const parentId = command.parentId !== undefined ? command.parentId : current.parentId;
  await assertParentResolves(id, parentId, repo);
  const next: ItemCategory = {
    ...current,
    nameAr: command.nameAr ?? current.nameAr,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    parentId,
    status: command.status ?? current.status,
  };
  await repo.update(next);
  return next;
}
