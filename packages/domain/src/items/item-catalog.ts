/**
 * Item master-data catalogs (docs/archive/catalog/03 §"وحدة القياس" / §"تصنيفات
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

/**
 * العلامات التجارية — brands as records, not free text (R5.10). `brand` was a
 * string on the item, which is how "Nestle", "نستله" and "nestle " become three
 * brands nobody can filter by. An item points at one of these by id.
 */
export interface ItemBrand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly status: ItemCatalogStatus;
}

/**
 * المواسم — a selling season an item belongs to (R5.10). Dated, because "which
 * items are in this season" is a question with an answer that changes, and a
 * season with no dates cannot answer it.
 */
export interface ItemSeason {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly status: ItemCatalogStatus;
}

export interface ItemBrandRepository {
  findById(id: string): Promise<ItemBrand | null>;
  list(): Promise<ItemBrand[]>;
  create(brand: ItemBrand): Promise<void>;
  update(brand: ItemBrand): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ItemSeasonRepository {
  findById(id: string): Promise<ItemSeason | null>;
  list(): Promise<ItemSeason[]>;
  create(season: ItemSeason): Promise<void>;
  update(season: ItemSeason): Promise<void>;
  delete(id: string): Promise<void>;
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
  readonly messageEn: string;
  constructor(readonly unitCode: string) {
    super(`كود وحدة الصنف "${unitCode}" مستخدم من قبل.`);
    this.messageEn = `Unit code "${unitCode}" already exists.`;
    this.name = "DuplicateItemUnitCodeError";
  }
}

export class ItemUnitNotFoundError extends Error {
  readonly code = "ITEM_UNIT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly unitCode: string) {
    super(`وحدة الصنف "${unitCode}" غير موجودة.`);
    this.messageEn = `Unit "${unitCode}" was not found.`;
    this.name = "ItemUnitNotFoundError";
  }
}

export class DuplicateItemCategoryError extends Error {
  readonly code = "DUPLICATE_ITEM_CATEGORY";
  readonly messageEn: string;
  constructor(readonly categoryId: string) {
    super(`فئة الصنف "${categoryId}" مستخدمة من قبل.`);
    this.messageEn = `Item category "${categoryId}" already exists.`;
    this.name = "DuplicateItemCategoryError";
  }
}

export class ItemCategoryNotFoundError extends Error {
  readonly code = "ITEM_CATEGORY_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly categoryId: string) {
    super(`فئة الصنف "${categoryId}" غير موجودة.`);
    this.messageEn = `Item category "${categoryId}" was not found.`;
    this.name = "ItemCategoryNotFoundError";
  }
}

export class InvalidItemCategoryError extends Error {
  readonly code = "INVALID_ITEM_CATEGORY";
  readonly messageEn: string;
  constructor(messageAr: string, messageEn: string) {
    super(messageAr);
    this.messageEn = messageEn;
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
  if (parentId === categoryId)
    throw new InvalidItemCategoryError("لا يمكن أن تكون الفئة أباً لنفسها.", "A category cannot be its own parent.");
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
