import { Hono, type Context } from "hono";
import {
  createItemUnit,
  updateItemUnit,
  deleteItemUnit,
  createItemCategory,
  updateItemCategory,
  deleteItemCategory,
  DuplicateItemUnitCodeError,
  InvalidItemUnitError,
  ItemUnitNotFoundError,
  ItemUnitInUseError,
  DuplicateItemCategoryCodeError,
  InvalidItemCategoryError,
  ItemCategoryNotFoundError,
  ItemCategoryInUseError,
  type ItemUnit,
  type ItemUnitRepository,
  type ItemCategory,
  type ItemCategoryRepository,
  type ItemRepository,
} from "@mezan/domain";
import {
  createItemUnitSchema,
  updateItemUnitSchema,
  createItemCategorySchema,
  updateItemCategorySchema,
} from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function serializeUnit(unit: ItemUnit) {
  return {
    id: unit.id,
    code: unit.code,
    nameAr: unit.nameAr,
    baseUnitCode: unit.baseUnitCode,
    factor: unit.factor,
    active: unit.active,
  };
}

function serializeCategory(category: ItemCategory) {
  return {
    id: category.id,
    code: category.code,
    nameAr: category.nameAr,
    parentId: category.parentId,
    active: category.active,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof ItemUnitNotFoundError || err instanceof ItemCategoryNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (
    err instanceof DuplicateItemUnitCodeError ||
    err instanceof DuplicateItemCategoryCodeError ||
    err instanceof ItemUnitInUseError ||
    err instanceof ItemCategoryInUseError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidItemUnitError || err instanceof InvalidItemCategoryError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

/**
 * وحدات القياس (docs/catalog/03) — the unit catalog items pick their base unit
 * from. Gated with the same `inventory.item.*` permissions as the item master
 * data it is reference data for.
 */
export function createItemUnitsRouter(
  units: ItemUnitRepository,
  items: ItemRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => {
    return c.json((await units.list()).map(serializeUnit));
  });

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const unit = await units.findById(c.req.param("id"));
    if (!unit) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeUnit(unit));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createItemUnitSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      return c.json(serializeUnit(await createItemUnit(parsed.data, units)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("inventory.item.edit"), async (c) => {
    const parsed = updateItemUnitSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      return c.json(serializeUnit(await updateItemUnit(c.req.param("id"), parsed.data, units)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id", gate("inventory.item.edit"), async (c) => {
    try {
      await deleteItemUnit(c.req.param("id"), units, items);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

/**
 * تصنيفات الأصناف (docs/catalog/03) — the nestable category tree. Nothing is
 * seeded: a tenant defines its own, so an empty list is a real, correct state.
 */
export function createItemCategoriesRouter(
  categories: ItemCategoryRepository,
  items: ItemRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => {
    return c.json((await categories.list()).map(serializeCategory));
  });

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const category = await categories.findById(c.req.param("id"));
    if (!category) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeCategory(category));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createItemCategorySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      return c.json(serializeCategory(await createItemCategory(parsed.data, categories)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("inventory.item.edit"), async (c) => {
    const parsed = updateItemCategorySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      return c.json(serializeCategory(await updateItemCategory(c.req.param("id"), parsed.data, categories)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id", gate("inventory.item.edit"), async (c) => {
    try {
      await deleteItemCategory(c.req.param("id"), categories, items);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
