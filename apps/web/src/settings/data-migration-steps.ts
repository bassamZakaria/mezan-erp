import type { DataMigrationStepSpec } from "@mezan/ui";
import type { AppTranslationKey } from "../i18n";
import type {
  DataMigrationMasterStep,
  DataMigrationStatusDTO,
  HistoricalImportDocType,
  HistoricalImportKind,
} from "../data/hooks";

/**
 * The go-live wizard's per-step column contract (docs/archive/catalog/09 «نقل البيانات»).
 *
 * Lifted out of the page so the test-fixture generator builds its workbooks
 * from the SAME spec the app parses. A hand-copied fixture would drift the
 * first time a column changed, and the import would fail for a reason that
 * looked like a product bug.
 */

export interface MasterStepDef {
  kind: "master";
  id: DataMigrationMasterStep;
  statusKey: keyof DataMigrationStatusDTO;
  title: AppTranslationKey;
  help: AppTranslationKey;
  /** Catalogue KEYS, not copy — resolve with `resolveStepSpec` before use. */
  spec: DataMigrationStepSpec;
}

export interface HistoricalStepDef {
  kind: "historical";
  importKind: HistoricalImportKind;
  docType: HistoricalImportDocType;
  statusKey: keyof DataMigrationStatusDTO;
  title: AppTranslationKey;
  help: AppTranslationKey;
  /** Catalogue KEYS, not copy — resolve with `resolveStepSpec` before use. */
  spec: DataMigrationStepSpec;
}

export type StepDef = MasterStepDef | HistoricalStepDef;

export const HISTORICAL_COLUMNS: DataMigrationStepSpec["columns"] = [
  { key: "documentNumber", header: "dm.col.documentNumber", example: "INV-1001" },
  { key: "partyId", header: "dm.col.partyId", example: "cus-1" },
  { key: "date", header: "dm.col.date", example: "2026-01-15" },
  { key: "dueDate", header: "dm.col.dueDate" },
  { key: "itemId", header: "dm.col.itemId" },
  { key: "description", header: "dm.col.description" },
  { key: "qty", header: "dm.col.qty", example: "10" },
  { key: "unitCost", header: "dm.col.unitCost", example: "85.00" },
  { key: "amountPaid", header: "dm.col.amountPaid", example: "500.00" },
];

