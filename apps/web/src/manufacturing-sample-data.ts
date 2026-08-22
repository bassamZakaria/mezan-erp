/**
 * Demo data for the manufacturing screens (docs/catalog/07). Typed with the
 * REAL domain entities (@mezan/domain) so the screens render through the same
 * models and compute helpers the API serves — the same convention every other
 * Phase-1/3 web screen follows (no `/api` wiring yet).
 */

import {
  Money,
  Qty,
  type Bom,
  type WorkOrder,
  type WorkOrderStage,
  type WorkOrderStatus,
  type WorkOrderPriority,
  type WorkOrderMaterial,
  type ConfigurableProduct,
  type ConfigInstance,
} from "@mezan/domain";

export interface DemoMfgItem {
  id: string;
  nameAr: string;
  unit: string;
  cost: Money;
}

export const demoMfgItems: DemoMfgItem[] = [
  { id: "m-wood", nameAr: "لوح خشب", unit: "PCS", cost: Money.fromMajor("120") },
  { id: "m-screw", nameAr: "مسامير", unit: "PCS", cost: Money.fromMajor("0.5") },
  { id: "m-paint", nameAr: "دهان (لتر)", unit: "L", cost: Money.fromMajor("35") },
  { id: "m-glass", nameAr: "زجاج (م²)", unit: "M2", cost: Money.fromMajor("85") },
  { id: "m-alum", nameAr: "ألمنيوم (متر)", unit: "M", cost: Money.fromMajor("22") },
  { id: "FG-TABLE", nameAr: "طاولة خشبية", unit: "PCS", cost: Money.zero() },
  { id: "FG-WINDOW", nameAr: "نافذة مخصصة", unit: "PCS", cost: Money.zero() },
];

const ITEM_BY_ID = new Map(demoMfgItems.map((i) => [i.id, i]));
export function mfgItemName(id: string): string {
  return ITEM_BY_ID.get(id)?.nameAr ?? id;
}
export function mfgItemUnit(id: string): string {
  return ITEM_BY_ID.get(id)?.unit ?? "";
}
export function mfgItemCost(id: string): Money {
  return ITEM_BY_ID.get(id)?.cost ?? Money.zero();
}
export const resolveDemoUnitCost = (id: string): Money => mfgItemCost(id);

export const demoWarehouses = [
  { id: "RAW-WH", nameAr: "مستودع الخامات" },
  { id: "FG-WH", nameAr: "مستودع المنتجات التامة" },
];

// --- BOMs ------------------------------------------------------------------

export const demoBoms: Bom[] = [
  {
    id: "bom-t1",
    number: "BOM-0001",
    productItemId: "FG-TABLE",
    version: 1,
    standardQty: Qty.fromMajor("1"),
    unit: "PCS",
    laborCost: Money.fromMajor("50"),
    overheadCost: Money.fromMajor("30"),
    versionNotes: "الإصدار الأول",
    lines: [
      { itemId: "m-wood", qty: Qty.fromMajor("4"), wastePercent: 5, optional: false, notes: null },
      { itemId: "m-screw", qty: Qty.fromMajor("24"), wastePercent: 0, optional: false, notes: null },
    ],
    status: "inactive",
    custom: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-06-01T08:00:00.000Z",
  },
  {
    id: "bom-t2",
    number: "BOM-0002",
    productItemId: "FG-TABLE",
    version: 2,
    standardQty: Qty.fromMajor("1"),
    unit: "PCS",
    laborCost: Money.fromMajor("55"),
    overheadCost: Money.fromMajor("30"),
    versionNotes: "أضفنا الدهان",
    lines: [
      { itemId: "m-wood", qty: Qty.fromMajor("4"), wastePercent: 5, optional: false, notes: null },
      { itemId: "m-screw", qty: Qty.fromMajor("24"), wastePercent: 0, optional: false, notes: null },
      { itemId: "m-paint", qty: Qty.fromMajor("0.5"), wastePercent: 10, optional: false, notes: "طبقتان" },
    ],
    status: "active",
    custom: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-07-15T08:00:00.000Z",
  },
];

// --- Work Orders -----------------------------------------------------------

interface WoOverrides {
  id: string;
  number: string;
  plannedQty: string;
  producedQty?: string;
  status: WorkOrderStatus;
  stage: WorkOrderStage;
  priority?: WorkOrderPriority;
  scheduledEndDate?: string | null;
  materialCost?: string;
  materials: { itemId: string; requiredQty: string; issuedQty?: string; issuedUnitCost?: string; wastePercent?: number }[];
}

