export interface DocumentReversalPath {
  readonly method: "POST";
  readonly route: string;
  readonly permission: string;
}

/** The named path that undoes each entry type the journal's own reverse refuses. */
export const DOCUMENT_REVERSAL_PATHS: Readonly<Record<string, DocumentReversalPath>> = {
  FX_REVALUATION: { method: "POST", route: "/revaluation/runs/:entryId/reverse", permission: "accounting.journal.post" },
  PAYROLL_RUN: { method: "POST", route: "/hr/payroll/runs/:id/reverse-approval", permission: "hr.payroll.void" },
  EMPLOYEE_ADVANCE: { method: "POST", route: "/hr/advances/:id/cancel", permission: "hr.advance.approve" },
  CHEQUE: { method: "POST", route: "/cheques/:id/return", permission: "cheques.bounce" },
  YEAR_END_CLOSE: { method: "POST", route: "/gl/year-end-close/:year/reopen", permission: "accounting.period.reopen" },
  ASSET_DISPOSAL: { method: "POST", route: "/assets/:id/undo-disposal", permission: "assets.dispose" },
  HR_LEAVE_PROVISION: { method: "POST", route: "/hr/payroll/provisions/:kind/:asOfDate/reverse", permission: "hr.payroll.void" },
  STOCK_ADJUSTMENT: { method: "POST", route: "/inventory/stock-adjustments/:id/reverse", permission: "inventory.adjustment.confirm" },
  ADJUSTMENT: { method: "POST", route: "/inventory/adjustments/:id/reverse", permission: "inventory.adjustment.confirm" },
  WRITEDOWN_RUN: { method: "POST", route: "/inventory/writedown-runs/:id/reverse", permission: "inventory.writedown.run" },
  LETTER_OF_GUARANTEE: { method: "POST", route: "/contracting/guarantees/:id/reverse-last", permission: "contracting.guarantee.release" },
  EQUIPMENT_LOG: { method: "POST", route: "/contracting/site/equipment-logs/:id/reverse", permission: "projects.project.manage" },
  MATERIAL_CONSUMPTION: { method: "POST", route: "/contracting/site/consumptions/:id/reverse", permission: "inventory.adjustment.confirm" },
  LANDED_COST: { method: "POST", route: "/landed-costs/:id/reverse", permission: "purchases.landed_cost.void" },
  DEPRECIATION_RUN: { method: "POST", route: "/assets/depreciation/runs/:id/reverse", permission: "assets.depreciation.run" },
  RECURRING_JOURNAL_TEMPLATE: { method: "POST", route: "/gl/recurring/runs/:id/reverse", permission: "accounting.recurring.manage" },
};
