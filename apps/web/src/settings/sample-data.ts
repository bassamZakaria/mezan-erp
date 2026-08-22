import { createDefaultSettings, createBranch, createWarehouse, type TenantSettings, type Branch, type Warehouse } from "@mezan/domain";

/**
 * Settings/branches/warehouses demo data for the Cyag tenant (شركة سياج),
 * matching apps/web/src/sample-data.ts's demoUser (محمد الشهابي) and the
 * shapes documented in docs/catalog/09-settings-dashboard-ux.md.
 */

export const sampleSettings: TenantSettings = createDefaultSettings({
  currency: "EGP",
  secondaryCurrencies: ["SAR", "USD", "AED", "EUR", "KWD", "QAR", "JOD"],
  language: "ar",
  timezone: "Africa/Cairo",
  direction: "RTL",
  dateFormat: "DD/MM/YYYY",
  fiscalYearStartMonth: 1,
  fxRateMissingPolicy: "STRICT",

  companyName: "Cyag — شركة سياج للصناعات",
  taxRegistrationNumber: "300123456700003",
  commercialRegistrationNumber: "",
  phone: "0223456789",
  email: "info@cyag.example",
  address: "القاهرة الجديدة، القاهرة",
  hrContractExpiryWarningDays: 30,
  overtimeMultiplier: 1.5,
  standardDailyWorkHours: 8,

  taxEnabled: true,
  defaultTaxRate: 14,
  taxCalculation: "EXCLUSIVE",
  depreciationProrate: "DAILY",

  priceListsEnabled: true,
  creditControlEnabled: false,
  creditControlMode: "WARNING",

  allowCrossWarehouseSales: true,
  showOtherWarehouseStock: true,
  allowBackorder: false,
  allowNegativeStock: false,

  requirePoForGrn: false,
  requireGrnForInvoice: false,
  trackSoldPurchaseItems: true,

  preventNegativeCashBalance: true,
  allowNegativeTreasury: true,
});

export const sampleBranches: Branch[] = [
  createBranch({
    id: "b1",
    code: "MAIN",
    name: "الفرع الرئيسي",
    isMain: true,
    phone: "0223456789",
    email: "main@cyag.example",
    address: "القاهرة الجديدة، القاهرة",
  }),
  createBranch({
    id: "b2",
    code: "ALEX",
    name: "فرع الإسكندرية",
    parentBranchId: "b1",
    phone: "0334567890",
    address: "سموحة، الإسكندرية",
  }),
];

export const sampleWarehouses: Warehouse[] = [
  createWarehouse({ id: "w1", code: "WH-MAIN", name: "مستودع الفرع الرئيسي", branchId: "b1", type: "MAIN", isDefault: true }),
  createWarehouse({ id: "w2", code: "VAN-01", name: "سياره نقل ١", branchId: "b1", type: "VAN" }),
  createWarehouse({ id: "w3", code: "WH-RET", name: "مستودع المرتجعات", branchId: "b1", type: "RETURNS" }),
  createWarehouse({ id: "w4", code: "WH-ALEX", name: "مستودع فرع الإسكندرية", branchId: "b2", type: "MAIN", isDefault: true }),
  createWarehouse({ id: "w5", code: "WH-PROD", name: "مستودع الإنتاج", branchId: "b2", type: "PRODUCTION" }),
  createWarehouse({ id: "w6", code: "WH-TRANS", name: "مستودع وسيط", branchId: "b2", type: "TRANSIT" }),
];

export function branchName(branchId: string, branches: Branch[] = sampleBranches): string {
  return branches.find((b) => b.id === branchId)?.name ?? branchId;
}
