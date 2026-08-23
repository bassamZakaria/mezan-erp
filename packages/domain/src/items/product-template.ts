import type { Money } from "../money/index.js";
import { createItem } from "./create-item.js";
import { updateItem } from "./update-item.js";
import type { CostingMethod, Item, ItemRepository } from "./item.js";
import type { ItemSpecificationRepository } from "./item-specification.js";
import {
  DuplicateProductTemplateCodeError,
  InvalidProductTemplateError,
  ProductTemplateAlreadyGeneratedError,
  ProductTemplateNotFoundError,
  ProductTemplateVariantNotFoundError,
} from "./product-catalog-errors.js";

/**
 * قوالب المنتجات ("منتجات بخيارات") — the retail variant matrix. A template
 * picks a set of select-list specifications (اللون × المقاس) and generates
 * their cartesian product as concrete catalog items, one per combination, each
 * with its own SKU and sale price.
 *
 * This is deliberately NOT `manufacturing/configurable-product.ts`: that one is
 * made-to-order, evaluates sandboxed formulas over free numeric inputs per
 * customer order, and produces a bill of materials — its combinations are
 * unbounded and never pre-materialised. A product template enumerates a finite,
 * closed option matrix up front and materialises every combination as a
 * sellable stock item.
 */
export type ProductTemplateStatus = "draft" | "generated";

export interface ProductTemplateOption {
  readonly specificationId: string;
  /** The chosen subset of that specification's allowed values, in display order. */
  readonly values: readonly string[];
}

export interface ProductTemplateVariant {
  /** Generated code, unique across the catalog — also the created item's code. */
  readonly sku: string;
  /** One value per option, index-aligned with the template's `options`. */
  readonly values: readonly string[];
  readonly nameAr: string;
  readonly salePrice: Money | null;
  /** The catalog item this variant materialised into; null while only projected. */
  readonly itemId: string | null;
}

export interface ProductTemplate {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly baseUnitCode: string;
  readonly categoryId: string | null;
  readonly basePrice: Money | null;
  readonly taxRatePercent: number;
  readonly costingMethod: CostingMethod;
  readonly options: readonly ProductTemplateOption[];
  readonly variants: readonly ProductTemplateVariant[];
  readonly status: ProductTemplateStatus;
  readonly createdAt: string;
}

export interface ProductTemplateRepository {
  list(): Promise<ProductTemplate[]>;
  findById(id: string): Promise<ProductTemplate | null>;
  findByCode(code: string): Promise<ProductTemplate | null>;
  save(template: ProductTemplate): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ProductTemplateOptionInput {
  readonly specificationId: string;
  readonly values: readonly string[];
}

export interface CreateProductTemplateCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly baseUnitCode: string;
  readonly categoryId?: string | null;
  readonly basePrice?: Money | null;
  readonly taxRatePercent?: number;
  readonly costingMethod?: CostingMethod;
  readonly options: readonly ProductTemplateOptionInput[];
}

export interface UpdateProductTemplateCommand {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly categoryId?: string | null;
  readonly basePrice?: Money | null;
  readonly taxRatePercent?: number;
  readonly costingMethod?: CostingMethod;
  readonly options?: readonly ProductTemplateOptionInput[];
}

