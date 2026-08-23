import type { CostingMethod } from "../items/item.js";
import type { Money } from "../money/index.js";
import { DuplicateProductTemplateCodeError, InvalidProductTemplateError } from "./errors.js";
import type { ProductTemplate, ProductTemplateRepository } from "./product-template.js";

export interface CreateProductTemplateCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly baseUnitCode: string;
  readonly categoryId?: string | null;
  readonly brand?: string | null;
  readonly costingMethod?: CostingMethod;
  readonly defaultSalePrice?: Money | null;
  readonly defaultCost?: Money | null;
  readonly taxRatePercent?: number;
}

function buildCandidate(command: CreateProductTemplateCommand): ProductTemplate {
  return {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    baseUnitCode: command.baseUnitCode,
    categoryId: command.categoryId ?? null,
    brand: command.brand ?? null,
    costingMethod: command.costingMethod ?? "WAC",
    defaultSalePrice: command.defaultSalePrice ?? null,
    defaultCost: command.defaultCost ?? null,
    taxRatePercent: command.taxRatePercent ?? 14,
    attributes: [],
    status: "active",
  };
}

function collectFieldErrors(candidate: ProductTemplate): string[] {
  const reasons: string[] = [];
  if (candidate.code.trim() === "") reasons.push("كود القالب مطلوب");
  if (candidate.nameAr.trim() === "") reasons.push("اسم المنتج مطلوب");
  if (candidate.baseUnitCode.trim() === "") reasons.push("وحدة القياس الأساسية مطلوبة");
  if (candidate.taxRatePercent < 0 || candidate.taxRatePercent > 100) reasons.push("نسبة الضريبة يجب أن تكون بين 0 و100");
  return reasons;
}

/**
 * Creates and persists a new مسودة product template (no attributes/variants
 * yet — those are added via `template-attributes.ts` and
 * `generate-variants.ts`). Codes are unique, mirroring `createItem`.
 */
export async function createProductTemplate(
  command: CreateProductTemplateCommand,
  repo: ProductTemplateRepository,
): Promise<ProductTemplate> {
  const existing = await repo.findByCode(command.code);
  if (existing) throw new DuplicateProductTemplateCodeError(command.code);

  const candidate = buildCandidate(command);
  const reasons = collectFieldErrors(candidate);
  if (reasons.length > 0) throw new InvalidProductTemplateError(reasons);

  await repo.create(candidate);
  return candidate;
}
