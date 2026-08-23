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
} from "@mezan/domain";
import {
  createItemUnitSchema,
  updateItemUnitSchema,
  createItemCategorySchema,
  updateItemCategorySchema,
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