export interface ProductTemplateDeps {
  readonly templates: ProductTemplateRepository;
  readonly specifications: ItemSpecificationRepository;
  readonly items: ItemRepository;
  /** Id factory for the generated catalog items — the domain never reaches for a driver. */
  readonly newItemId: () => string;
  readonly now?: () => string;
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;

/** A generated matrix past this size is a data-entry mistake, not a catalog. */
export const MAX_PRODUCT_TEMPLATE_VARIANTS = 250;

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

async function resolveOptions(
  options: readonly ProductTemplateOptionInput[],
  specifications: ItemSpecificationRepository,
): Promise<{ options: ProductTemplateOption[]; reasons: string[] }> {
  const reasons: string[] = [];
  const resolved: ProductTemplateOption[] = [];

  if (options.length === 0) reasons.push("at least one option (specification) is required");
  const seen = new Set<string>();

  for (const [index, option] of options.entries()) {
    if (seen.has(option.specificationId)) {
      reasons.push(`option ${index + 1}: specification is used more than once`);
      continue;
    }
    seen.add(option.specificationId);

    const specification = await specifications.findById(option.specificationId);
    if (!specification) {
      reasons.push(`option ${index + 1}: specification "${option.specificationId}" does not exist`);
      continue;
    }
    if (specification.type !== "select") {
      reasons.push(
        `option ${index + 1}: "${specification.nameAr}" is a ${specification.type} specification — only select lists generate variants`,
      );
      continue;
    }
    const values = option.values.map((v) => v.trim()).filter((v) => v !== "");
    if (values.length === 0) {
      reasons.push(`option ${index + 1}: pick at least one value of "${specification.nameAr}"`);
      continue;
    }
    if (new Set(values).size !== values.length) {
      reasons.push(`option ${index + 1}: values must be unique`);
      continue;
    }
    const unknown = values.filter((v) => !specification.values.includes(v));
    if (unknown.length > 0) {
      reasons.push(
        `option ${index + 1}: ${unknown.join("، ")} are not allowed values of "${specification.nameAr}"`,
      );
      continue;
    }
    resolved.push({ specificationId: specification.id, values });
  }

  return { options: resolved, reasons };
}

function validateHeader(command: {
  code: string;
  nameAr: string;
  baseUnitCode: string;
  taxRatePercent: number;
}): string[] {
  const reasons: string[] = [];
  if (!CODE_PATTERN.test(command.code)) {
    reasons.push("code must be 1-20 uppercase alphanumeric/-/_ characters");
  }
  if (command.nameAr.trim() === "") reasons.push("nameAr is required");
  if (command.baseUnitCode.trim() === "") reasons.push("a base unit is required");
  if (!Number.isFinite(command.taxRatePercent) || command.taxRatePercent < 0) {
    reasons.push("taxRatePercent must be zero or a positive number");
  }
  return reasons;
}

export async function createProductTemplate(
  command: CreateProductTemplateCommand,
  deps: ProductTemplateDeps,
): Promise<ProductTemplate> {
  const taxRatePercent = command.taxRatePercent ?? 14;
  const reasons = validateHeader({
    code: command.code,
    nameAr: command.nameAr,
    baseUnitCode: command.baseUnitCode,
    taxRatePercent,
  });
  const resolved = await resolveOptions(command.options, deps.specifications);
  reasons.push(...resolved.reasons);
  if (reasons.length > 0) throw new InvalidProductTemplateError(reasons);
  if (await deps.templates.findByCode(command.code)) {
    throw new DuplicateProductTemplateCodeError(command.code);
  }

  const template: ProductTemplate = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr.trim(),
    nameEn: command.nameEn?.trim() || null,
    baseUnitCode: command.baseUnitCode.trim(),
    categoryId: command.categoryId ?? null,
    basePrice: command.basePrice ?? null,
    taxRatePercent,
    costingMethod: command.costingMethod ?? "WAC",
    options: resolved.options,
    variants: [],
    status: "draft",
    createdAt: nowIso(deps),
  };
  await deps.templates.save(template);
  return template;
}

/**
 * Patches a template. `code` is immutable, and the option matrix may only
 * change while the template is still a draft — once generated, every
 * combination is a real catalog item whose SKU encodes its option positions.
 */
export async function updateProductTemplate(
  id: string,
  patch: UpdateProductTemplateCommand,
  deps: ProductTemplateDeps,
): Promise<ProductTemplate> {
  const current = await deps.templates.findById(id);
  if (!current) throw new ProductTemplateNotFoundError(id);

  let options = current.options;
  if (patch.options !== undefined) {
    if (current.variants.length > 0) {
      throw new ProductTemplateAlreadyGeneratedError(current.code, current.variants.length);
    }
    const resolved = await resolveOptions(patch.options, deps.specifications);
    if (resolved.reasons.length > 0) throw new InvalidProductTemplateError(resolved.reasons);
    options = resolved.options;
  }

  const taxRatePercent = patch.taxRatePercent ?? current.taxRatePercent;
  const next: ProductTemplate = {
    ...current,
    nameAr: (patch.nameAr ?? current.nameAr).trim(),
    nameEn: patch.nameEn === undefined ? current.nameEn : patch.nameEn?.trim() || null,
    categoryId: patch.categoryId === undefined ? current.categoryId : patch.categoryId,
    basePrice: patch.basePrice === undefined ? current.basePrice : patch.basePrice,
    taxRatePercent,
    costingMethod: patch.costingMethod ?? current.costingMethod,
    options,
  };
  const reasons = validateHeader({
    code: next.code,
    nameAr: next.nameAr,
    baseUnitCode: next.baseUnitCode,
    taxRatePercent: next.taxRatePercent,
  });
  if (reasons.length > 0) throw new InvalidProductTemplateError(reasons);
  await deps.templates.save(next);
  return next;
}

