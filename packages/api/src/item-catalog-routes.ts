import { Hono, type Context } from "hono";
import {
  createItemUnit,
  updateItemUnit,
  createItemCategory,
  updateItemCategory,
  DuplicateItemUnitCodeError,
  ItemUnitNotFoundError,
  DuplicateItemCategoryError,
  ItemCategoryNotFoundError,
  InvalidItemCategoryError,
  type ItemCategory,
  type ItemCategoryRepository,
  type ItemUnit,
  type ItemUnitRepository,
  type ItemBrand,
  type ItemBrandRepository,
  type ItemSeason,
  type ItemSeasonRepository,
} from "@mezan/domain";
import {
  createItemUnitSchema,
  updateItemUnitSchema,
  createItemCategorySchema,
  updateItemCategorySchema,
  upsertItemBrandSchema,
  upsertItemSeasonSchema,
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Item master-data catalogs (docs/catalog/03 §"وحدة القياس" / §"تصنيفات
 * الأصناف"), mounted at `/item-units` and `/item-categories`. Both are item
 * master data, so they reuse the item permissions (`inventory.item.view` to
 * read, `.create` / `.edit` to write) rather than introducing new codes.
 */

function serializeUnit(unit: ItemUnit) {
  return { code: unit.code, nameAr: unit.nameAr, nameEn: unit.nameEn, status: unit.status };
}

function serializeCategory(category: ItemCategory) {
  return {
    id: category.id,
    nameAr: category.nameAr,
    nameEn: category.nameEn,
    parentId: category.parentId,
    status: category.status,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof ItemUnitNotFoundError || err instanceof ItemCategoryNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateItemUnitCodeError || err instanceof DuplicateItemCategoryError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidItemCategoryError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

export function createItemUnitsRoutes(
  repo: ItemUnitRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => {
    return c.json((await repo.list()).map(serializeUnit));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createItemUnitSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeUnit(await createItemUnit(parsed.data, repo)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:code", gate("inventory.item.edit"), async (c) => {
    const parsed = updateItemUnitSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeUnit(await updateItemUnit(c.req.param("code"), parsed.data, repo)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

export function createItemCategoriesRoutes(
  repo: ItemCategoryRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => {
    return c.json((await repo.list()).map(serializeCategory));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createItemCategorySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeCategory(await createItemCategory(parsed.data, repo)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("inventory.item.edit"), async (c) => {
    const parsed = updateItemCategorySchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeCategory(await updateItemCategory(c.req.param("id"), parsed.data, repo)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

/**
 * العلامات التجارية and المواسم (R5.10), mounted at `/item-brands` and
 * `/item-seasons`. Both are item master data an `Item` points at by id, and
 * both reuse the item permissions for the same reason units and categories do.
 *
 * The brand used to be a free-text field on the item, which is how one brand
 * becomes three spellings nobody can filter by.
 */
function serializeBrand(brand: ItemBrand) {
  return { id: brand.id, code: brand.code, nameAr: brand.nameAr, nameEn: brand.nameEn, status: brand.status };
}

function serializeSeason(season: ItemSeason) {
  return {
    id: season.id,
    code: season.code,
    nameAr: season.nameAr,
    nameEn: season.nameEn,
    startDate: season.startDate,
    endDate: season.endDate,
    status: season.status,
  };
}

export function createItemBrandsRoutes(
  repo: ItemBrandRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => c.json((await repo.list()).map(serializeBrand)));

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const brand = await repo.findById(c.req.param("id"));
    if (!brand) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeBrand(brand));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = upsertItemBrandSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    if (await repo.findById(parsed.data.id)) return c.json({ error: "ALREADY_EXISTS" }, 409);
    const brand: ItemBrand = { ...parsed.data, nameEn: parsed.data.nameEn ?? null, status: parsed.data.status ?? "active" };
    await repo.create(brand);
    return c.json(serializeBrand(brand), 201);
  });

  app.put("/:id", gate("inventory.item.edit"), async (c) => {
    const existing = await repo.findById(c.req.param("id"));
    if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
    const parsed = upsertItemBrandSchema.safeParse({ ...(await c.req.json()), id: c.req.param("id") });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const brand: ItemBrand = { ...parsed.data, nameEn: parsed.data.nameEn ?? null, status: parsed.data.status ?? existing.status };
    await repo.update(brand);
    return c.json(serializeBrand(brand));
  });

  return app;
}

export function createItemSeasonsRoutes(
  repo: ItemSeasonRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => c.json((await repo.list()).map(serializeSeason)));

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const season = await repo.findById(c.req.param("id"));
    if (!season) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeSeason(season));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = upsertItemSeasonSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    if (await repo.findById(parsed.data.id)) return c.json({ error: "ALREADY_EXISTS" }, 409);
    const season: ItemSeason = {
      ...parsed.data,
      nameEn: parsed.data.nameEn ?? null,
      startDate: parsed.data.startDate ?? null,
      endDate: parsed.data.endDate ?? null,
      status: parsed.data.status ?? "active",
    };
    await repo.create(season);
    return c.json(serializeSeason(season), 201);
  });

  app.put("/:id", gate("inventory.item.edit"), async (c) => {
    const existing = await repo.findById(c.req.param("id"));
    if (!existing) return c.json({ error: "NOT_FOUND" }, 404);
    const parsed = upsertItemSeasonSchema.safeParse({ ...(await c.req.json()), id: c.req.param("id") });
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const season: ItemSeason = {
      ...parsed.data,
      nameEn: parsed.data.nameEn ?? null,
      startDate: parsed.data.startDate ?? null,
      endDate: parsed.data.endDate ?? null,
      status: parsed.data.status ?? existing.status,
    };
    await repo.update(season);
    return c.json(serializeSeason(season));
  });

  return app;
}
