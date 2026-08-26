/**
 * Warehouse — docs/catalog/09 §"إدارة المستودعات (Warehouses)". Warehouses
 * model *purpose*, not just a name: the catalog's "Full warehouse-type
 * catalog (5 types)" (line ~527) is transcribed verbatim below, in the order
 * documented, including the van/distribution-vehicle type used for field
 * sales (docs/catalog/09 §"المبيعات الميدانية").
 */

export interface WarehouseTypeDefinition {
  readonly code: WarehouseType;
  readonly labelAr: string;
}

export const WAREHOUSE_TYPE_DEFINITIONS: readonly WarehouseTypeDefinition[] = [
  { code: "MAIN", labelAr: "رئيسي" },
  { code: "TRANSIT", labelAr: "مستودع وسيط" },
  { code: "RETURNS", labelAr: "مرتجعات" },
  { code: "PRODUCTION", labelAr: "إنتاج" },
  { code: "VAN", labelAr: "ڤان (سيارة توزيع)" },
] as const;

export const WAREHOUSE_TYPES = ["MAIN", "TRANSIT", "RETURNS", "PRODUCTION", "VAN"] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

export function getWarehouseTypeLabel(type: WarehouseType): string {
  return WAREHOUSE_TYPE_DEFINITIONS.find((d) => d.code === type)?.labelAr ?? type;
}

export interface Warehouse {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /**
   * The English name. Null on warehouses created before the field existed and
   * on tenants that never fill it in — every reader falls back to `name`,
   * because a blank warehouse picker is worse than an Arabic one (D58).
   */
  readonly nameEn: string | null;
  readonly branchId: string;
  readonly type: WarehouseType;
  readonly isDefault: boolean;
  readonly active: boolean;
}

export class InvalidWarehouseError extends Error {
  readonly code = "INVALID_WAREHOUSE";
  constructor(reasons: readonly string[]) {
    super(`Invalid warehouse: ${reasons.join("; ")}`);
    this.name = "InvalidWarehouseError";
  }
}

export interface CreateWarehouseInput {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameEn?: string | null;
  readonly branchId: string;
  readonly type?: WarehouseType;
  readonly isDefault?: boolean;
  readonly active?: boolean;
}

function validate(warehouse: Warehouse): string[] {
  const reasons: string[] = [];
  if (warehouse.id.trim() === "") reasons.push("id is required");
  if (!/^[A-Z0-9_-]{1,20}$/.test(warehouse.code)) {
    reasons.push("code must be 1-20 uppercase alphanumeric/-/_ characters");
  }
  if (warehouse.name.trim() === "") reasons.push("name is required");
  if (warehouse.branchId.trim() === "") reasons.push("branchId is required");
  if (!WAREHOUSE_TYPES.includes(warehouse.type)) {
    reasons.push(`type must be one of ${WAREHOUSE_TYPES.join(", ")}`);
  }
  return reasons;
}

/** Constructs a `Warehouse` (default type "رئيسي"/MAIN, matching the catalog's add-dialog default). */
export function createWarehouse(input: CreateWarehouseInput): Warehouse {
  const warehouse: Warehouse = {
    id: input.id,
    code: input.code,
    name: input.name,
    nameEn: input.nameEn ?? null,
    branchId: input.branchId,
    type: input.type ?? "MAIN",
    isDefault: input.isDefault ?? false,
    active: input.active ?? true,
  };
  const reasons = validate(warehouse);
  if (reasons.length > 0) throw new InvalidWarehouseError(reasons);
  return warehouse;
}

/** Applies a patch to an existing warehouse, re-validating the result. */
export function updateWarehouse(current: Warehouse, patch: Partial<Omit<Warehouse, "id">>): Warehouse {
  const next: Warehouse = { ...current, ...patch };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidWarehouseError(reasons);
  return next;
}