function makeWorkOrder(o: WoOverrides): WorkOrder {
  const materials: WorkOrderMaterial[] = o.materials.map((m) => ({
    itemId: m.itemId,
    requiredQty: Qty.fromMajor(m.requiredQty),
    wastePercent: m.wastePercent ?? 0,
    optional: false,
    issuedQty: Qty.fromMajor(m.issuedQty ?? "0"),
    returnedQty: Qty.zero(),
    issuedUnitCost: Money.fromMajor(m.issuedUnitCost ?? "0"),
  }));
  return {
    id: o.id,
    number: o.number,
    bomId: "bom-t2",
    bomVersion: 2,
    productItemId: "FG-TABLE",
    plannedQty: Qty.fromMajor(o.plannedQty),
    producedQty: Qty.fromMajor(o.producedQty ?? "0"),
    sourceWarehouseId: "RAW-WH",
    destinationWarehouseId: "FG-WH",
    priority: o.priority ?? "normal",
    scheduledStartDate: "2026-08-10",
    scheduledEndDate: o.scheduledEndDate === undefined ? "2026-08-28" : o.scheduledEndDate,
    notes: null,
    status: o.status,
    stage: o.stage,
    materials,
    materialCost: Money.fromMajor(o.materialCost ?? "0"),
    laborCost: Money.fromMajor("55"),
    overheadCost: Money.fromMajor("30"),
    extraCost: Money.zero(),
    costLog: [],
    wasteLog: [],
    configInstanceId: null,
    glPosted: o.status === "completed",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-10T08:00:00.000Z",
    startedAt: o.stage === "not_started" ? null : "2026-08-11T08:00:00.000Z",
    issuedAt: ["materials_issued", "product_received", "completed"].includes(o.stage) ? "2026-08-12T08:00:00.000Z" : null,
    receivedAt: ["product_received", "completed"].includes(o.stage) ? "2026-08-14T08:00:00.000Z" : null,
    completedAt: o.stage === "completed" ? "2026-08-15T08:00:00.000Z" : null,
  };
}

export const demoWorkOrders: WorkOrder[] = [
  makeWorkOrder({
    id: "wo-1",
    number: "WO-0001",
    plannedQty: "10",
    status: "in_progress",
    stage: "started",
    priority: "high",
    scheduledEndDate: "2026-08-16",
    materials: [
      { itemId: "m-wood", requiredQty: "42" },
      { itemId: "m-screw", requiredQty: "240" },
      { itemId: "m-paint", requiredQty: "5.5" },
    ],
  }),
  makeWorkOrder({
    id: "wo-2",
    number: "WO-0002",
    plannedQty: "5",
    status: "in_progress",
    stage: "materials_issued",
    materialCost: "635",
    materials: [
      { itemId: "m-wood", requiredQty: "21", issuedQty: "21", issuedUnitCost: "120" },
      { itemId: "m-screw", requiredQty: "120", issuedQty: "120", issuedUnitCost: "0.5" },
      { itemId: "m-paint", requiredQty: "2.75", issuedQty: "2.75", issuedUnitCost: "35" },
    ],
  }),
  makeWorkOrder({
    id: "wo-3",
    number: "WO-0003",
    plannedQty: "8",
    producedQty: "8",
    status: "completed",
    stage: "completed",
    materialCost: "1016",
    materials: [
      { itemId: "m-wood", requiredQty: "33.6", issuedQty: "33.6", issuedUnitCost: "120" },
      { itemId: "m-screw", requiredQty: "192", issuedQty: "192", issuedUnitCost: "0.5" },
      { itemId: "m-paint", requiredQty: "4.4", issuedQty: "4.4", issuedUnitCost: "35" },
    ],
  }),
  makeWorkOrder({
    id: "wo-4",
    number: "WO-0004",
    plannedQty: "12",
    status: "planned",
    stage: "not_started",
    materials: [
      { itemId: "m-wood", requiredQty: "50.4" },
      { itemId: "m-screw", requiredQty: "288" },
      { itemId: "m-paint", requiredQty: "6.6" },
    ],
  }),
];

// --- Configurable Products -------------------------------------------------

