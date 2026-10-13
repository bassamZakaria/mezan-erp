import type { QueryKey } from "@tanstack/react-query";
import { ReversalDocumentType } from "@mezan/contracts";

export const LEDGER_VIEW_QUERY_KEYS: readonly QueryKey[] = [
  ["journal-entries"],
  ["gl"],
  ["account-ledger"],
  ["reports"],
  ["financial-reports"],
  ["cost-center-pl"],
  ["reconciliation"],
  ["fiscal-periods"],
  ["dashboard"],
  ["entity-audit"],
  ["audit"],
];

const STOCK_VIEWS: readonly QueryKey[] = [["inventory"], ["stock-balance"], ["stock-levels"], ["item-stock"], ["item-movements"], ["inventory-availability"]];
const TREASURY_VIEWS: readonly QueryKey[] = [["treasury-accounts"], ["vouchers"]];

export const REVERSAL_DOCUMENT_QUERY_KEYS: Readonly<Record<ReversalDocumentType, readonly QueryKey[]>> = {
  [ReversalDocumentType.FxRevaluation]: [["revaluation"]],
  [ReversalDocumentType.PayrollRun]: [["hr"], ["hr-payroll-runs"], ["hr-advances"]],
  [ReversalDocumentType.EmployeeAdvance]: [["hr"], ["hr-advances"], ...TREASURY_VIEWS],
  [ReversalDocumentType.Cheque]: [["cheques"], ["open-invoices"], ["voucher-allocations"], ["party-statement"], ["customers"], ["suppliers"], ...TREASURY_VIEWS],
  [ReversalDocumentType.YearEndClose]: [],
  [ReversalDocumentType.AssetDisposal]: [["assets"], ["depreciation-runs"], ...TREASURY_VIEWS],
  [ReversalDocumentType.HrLeaveProvision]: [["hr"]],
  [ReversalDocumentType.StockAdjustment]: [["stock-adjustments"], ["stock-adjustment"], ...STOCK_VIEWS],
  [ReversalDocumentType.Adjustment]: [["stock-adjustments"], ["stock-adjustment"], ...STOCK_VIEWS],
  [ReversalDocumentType.WritedownRun]: [["writedown-runs"], ...STOCK_VIEWS],
  [ReversalDocumentType.LetterOfGuarantee]: [["contracting"], ...TREASURY_VIEWS],
  [ReversalDocumentType.EquipmentLog]: [["equipment-logs"], ["equipment-hours"], ["projects"], ["contracting"]],
  [ReversalDocumentType.MaterialConsumption]: [["material-consumptions"], ["site-custody"], ["consumption-by-boq-line"], ["projects"], ["contracting"], ...STOCK_VIEWS],
  [ReversalDocumentType.LandedCost]: [["landed-costs"], ...STOCK_VIEWS],
  [ReversalDocumentType.DepreciationRun]: [["depreciation-runs"], ["assets"]],
  [ReversalDocumentType.RecurringJournalTemplate]: [["recurring-journal-runs"], ["recurring-journal-templates"], ["recurring-journal-due"], ["recurring-journal-skips"], ["recurring-journal-depreciation-due"]],
};

export function reversalQueryKeys(type: ReversalDocumentType): readonly QueryKey[] {
  return [...REVERSAL_DOCUMENT_QUERY_KEYS[type], ...LEDGER_VIEW_QUERY_KEYS];
}
