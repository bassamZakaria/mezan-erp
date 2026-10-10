import { postingRefusalResponse } from "./posting-refusal.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  createProductTemplate,
  addTemplateAttribute,
  addAttributeValue,
  deleteTemplateAttribute,
  deleteAttributeValue,
  generateVariants,
  DuplicateProductTemplateCodeError,
  InvalidProductTemplateError,
  ProductTemplateNotFoundError,
  AttributeNotFoundError,
  DuplicateAttributeNameError,
  DuplicateAttributeValueError,
  AttributeInUseError,
  AttributeValueInUseError,
  NoAttributesDefinedError,
  EmptyVariantSelectionError,
  InvalidVariantSelectionError,
  Money,
  DuplicateItemCodeError,
  InvalidItemError,
  type ProductTemplate,
  type ProductTemplateRepository,
  type ProductTemplateVariant,
  type ProductTemplateVariantRepository,
  type ItemRepository,
  ItemSpecificationNotFoundError,
  type ItemSpecificationRepository,
} from "@mezan/domain";
import {
  createProductTemplateSchema,
  addTemplateAttributeSchema,
  addAttributeValueSchema,
  generateVariantsSchema,
} from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * Product Templates routes (docs/archive/catalog/03-inventory.md §"قوالب المنتجات"):
 * template CRUD, attribute CRUD (guarded delete), and the variant/SKU
 * generator (creates REAL Items via `@mezan/domain`'s `createItem`, reused
 * wholesale through `generateVariants`). Root-relative — a parent app mounts
 * this router under `/inventory/product-templates`.
 */
export interface ProductTemplatesRoutesDeps {
  readonly templates: ProductTemplateRepository;
  readonly variants: ProductTemplateVariantRepository;
  readonly items: ItemRepository;
  /**
   * المواصفات registry, when the app mounts one: an attribute may then be built
   * from a registry entry (`specificationCode`) instead of typed out, and the
   * registry counts/guards that binding.
   */
  readonly specifications?: ItemSpecificationRepository;
  /** Generates ids when the request omits them. Defaults to `randomUUID`. */
  readonly idGen?: () => string;
}

function serializeTemplate(template: ProductTemplate) {
  return {
    id: template.id,
    code: template.code,
    nameAr: template.nameAr,
    nameEn: template.nameEn,
    baseUnitCode: template.baseUnitCode,
    categoryId: template.categoryId,
    brandId: template.brandId,
    costingMethod: template.costingMethod,
    defaultSalePrice: template.defaultSalePrice?.toString() ?? null,
    defaultCost: template.defaultCost?.toString() ?? null,
    taxRatePercent: template.taxRatePercent,
    attributes: template.attributes,
    status: template.status,
  };
}

function serializeVariant(variant: ProductTemplateVariant) {
  return {
    id: variant.id,
    templateId: variant.templateId,
    itemId: variant.itemId,
    itemCode: variant.itemCode,
    values: variant.values,
    createdAt: variant.createdAt,
  };
}

function withMessageEn(err: { code: string; message: string }) {
  const messageEn = (err as { messageEn?: string }).messageEn;
  return { error: err.code, message: err.message, ...(messageEn ? { messageEn } : {}) };
}

function handleDomainError(c: Context, err: unknown) {
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (
    err instanceof ProductTemplateNotFoundError ||
    err instanceof AttributeNotFoundError ||
    err instanceof ItemSpecificationNotFoundError
  ) {
    return c.json(withMessageEn(err), 404);
  }
  if (
    err instanceof DuplicateProductTemplateCodeError ||
    err instanceof DuplicateAttributeNameError ||
    err instanceof DuplicateAttributeValueError ||
    err instanceof DuplicateItemCodeError ||
    err instanceof AttributeInUseError ||
    err instanceof AttributeValueInUseError
  ) {
    return c.json(withMessageEn(err), 409);
  }
  if (
    err instanceof InvalidProductTemplateError ||
    err instanceof InvalidItemError ||
    err instanceof NoAttributesDefinedError ||
    err instanceof EmptyVariantSelectionError ||
    err instanceof InvalidVariantSelectionError
  ) {
    return c.json(withMessageEn(err), 422);
  }
  throw err;
}