export const STEPS: StepDef[] = [
  {
    kind: "master",
    id: "departments",
    statusKey: "departments",
    title: "dm.step.departments.title",
    help: "dm.step.departments.help",
    spec: {
      id: "departments",
      sheetName: "dm.sheet.departments",
      columns: [
        { key: "code", header: "dm.col.code", example: "SALES" },
        { key: "nameAr", header: "dm.col.name", example: "dm.eg.sales" },
        { key: "nameEn", header: "dm.col.nameEn" },
      ],
    },
  },
  {
    kind: "master",
    id: "employees",
    statusKey: "employees",
    title: "dm.step.employees.title",
    help: "dm.step.employees.help",
    spec: {
      id: "employees",
      sheetName: "dm.sheet.employees",
      columns: [
        { key: "code", header: "dm.col.code", example: "EMP-0001" },
        { key: "nameAr", header: "dm.col.name" , example: "dm.eg.personName" },
        { key: "departmentCode", header: "dm.col.departmentCode", example: "SALES" },
        { key: "hireDate", header: "dm.col.hireDate", example: "2026-01-01" },
        { key: "branchCode", header: "dm.col.branchCode" },
        { key: "phone", header: "dm.col.phone" },
        { key: "email", header: "dm.col.email" },
      ],
    },
  },
  {
    kind: "master",
    id: "treasury-accounts",
    statusKey: "treasuryAccounts",
    title: "dm.step.treasury-accounts.title",
    help: "dm.step.treasury-accounts.help",
    spec: {
      id: "treasury-accounts",
      sheetName: "dm.sheet.treasury-accounts",
      columns: [
        { key: "code", header: "dm.col.code", example: "CASH-001" },
        { key: "name", header: "dm.col.name", example: "dm.eg.cashBox" },
        { key: "type", header: "dm.col.typeCashBank", example: "cash" },
        { key: "branchCode", header: "dm.col.branchCode" },
        { key: "openingBalance", header: "dm.col.openingBalance", example: "0.00" },
        { key: "glAccountId", header: "dm.col.glAccountId" },
      ],
    },
  },
  {
    kind: "master",
    id: "suppliers",
    statusKey: "suppliers",
    title: "dm.step.suppliers.title",
    help: "dm.step.suppliers.help",
    spec: {
      id: "suppliers",
      sheetName: "dm.sheet.suppliers",
      columns: [
        { key: "code", header: "dm.col.code", example: "SUP-1" },
        { key: "nameAr", header: "dm.col.name", example: "dm.eg.supplierCo" },
        { key: "phone", header: "dm.col.phone" },
        { key: "email", header: "dm.col.email" },
        { key: "taxNumber", header: "dm.col.taxNumber" },
        { key: "paymentTermsDays", header: "dm.col.paymentTermsDays", example: "30" },
      ],
    },
  },
  {
    kind: "master",
    id: "customers",
    statusKey: "customers",
    title: "dm.step.customers.title",
    help: "dm.step.customers.help",
    spec: {
      id: "customers",
      sheetName: "dm.sheet.customers",
      columns: [
        { key: "code", header: "dm.col.code", example: "CUS-1" },
        { key: "nameAr", header: "dm.col.name", example: "dm.eg.tradeCustomer" },
        { key: "phone", header: "dm.col.phone" },
        { key: "email", header: "dm.col.email" },
        { key: "taxNumber", header: "dm.col.taxNumber" },
        { key: "creditLimit", header: "dm.col.creditLimit" },
        { key: "paymentTermsDays", header: "dm.col.paymentTermsDays", example: "30" },
      ],
    },
  },
  {
    kind: "master",
    id: "items",
    statusKey: "items",
    title: "dm.step.items.title",
    help: "dm.step.items.help",
    spec: {
      id: "items",
      sheetName: "dm.sheet.items",
      columns: [
        { key: "code", header: "dm.col.code", example: "ITM-1" },
        { key: "nameAr", header: "dm.col.name", example: "dm.eg.sampleItem" },
        { key: "type", header: "dm.col.typeStockService", example: "stock" },
        { key: "baseUnitCode", header: "dm.col.baseUnit", example: "PCS" },
        { key: "salePrice", header: "dm.col.salePrice" },
        { key: "costPrice", header: "dm.col.costPrice" },
        { key: "taxRatePercent", header: "dm.col.taxRate" },
      ],
    },
  },
  {
    kind: "master",
    id: "item-units",
    statusKey: "itemUnits",
    title: "dm.step.item-units.title",
    help: "dm.step.item-units.help",
    spec: {
      id: "item-units",
      sheetName: "dm.sheet.item-units",
      columns: [
        { key: "itemCode", header: "dm.col.itemCode", example: "ITM-1" },
        { key: "unitCode", header: "dm.col.unitCode", example: "BOX" },
        { key: "unitName", header: "dm.col.unitName", example: "dm.eg.carton" },
        { key: "factor", header: "dm.col.factor", example: "12" },
      ],
    },
  },
  {
    kind: "master",
    id: "asset-categories",
    statusKey: "assetCategories",
    title: "dm.step.asset-categories.title",
    help: "dm.step.asset-categories.help",
    spec: {
      id: "asset-categories",
      sheetName: "dm.sheet.asset-categories",
      columns: [
        { key: "code", header: "dm.col.code", example: "CAT-1" },
        { key: "nameAr", header: "dm.col.name", example: "dm.eg.furniture" },
        { key: "defaultUsefulLifeMonths", header: "dm.col.usefulLifeMonths", example: "60" },
        { key: "defaultSalvagePercent", header: "dm.col.salvageRate", example: "10" },
      ],
    },
  },
  {
    kind: "master",
    id: "assets",
    statusKey: "assets",
    title: "dm.step.assets.title",
    help: "dm.step.assets.help",
    spec: {
      id: "assets",
      sheetName: "dm.sheet.assets",
      columns: [
        { key: "code", header: "dm.col.code", example: "AST-1" },
        { key: "nameAr", header: "dm.col.name", example: "dm.eg.desk" },
        { key: "categoryCode", header: "dm.col.categoryCode", example: "CAT-1" },
        { key: "acquisitionDate", header: "dm.col.acquisitionDate", example: "2026-01-01" },
        { key: "acquisitionCost", header: "dm.col.acquisitionCost", example: "5000.00" },
      ],
    },
  },
  {
    kind: "historical",
    importKind: "sales",
    docType: "SALES_INVOICE",
    statusKey: "salesInvoices",
    title: "dm.step.historical-sales-invoices.title",
    help: "dm.step.historical-sales-invoices.help",
    spec: { id: "historical-sales-invoices", sheetName: "dm.sheet.historical-sales-invoices", columns: HISTORICAL_COLUMNS },
  },
  {
    kind: "historical",
    importKind: "sales",
    docType: "SALES_RETURN",
    statusKey: "salesReturns",
    title: "dm.step.historical-sales-returns.title",
    help: "dm.step.historical-sales-returns.help",
    spec: { id: "historical-sales-returns", sheetName: "dm.sheet.historical-sales-returns", columns: HISTORICAL_COLUMNS },
  },
  {
    kind: "historical",
    importKind: "purchases",
    docType: "PURCHASE_INVOICE",
    statusKey: "purchaseInvoices",
    title: "dm.step.historical-purchase-invoices.title",
    help: "dm.step.historical-purchase-invoices.help",
    spec: { id: "historical-purchase-invoices", sheetName: "dm.sheet.historical-purchase-invoices", columns: HISTORICAL_COLUMNS },
  },
  {
    kind: "historical",
    importKind: "purchases",
    docType: "PURCHASE_RETURN",
    statusKey: "purchaseReturns",
    title: "dm.step.historical-purchase-returns.title",
    help: "dm.step.historical-purchase-returns.help",
    spec: { id: "historical-purchase-returns", sheetName: "dm.sheet.historical-purchase-returns", columns: HISTORICAL_COLUMNS },
  },
];

/**
 * Turns a step's catalogue keys into the copy a workbook actually carries.
 *
 * The spec is shared with `packages/ui/scripts/build-test-fixtures.ts`, which
 * has no React context, so the keys live in the data and both callers resolve
 * them at their own boundary. Safe to translate: `parseDataMigrationFile`
 * matches columns BY POSITION and skips the header row entirely, so a workbook
 * saved in either language still imports.
 */
export function resolveStepSpec(
  spec: DataMigrationStepSpec,
  t: (key: AppTranslationKey) => string,
): DataMigrationStepSpec {
  return {
    id: spec.id,
    sheetName: t(spec.sheetName as AppTranslationKey),
    columns: spec.columns.map((column) => ({
      key: column.key,
      header: t(column.header as AppTranslationKey),
      ...(column.example === undefined
        ? {}
        : { example: column.example.startsWith("dm.eg.") ? t(column.example as AppTranslationKey) : column.example }),
    })),
  };
}
