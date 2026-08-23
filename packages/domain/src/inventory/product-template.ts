import type { CostingMethod } from "../items/item.js";
import type { Money } from "../money/index.js";

/**
 * Product Templates (docs/catalog/03-inventory.md §"قوالب المنتجات") —
 * attribute-driven variant/SKU generation: define a product once with named
 * characteristics (e.g. color, size), enumerate each attribute's values, and
 * mass-generate the resulting SKU combinations as independent, stockable
 * `Item`s ("variants") via `generateVariants` (generate-variants.ts).
 *
 * Distinct from `manufacturing/configurable-product.ts`'s formula-driven
 * made-to-order model — a template pre-generates fixed SKUs from a discrete
 * Cartesian product of attribute values, it never evaluates a formula.
 */

export interface ProductTemplateAttribute {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** Ordered, unique (case-sensitive) value labels, e.g. ["أحمر", "أزرق"]. */
  readonly values: readonly string[];
}

export type ProductTemplateStatus = "active" | "inactive";

export interface ProductTemplate {
  readonly id: string;
  /** Unique, immutable after creation (mirrors Item.code). */
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly baseUnitCode: string;
  readonly categoryId: string | null;
  readonly brand: string | null;
  readonly costingMethod: CostingMethod;
  /** Seeded onto every generated variant's Item.salePrice. */
  readonly defaultSalePrice: Money | null;
  /** Seeded onto every generated variant's Item.costPrice. */
  readonly defaultCost: Money | null;
  readonly taxRatePercent: number;
  readonly attributes: readonly ProductTemplateAttribute[];
  readonly status: ProductTemplateStatus;
}

/** Persistence port for Product Templates. The domain depends on this interface only — no SQL, no driver. */
export interface ProductTemplateRepository {
  findById(id: string): Promise<ProductTemplate | null>;
  findByCode(code: string): Promise<ProductTemplate | null>;
  list(): Promise<ProductTemplate[]>;
  create(template: ProductTemplate): Promise<void>;
  update(template: ProductTemplate): Promise<void>;
}

/** One generated SKU: the exact attribute-value combination that produced it, and the resulting real Item. */
export interface ProductTemplateVariant {
  readonly id: string;
  readonly templateId: string;
  readonly itemId: string;
  readonly itemCode: string;
  /** attributeId -> the chosen value for that attribute, covering every attribute on the template. */
  readonly values: Readonly<Record<string, string>>;
  readonly createdAt: string;
}

/** Persistence port for generated variants. The domain depends on this interface only — no SQL, no driver. */
export interface ProductTemplateVariantRepository {
  listByTemplate(templateId: string): Promise<readonly ProductTemplateVariant[]>;
  create(variant: ProductTemplateVariant): Promise<void>;
}

/** A stable, order-independent key for a values map — used to detect "already generated" combinations. */
export function variantKey(values: Readonly<Record<string, string>>): string {
  return Object.keys(values)
    .sort()
    .map((k) => `${k}=${values[k]}`)
    .join("|");
}
