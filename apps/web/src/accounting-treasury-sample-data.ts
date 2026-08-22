import type { CostCenterDTO, FiscalPeriodDTO, TaxRateDTO } from "@mezan/contracts";

/**
 * Tax rates / cost centers / fiscal periods demo data for the Cyag tenant
 * (شركة سياج) — docs/catalog/04-accounting-treasury.md. Treasury accounts
 * moved to the real `/treasury-accounts` API (see TreasuryAccountsScreen);
 * these remaining resources still await their own web-data-wiring sweep.
 */

export const demoTaxRates: TaxRateDTO[] = [
  {
    id: "tax-vat14",
    code: "VAT14",
    name: "ضريبة القيمة المضافة 14%",
    rate: 14,
    calculationType: "exclusive",
    isDefault: true,
    outputTaxAccountId: "2200",
    inputTaxAccountId: "1400",
    etaSubType: "V009",
    status: "active",
  },
  {
    id: "tax-wht1",
    code: "WHT1",
    name: "ضريبة خصم وإضافة 1%",
    rate: 1,
    calculationType: "exclusive",
    isDefault: false,
    outputTaxAccountId: null,
    inputTaxAccountId: null,
    etaSubType: "auto",
    status: "inactive",
  },
];

export const demoCostCenters: CostCenterDTO[] = [
  { id: "cc-admin", code: "CC-001", nameAr: "الإدارة العامة", nameEn: "General Administration", type: "general", departmentId: null, branchId: "b1", parentId: null, notes: null, status: "active" },
  { id: "cc-sales", code: "CC-002", nameAr: "المبيعات", nameEn: "Sales", type: "department", departmentId: "dep-sales", branchId: null, parentId: "cc-admin", notes: null, status: "active" },
  { id: "cc-marketing", code: "CC-003", nameAr: "التسويق", nameEn: "Marketing", type: "department", departmentId: "dep-marketing", branchId: null, parentId: "cc-admin", notes: null, status: "active" },
  { id: "cc-alex", code: "CC-004", nameAr: "فرع الإسكندرية", nameEn: "Alexandria Branch", type: "branch", departmentId: null, branchId: "b2", parentId: null, notes: "مركز تكلفة مستقل مرتبط بفرع الإسكندرية", status: "active" },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const PERIOD_STATUS_2026: Record<number, FiscalPeriodDTO["status"]> = {
  1: "locked",
  2: "locked",
  3: "locked",
  4: "closed",
  5: "closed",
  6: "closed",
  7: "closed",
  8: "open", // current period (today: 2026-08-22)
  9: "open",
  10: "open",
  11: "open",
  12: "open",
};

/** 12 monthly periods for fiscal year 2026 — a mix of locked/closed/open so the grid demonstrates every lifecycle action. */
export const demoFiscalPeriods: FiscalPeriodDTO[] = Array.from({ length: 12 }, (_, i) => {
  const month = i + 1;
  const endDay = lastDayOfMonth(2026, month);
  return {
    id: `fp-2026-${pad2(month)}`,
    year: 2026,
    periodNumber: month,
    startDate: `2026-${pad2(month)}-01`,
    endDate: `2026-${pad2(month)}-${pad2(endDay)}`,
    status: PERIOD_STATUS_2026[month] ?? "open",
  };
});
