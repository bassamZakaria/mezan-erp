import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import {
  Money,
  createItemSpecification,
  updateItemSpecification,
  deleteItemSpecification,
  countItemSpecificationUsage,
  createProductTemplate,
  updateProductTemplate,
  deleteProductTemplate,
  generateProductTemplateVariants,
  setProductTemplateVariantPrice,
  projectProductTemplateVariants,
  DuplicateItemSpecificationCodeError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
  ItemSpecificationNotFoundError,
  DuplicateProductTemplateCodeError,
  InvalidProductTemplateError,
  ProductTemplateAlreadyGeneratedError,
  ProductTemplateNotFoundError,
  ProductTemplateVariantNotFoundError,
  DuplicateItemCodeError,
  InvalidItemError,
  ItemNotFoundError,
  type ItemRepository,
  type ItemSpecification,
  type ItemSpecificationRepository,
  type ProductTemplate,
  type ProductTemplateDeps,
  type ProductTemplateRepository,
} from "@mezan/domain";
import {
  createItemSpecificationSchema,
  updateItemSpecificationSchema,
  createProductTemplateSchema,
  updateProductTemplateSchema,
  setProductTemplateVariantPriceSchema,
} from "@mezan/contracts";
import {
  createPermissionGate,
  headerAuthContextResolver,
  type AuthContextResolver,
} from "./permission-gate.js";

function serializeSpecification(specification: ItemSpecification, usageCount: number) {
  return {
    id: specification.id,
    code: specification.code,
    nameAr: specification.nameAr,
    type: specification.type,
    values: specification.values,
    unit: specification.unit,
    filterable: specification.filterable,
    active: specification.active,
    usageCount,
  };
}

function serializeTemplate(template: ProductTemplate) {
  return {
    id: template.id,
    code: template.code,
    nameAr: template.nameAr,
    nameEn: template.nameEn,
    baseUnitCode: template.baseUnitCode,
    categoryId: template.categoryId,
    basePrice: template.basePrice?.toString() ?? null,
    taxRatePercent: template.taxRatePercent,
    costingMethod: template.costingMethod,
    options: template.options.map((o) => ({ specificationId: o.specificationId, values: o.values })),
    variants: template.variants.map((v) => ({
      sku: v.sku,
      values: v.values,
      nameAr: v.nameAr,
      salePrice: v.salePrice?.toString() ?? null,
      itemId: v.itemId,
    })),
    status: template.status,
    createdAt: template.createdAt,
    combinationCount: projectProductTemplateVariants(template).length,
  };
}

function toMoney(value: string | null | undefined): Money | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : Money.fromMajor(value);
}

function handleDomainError(c: Context, err: unknown) {
  if (
    err instanceof ItemSpecificationNotFoundError ||
    err instanceof ProductTemplateNotFoundError ||
    err instanceof ProductTemplateVariantNotFoundError ||
    err instanceof ItemNotFoundError
  ) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (
    err instanceof DuplicateItemSpecificationCodeError ||
    err instanceof ItemSpecificationInUseError ||
    err instanceof DuplicateProductTemplateCodeError ||
    err instanceof ProductTemplateAlreadyGeneratedError ||
    err instanceof DuplicateItemCodeError
  ) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof InvalidItemSpecificationError ||
    err instanceof InvalidProductTemplateError ||
    err instanceof InvalidItemError
  ) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  if (err instanceof RangeError) {
    return c.json({ error: "VALIDATION_ERROR", message: err.message }, 400);
  }
  throw err;
}

/**
 * المواصفات (specifications) — the reusable attribute registry product
 * templates draw their option axes from. Gated with the same `inventory.item.*`
 * permissions as the item master data it is reference data for. Nothing is
 * seeded: an empty registry is a real, correct state.
 */
export function createItemSpecificationsRouter(
  specifications: ItemSpecificationRepository,
  templates: ProductTemplateRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function withUsage(rows: ItemSpecification[]) {
    const allTemplates = await templates.list();
    return rows.map((specification) =>
      serializeSpecification(
        specification,
        allTemplates.filter((t) => t.options.some((o) => o.specificationId === specification.id)).length,
      ),
    );
  }

  app.get("/", gate("inventory.item.view"), async (c) => {
    return c.json(await withUsage(await specifications.list()));
  });

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const specification = await specifications.findById(c.req.param("id"));
    if (!specification) return c.json({ error: "NOT_FOUND" }, 404);
    const usage = await countItemSpecificationUsage(specification.id, templates);
    return c.json(serializeSpecification(specification, usage));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createItemSpecificationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const created = await createItemSpecification(parsed.data, specifications);
      return c.json(serializeSpecification(created, 0), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("inventory.item.edit"), async (c) => {
    const parsed = updateItemSpecificationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const updated = await updateItemSpecification(c.req.param("id"), parsed.data, specifications);
      const usage = await countItemSpecificationUsage(updated.id, templates);
      return c.json(serializeSpecification(updated, usage));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id", gate("inventory.item.edit"), async (c) => {
    try {
      await deleteItemSpecification(c.req.param("id"), specifications, templates);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

/**
 * قوالب المنتجات / منتجات بخيارات (product templates) — the retail variant
 * matrix. Generating materialises one real catalog item per combination, so
 * generation is gated with `inventory.item.create`, the same permission that
 * guards adding an item by hand.
 */
export function createProductTemplatesRouter(
  templates: ProductTemplateRepository,
  specifications: ItemSpecificationRepository,
  items: ItemRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const deps: ProductTemplateDeps = {
    templates,
    specifications,
    items,
    newItemId: () => randomUUID(),
  };

  app.get("/", gate("inventory.item.view"), async (c) => {
    return c.json((await templates.list()).map(serializeTemplate));
  });

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const template = await templates.findById(c.req.param("id"));
    if (!template) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeTemplate(template));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createProductTemplateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const created = await createProductTemplate(
        { ...parsed.data, basePrice: toMoney(parsed.data.basePrice) },
        deps,
      );
      return c.json(serializeTemplate(created), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("inventory.item.edit"), async (c) => {
    const parsed = updateProductTemplateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const updated = await updateProductTemplate(
        c.req.param("id"),
        { ...parsed.data, basePrice: toMoney(parsed.data.basePrice) },
        deps,
      );
      return c.json(serializeTemplate(updated));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/generate", gate("inventory.item.create"), async (c) => {
    try {
      return c.json(serializeTemplate(await generateProductTemplateVariants(c.req.param("id"), deps)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id/variants/:sku", gate("inventory.item.edit"), async (c) => {
    const parsed = setProductTemplateVariantPriceSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const updated = await setProductTemplateVariantPrice(
        c.req.param("id"),
        c.req.param("sku"),
        parsed.data.salePrice === null ? null : Money.fromMajor(parsed.data.salePrice),
        deps,
      );
      return c.json(serializeTemplate(updated));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id", gate("inventory.item.edit"), async (c) => {
    try {
      await deleteProductTemplate(c.req.param("id"), deps);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