export const demoConfigurableProducts: ConfigurableProduct[] = [
  {
    id: "cp-1",
    code: "WINDOW",
    nameAr: "نافذة قابلة للتهيئة",
    nameEn: "Configurable window",
    outputItemId: "FG-WINDOW",
    unit: "PCS",
    description: "نافذة ألمنيوم بأبعاد حسب الطلب",
    inputs: [
      { id: "width", labelAr: "العرض", labelEn: "Width", type: "number", min: 30, max: 300 },
      { id: "height", labelAr: "الارتفاع", labelEn: "Height", type: "number", min: 30, max: 300 },
    ],
    materials: [
      { itemId: "m-glass", qtyFormula: "width*height/10000", wastePercent: 5 },
      { itemId: "m-alum", qtyFormula: "2*(width+height)/100", wastePercent: 5 },
    ],
    pricingMethod: "formula",
    priceFormula: "width*height*3.5/100",
    laborFormula: "width/10",
    overheadFormula: "5",
    itemPolicy: "per_spec",
    status: "active",
    createdBy: "محمد الشهابي",
    createdAt: "2026-07-01T08:00:00.000Z",
  },
  {
    id: "cp-2",
    code: "DOOR",
    nameAr: "باب قابل للتهيئة",
    nameEn: null,
    outputItemId: "FG-WINDOW",
    unit: "PCS",
    description: null,
    inputs: [{ id: "width", labelAr: "العرض", labelEn: null, type: "number", min: 60, max: 200 }],
    materials: [{ itemId: "m-wood", qtyFormula: "width/25", wastePercent: 10 }],
    pricingMethod: "manual",
    priceFormula: null,
    laborFormula: "width/8",
    overheadFormula: null,
    itemPolicy: "per_order",
    status: "active",
    createdBy: "محمد الشهابي",
    createdAt: "2026-07-05T08:00:00.000Z",
  },
];

// --- Config Instances (Custom Manufacturing) -------------------------------

export const demoConfigInstances: ConfigInstance[] = [
  {
    id: "ci-1",
    number: "CM-000001",
    configurableProductId: "cp-1",
    productNameAr: "نافذة قابلة للتهيئة",
    outputItemId: "FG-WINDOW",
    spec: { width: "120", height: "150" },
    qty: Qty.fromMajor("2"),
    customerId: "cust-1",
    sellUnitPrice: Money.fromMajor("630"),
    notes: null,
    status: "in_progress",
    bomId: "ci-1:bom",
    workOrderId: "wo-2",
    materials: [
      { itemId: "m-glass", qtyPerUnit: Qty.fromMajor("1.8"), wastePercent: 5, lineCost: Money.fromMajor("160.65") },
      { itemId: "m-alum", qtyPerUnit: Qty.fromMajor("5.4"), wastePercent: 5, lineCost: Money.fromMajor("124.74") },
    ],
    materialCostPerUnit: Money.fromMajor("285.39"),
    laborCostPerUnit: Money.fromMajor("12"),
    overheadCostPerUnit: Money.fromMajor("5"),
    estimatedUnitCost: Money.fromMajor("302.39"),
    actualCost: null,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-12T08:00:00.000Z",
  },
  {
    id: "ci-2",
    number: "CM-000002",
    configurableProductId: "cp-2",
    productNameAr: "باب قابل للتهيئة",
    outputItemId: "FG-WINDOW",
    spec: { width: "100" },
    qty: Qty.fromMajor("1"),
    customerId: null,
    sellUnitPrice: Money.fromMajor("800"),
    notes: "تسليم عاجل",
    status: "produced",
    bomId: "ci-2:bom",
    workOrderId: "wo-3",
    materials: [
      { itemId: "m-wood", qtyPerUnit: Qty.fromMajor("4"), wastePercent: 10, lineCost: Money.fromMajor("528") },
    ],
    materialCostPerUnit: Money.fromMajor("528"),
    laborCostPerUnit: Money.fromMajor("12.5"),
    overheadCostPerUnit: Money.zero(),
    estimatedUnitCost: Money.fromMajor("540.5"),
    actualCost: Money.fromMajor("540.5"),
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-13T08:00:00.000Z",
  },
];

export const CONFIG_INSTANCE_STATUS_LABEL: Record<string, string> = {
  configured: "مهيأة",
  in_progress: "في التنفيذ",
  produced: "تم الإنتاج",
  closed: "مغلقة",
  cancelled: "ملغاة",
};
