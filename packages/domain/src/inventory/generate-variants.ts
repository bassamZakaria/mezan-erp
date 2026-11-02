import type { ReasonInput } from "../bilingual-reasons.js";
import type { Account } from "../accounts/index.js";
import { createItem, type Item, type ItemRepository } from "../items/index.js";
import {
  EmptyVariantSelectionError,
  InvalidVariantSelectionError,
  NoAttributesDefinedError,
  ProductTemplateNotFoundError,
} from "./errors.js";
import {
  variantKey,
  type ProductTemplate,
  type ProductTemplateRepository,
  type ProductTemplateVariant,
  type ProductTemplateVariantRepository,
} from "./product-template.js";

/**
 * The variant/SKU generator (docs/archive/catalog/03-inventory.md §"توليد المتغيرات"):
 * turns a set of chosen attribute-value combinations into real, independent
 * stockable `Item`s. Already-generated combinations are silently skipped
 * (idempotent re-run of the same selection), mirroring the reference UI
 * locking "موجود" rows rather than erroring on them.
 */

export interface VariantSelection {
  /** attributeId -> chosen value. Must name exactly the template's attributes, each with one of its defined values. */
  readonly values: Readonly<Record<string, string>>;
}

export interface GenerateVariantsCommand {
  readonly templateId: string;
  readonly selections: readonly VariantSelection[];
  /** Generates a fresh id per call — used once per new variant for the Item id, once for the variant record id. */
  readonly idGen: () => string;
  readonly now?: () => string;
}

export interface GenerateVariantsDeps {
  readonly templates: ProductTemplateRepository;
  readonly variants: ProductTemplateVariantRepository;
  readonly items: ItemRepository;
  readonly accounts?: readonly Account[];
}

export interface GenerateVariantsResult {
  readonly created: readonly ProductTemplateVariant[];
  /** Selections that named an already-generated combination — skipped, not an error. */
  readonly skippedExisting: number;
}

function validateSelectionValues(template: ProductTemplate, values: Readonly<Record<string, string>>): void {
  const reasons: ReasonInput[] = [];
  const attributeIds = new Set(template.attributes.map((a) => a.id));
  const givenIds = Object.keys(values);

  for (const attr of template.attributes) {
    const chosen = values[attr.id];
    if (chosen === undefined) {
      reasons.push({ ar: `القيمة مفقودة للخاصية "${attr.nameAr}"`, en: `A value is missing for attribute "${attr.nameAr}"` });
    } else if (!attr.values.includes(chosen)) {
      reasons.push({ ar: `القيمة "${chosen}" غير معرّفة للخاصية "${attr.nameAr}"`, en: `Value "${chosen}" is not defined for attribute "${attr.nameAr}"` });
    }
  }
  for (const id of givenIds) {
    if (!attributeIds.has(id)) reasons.push({ ar: `خاصية غير معروفة: "${id}"`, en: `Unknown attribute: "${id}"` });
  }
  if (reasons.length > 0) throw new InvalidVariantSelectionError(reasons);
}

/** Deterministic, readable code suffix from a values map, in the template's own attribute order. */
function variantSuffix(template: ProductTemplate, values: Readonly<Record<string, string>>): string {
  return template.attributes
    .map((attr) => (values[attr.id] ?? "").toUpperCase().replace(/\s+/g, "-"))
    .join("-");
}

function variantLabel(template: ProductTemplate, values: Readonly<Record<string, string>>): string {
  return template.attributes.map((attr) => values[attr.id] ?? "").join(" / ");
}

export async function generateVariants(
  cmd: GenerateVariantsCommand,
  deps: GenerateVariantsDeps,
): Promise<GenerateVariantsResult> {
  const template = await deps.templates.findById(cmd.templateId);
  if (!template) throw new ProductTemplateNotFoundError(cmd.templateId);
  if (template.attributes.length === 0) throw new NoAttributesDefinedError(cmd.templateId);
  if (cmd.selections.length === 0) throw new EmptyVariantSelectionError(cmd.templateId);

  for (const selection of cmd.selections) {
    validateSelectionValues(template, selection.values);
  }

  const existing = await deps.variants.listByTemplate(cmd.templateId);
  const existingKeys = new Set(existing.map((v) => variantKey(v.values)));

  const created: ProductTemplateVariant[] = [];
  let skippedExisting = 0;

  for (const selection of cmd.selections) {
    const key = variantKey(selection.values);
    if (existingKeys.has(key)) {
      skippedExisting++;
      continue;
    }

    const itemId = cmd.idGen();
    const code = `${template.code}-${variantSuffix(template, selection.values)}`;
    const nameAr = `${template.nameAr} - ${variantLabel(template, selection.values)}`;

    const item: Item = await createItem(
      {
        id: itemId,
        code,
        nameAr,
        type: "stock",
        baseUnitCode: template.baseUnitCode,
        categoryId: template.categoryId,
        brandId: template.brandId,
        costingMethod: template.costingMethod,
        salePrice: template.defaultSalePrice,
        costPrice: template.defaultCost,
        taxRatePercent: template.taxRatePercent,
      },
      deps.items,
      deps.accounts,
    );

    const variant: ProductTemplateVariant = {
      id: cmd.idGen(),
      templateId: template.id,
      itemId: item.id,
      itemCode: item.code,
      values: selection.values,
      createdAt: cmd.now?.() ?? new Date().toISOString(),
    };
    await deps.variants.create(variant);
    existingKeys.add(key);
    created.push(variant);
  }

  return { created, skippedExisting };
}
