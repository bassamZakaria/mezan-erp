/**
 * فئة التكلفة — the second contracting dimension on a journal line, beside
 * `projectId` (docs/artifacts/mezan-contracting-designs.html D-01). A cost
 * centre cannot express "materials on project 7", and a project alone cannot
 * split its cost the way a certificate, an internal certificate or a
 * cost-to-complete forecast needs it split. Both dimensions are written into the
 * posted line and are immutable with it.
 */
export type CostCategory = "materials" | "labour" | "equipment" | "subcontract" | "indirect";

export interface CostCategoryDefinition {
  readonly code: CostCategory;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const COST_CATEGORY_DEFINITIONS: readonly CostCategoryDefinition[] = [
  { code: "materials", labelAr: "مواد", labelEn: "Materials" },
  { code: "labour", labelAr: "عمالة", labelEn: "Labour" },
  { code: "equipment", labelAr: "معدات", labelEn: "Equipment" },
  { code: "subcontract", labelAr: "مقاول باطن", labelEn: "Subcontract" },
  { code: "indirect", labelAr: "غير مباشرة", labelEn: "Indirect" },
] as const;

export const COST_CATEGORIES: readonly CostCategory[] = COST_CATEGORY_DEFINITIONS.map((d) => d.code);

export function isCostCategory(value: unknown): value is CostCategory {
  return typeof value === "string" && (COST_CATEGORIES as readonly string[]).includes(value);
}

export function getCostCategoryLabel(code: CostCategory): string {
  return COST_CATEGORY_DEFINITIONS.find((d) => d.code === code)?.labelAr ?? code;
}
