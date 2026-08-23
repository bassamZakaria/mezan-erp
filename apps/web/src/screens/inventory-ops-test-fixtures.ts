import type { ItemDTO, WarehouseDTO } from "@mezan/contracts";

/** Shared stubs for the four inventory-ops screen tests (items/warehouses pickers). */

export const TEST_WAREHOUSES: WarehouseDTO[] = [
  { id: "wh-main", code: "WH-MAIN", name: "المستودع الرئيسي", branchId: "b1", type: "MAIN", isDefault: true, active: true },
  { id: "wh-alex", code: "WH-ALEX", name: "مستودع الإسكندرية", branchId: "b2", type: "MAIN", isDefault: false, active: true },
];

function item(id: string, code: string, nameAr: string): ItemDTO {
  return {
    id,
    code,
    nameAr,
    nameEn: nameAr,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brand: null,
    costingMethod: "WAC",
    salePrice: "0.000000",
    costPrice: "0.000000",
    taxRatePercent: 14,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
  };
}

export const TEST_ITEMS: ItemDTO[] = [
  item("itm-1", "ITM-000001", "أرز أبيض مصري 5 كجم"),
  item("itm-2", "ITM-000002", "زيت عباد الشمس 1 لتر"),
  item("itm-8", "ITM-000008", "سكر أبيض 1 كجم"),
];