export function createProductTemplatesRoutes(
  deps: ProductTemplatesRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;

  app.get("/", gate("inventory.template.view"), async (c) => {
    const templates = await deps.templates.list();
    return c.json(templates.map(serializeTemplate));
  });

  app.post("/", gate("inventory.template.manage"), async (c) => {
    const parsed = createProductTemplateSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const template = await createProductTemplate(
        {
          id: idGen(),
          ...parsed.data,
          defaultSalePrice: parsed.data.defaultSalePrice != null ? Money.fromMajor(parsed.data.defaultSalePrice) : null,
          defaultCost: parsed.data.defaultCost != null ? Money.fromMajor(parsed.data.defaultCost) : null,
        },
        deps.templates,
      );
      return c.json(serializeTemplate(template), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id", gate("inventory.template.view"), async (c) => {
    const template = await deps.templates.findById(c.req.param("id"));
    if (!template) return c.json({ error: "PRODUCT_TEMPLATE_NOT_FOUND" }, 404);
    return c.json(serializeTemplate(template));
  });

  app.post("/:id/attributes", gate("inventory.template.manage"), async (c) => {
    const parsed = addTemplateAttributeSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const fromRegistry = parsed.data.specificationCode
        ? await deps.specifications?.findByCode(parsed.data.specificationCode)
        : null;
      if (parsed.data.specificationCode && !fromRegistry) {
        throw new ItemSpecificationNotFoundError(parsed.data.specificationCode);
      }
      const nameAr = fromRegistry?.nameAr ?? parsed.data.nameAr;
      const values = parsed.data.values ?? fromRegistry?.values;
      if (!nameAr || !values) {
        return c.json({ error: "VALIDATION_ERROR", message: "اسم الخاصية وقيمها مطلوبة." }, 400);
      }
      const template = await addTemplateAttribute(
        {
          templateId: c.req.param("id"),
          attributeId: idGen(),
          nameAr,
          nameEn: fromRegistry?.nameEn ?? parsed.data.nameEn,
          values,
          specificationCode: fromRegistry?.code ?? null,
        },
        { templates: deps.templates, variants: deps.variants },
      );
      return c.json(serializeTemplate(template), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id/attributes/:attributeId", gate("inventory.template.manage"), async (c) => {
    try {
      const template = await deleteTemplateAttribute(
        { templateId: c.req.param("id"), attributeId: c.req.param("attributeId") },
        { templates: deps.templates, variants: deps.variants },
      );
      return c.json(serializeTemplate(template));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/:id/attributes/:attributeId/values", gate("inventory.template.manage"), async (c) => {
    const parsed = addAttributeValueSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const template = await addAttributeValue(
        { templateId: c.req.param("id"), attributeId: c.req.param("attributeId"), value: parsed.data.value },
        { templates: deps.templates, variants: deps.variants },
      );
      return c.json(serializeTemplate(template), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id/attributes/:attributeId/values/:value", gate("inventory.template.manage"), async (c) => {
    try {
      const template = await deleteAttributeValue(
        { templateId: c.req.param("id"), attributeId: c.req.param("attributeId"), value: decodeURIComponent(c.req.param("value")) },
        { templates: deps.templates, variants: deps.variants },
      );
      return c.json(serializeTemplate(template));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/:id/variants", gate("inventory.template.view"), async (c) => {
    const variants = await deps.variants.listByTemplate(c.req.param("id"));
    return c.json(variants.map(serializeVariant));
  });

  app.post("/:id/variants/generate", gate("inventory.template.generate"), async (c) => {
    const parsed = generateVariantsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      const result = await generateVariants(
        { templateId: c.req.param("id"), selections: parsed.data.selections, idGen },
        { templates: deps.templates, variants: deps.variants, items: deps.items },
      );
      return c.json({ created: result.created.map(serializeVariant), skippedExisting: result.skippedExisting }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
