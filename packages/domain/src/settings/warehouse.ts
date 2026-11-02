import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import type { BilingualReason } from "../collections/errors.js";
/**
 * Warehouse — docs/archive/catalog/09 §"إدارة المستودعات (Warehouses)". Warehouses
 * model *purpose*, not just a name: the catalog's "Full warehouse-type
 * catalog (5 types)" (line ~527) is transcribed verbatim below, in the order
 * documented, including the van/distribution-vehicle type used for field
 * sales (docs/archive/catalog/09 §"المبيعات الميدانية"). SITE (مستودع الموقع)
 * is the contracting module's sixth — a real store on a project site, carrying
 * the project and the custodian the stock sits with (D-11).
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
  { code: "SITE", labelAr: "مستودع موقع" },
] as const;

export const WAREHOUSE_TYPES = ["MAIN", "TRANSIT", "RETURNS", "PRODUCTION", "VAN", "SITE"] as const;
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
  /**
   * مستودع الموقع — the contracting project this store belongs to. Required on
   * type SITE and null on every other type: material consumption reads the
   * project OFF the store rather than off the document, so a site store with no
   * project would post cost to no project at all (D-11).
   */
  readonly projectId: string | null;
  /** أمين عهدة الموقع — required on type SITE. Stock on site sits with a named person, not in an abstraction. */
  readonly custodianUserId: string | null;
}

export class InvalidWarehouseError extends Error {
  readonly code = "INVALID_WAREHOUSE";
  readonly reasons: string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the details are not valid");
    super(`بيانات المستودع غير صالحة: ${split.ar.join("؛ ")}`);
    this.reasons = [...split.ar];
    this.messageEn = `Invalid warehouse: ${split.en}`;
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
  readonly projectId?: string | null;
  readonly custodianUserId?: string | null;
}

function validate(warehouse: Warehouse): BilingualReason[] {
  const reasons: BilingualReason[] = [];
  if (warehouse.id.trim() === "") reasons.push({ ar: "معرّف المستودع مطلوب", en: "The warehouse ID is required" });
  if (!/^[A-Z0-9_-]{1,20}$/.test(warehouse.code)) {
    reasons.push({ ar: "كود المستودع يجب أن يتكوّن من 1 إلى 20 حرفاً لاتينياً كبيراً أو رقماً أو الرمزين - و _", en: "The warehouse code must be 1 to 20 characters: capital Latin letters, digits, hyphens or underscores" });
  }
  if (warehouse.name.trim() === "") reasons.push({ ar: "اسم المستودع مطلوب", en: "The warehouse name is required" });
  if (warehouse.branchId.trim() === "") reasons.push({ ar: "الفرع مطلوب", en: "The branch is required" });
  if (!WAREHOUSE_TYPES.includes(warehouse.type)) {
    reasons.push({ ar: `نوع المستودع يجب أن يكون أحد الأنواع: ${WAREHOUSE_TYPE_DEFINITIONS.map((d) => d.labelAr).join("، ")}.`, en: "The warehouse type must be main, transit, returns, production, van or site." });
  }
  if (warehouse.type === "SITE") {
    if (!warehouse.projectId) reasons.push({ ar: "مستودع الموقع يتطلب تحديد المشروع", en: "A site warehouse requires a project" });
    if (!warehouse.custodianUserId) reasons.push({ ar: "مستودع الموقع يتطلب تحديد أمين العهدة", en: "A site warehouse requires a custodian" });
  } else {
    if (warehouse.projectId) reasons.push({ ar: "المشروع لا يُسجَّل إلا على مستودع موقع", en: "A project can only be set on a site warehouse" });
    if (warehouse.custodianUserId) reasons.push({ ar: "أمين العهدة لا يُسجَّل إلا على مستودع موقع", en: "A custodian can only be set on a site warehouse" });
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
    projectId: input.projectId ?? null,
    custodianUserId: input.custodianUserId ?? null,
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