/** Deletes a template that never materialised into catalog items. */
export async function deleteProductTemplate(id: string, deps: ProductTemplateDeps): Promise<void> {
  const template = await deps.templates.findById(id);
  if (!template) throw new ProductTemplateNotFoundError(id);
  if (template.variants.length > 0) {
    throw new ProductTemplateAlreadyGeneratedError(template.code, template.variants.length);
  }
  await deps.templates.delete(id);
}

function cartesian(options: readonly ProductTemplateOption[]): string[][] {
  return options.reduce<string[][]>(
    (rows, option) => rows.flatMap((row) => option.values.map((value) => [...row, value])),
    [[]],
  );
}

/**
 * The projected matrix, without touching the catalog. The SKU encodes the
 * 1-based POSITION of each picked value inside its option, so a SKU stays
 * stable only while the option value order does — which is why the matrix is
 * frozen once generated.
 */
export function projectProductTemplateVariants(template: ProductTemplate): ProductTemplateVariant[] {
  return cartesian(template.options).map((values) => {
    const positions = values.map((value, index) => (template.options[index]?.values.indexOf(value) ?? -1) + 1);
    return {
      sku: `${template.code}-${positions.join("-")}`,
      values,
      nameAr: `${template.nameAr} — ${values.join(" / ")}`,
      salePrice: template.basePrice,
      itemId: null,
    };
  });
}

/**
 * توليد المتغيرات — materialises every combination as a real catalog item.
 * One-shot: a generated template is frozen, because each variant is now an
 * item other documents can reference.
 */
export async function generateProductTemplateVariants(
  id: string,
  deps: ProductTemplateDeps,
): Promise<ProductTemplate> {
  const template = await deps.templates.findById(id);
  if (!template) throw new ProductTemplateNotFoundError(id);
  if (template.variants.length > 0) {
    throw new ProductTemplateAlreadyGeneratedError(template.code, template.variants.length);
  }

  const projected = projectProductTemplateVariants(template);
  if (projected.length === 0) {
    throw new InvalidProductTemplateError(["the option matrix produces no combinations"]);
  }
  if (projected.length > MAX_PRODUCT_TEMPLATE_VARIANTS) {
    throw new InvalidProductTemplateError([
      `the option matrix produces ${projected.length} combinations, above the ${MAX_PRODUCT_TEMPLATE_VARIANTS} limit`,
    ]);
  }

  const variants: ProductTemplateVariant[] = [];
  for (const variant of projected) {
    const item: Item = await createItem(
      {
        id: deps.newItemId(),
        code: variant.sku,
        nameAr: variant.nameAr,
        nameEn: template.nameEn,
        type: "stock",
        baseUnitCode: template.baseUnitCode,
        categoryId: template.categoryId,
        costingMethod: template.costingMethod,
        salePrice: variant.salePrice,
        taxRatePercent: template.taxRatePercent,
      },
      deps.items,
    );
    variants.push({ ...variant, itemId: item.id });
  }

  const generated: ProductTemplate = { ...template, variants, status: "generated" };
  await deps.templates.save(generated);
  return generated;
}

/** Re-prices one generated variant — the template row and its catalog item together. */
export async function setProductTemplateVariantPrice(
  id: string,
  sku: string,
  salePrice: Money | null,
  deps: ProductTemplateDeps,
): Promise<ProductTemplate> {
  const template = await deps.templates.findById(id);
  if (!template) throw new ProductTemplateNotFoundError(id);
  const variant = template.variants.find((v) => v.sku === sku);
  if (!variant) throw new ProductTemplateVariantNotFoundError(id, sku);

  if (variant.itemId) await updateItem(variant.itemId, { salePrice }, deps.items);

  const next: ProductTemplate = {
    ...template,
    variants: template.variants.map((v) => (v.sku === sku ? { ...v, salePrice } : v)),
  };
  await deps.templates.save(next);
  return next;
}
