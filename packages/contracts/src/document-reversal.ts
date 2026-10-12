export enum ReversalDocumentType {
  FxRevaluation = "FX_REVALUATION",
  PayrollRun = "PAYROLL_RUN",
  EmployeeAdvance = "EMPLOYEE_ADVANCE",
  Cheque = "CHEQUE",
  YearEndClose = "YEAR_END_CLOSE",
  AssetDisposal = "ASSET_DISPOSAL",
  HrLeaveProvision = "HR_LEAVE_PROVISION",
  StockAdjustment = "STOCK_ADJUSTMENT",
  Adjustment = "ADJUSTMENT",
  WritedownRun = "WRITEDOWN_RUN",
  LetterOfGuarantee = "LETTER_OF_GUARANTEE",
  EquipmentLog = "EQUIPMENT_LOG",
  MaterialConsumption = "MATERIAL_CONSUMPTION",
  LandedCost = "LANDED_COST",
  DepreciationRun = "DEPRECIATION_RUN",
  RecurringJournalTemplate = "RECURRING_JOURNAL_TEMPLATE",
}

export interface DocumentReversalPath {
  readonly method: "POST";
  readonly route: string;
  readonly permission: string;
  readonly takesReason: boolean;
  readonly takesDate: boolean;
}

export const DOCUMENT_REVERSAL_PATHS: Readonly<Record<ReversalDocumentType, DocumentReversalPath>> = {
  [ReversalDocumentType.FxRevaluation]: { method: "POST", route: "/revaluation/runs/:entryId/reverse", permission: "accounting.journal.post", takesReason: true, takesDate: true },
  [ReversalDocumentType.PayrollRun]: { method: "POST", route: "/hr/payroll/runs/:id/reverse-approval", permission: "hr.payroll.void", takesReason: true, takesDate: true },
  [ReversalDocumentType.EmployeeAdvance]: { method: "POST", route: "/hr/advances/:id/cancel", permission: "hr.advance.approve", takesReason: false, takesDate: true },
  [ReversalDocumentType.Cheque]: { method: "POST", route: "/cheques/:id/return", permission: "cheques.bounce", takesReason: false, takesDate: true },
  [ReversalDocumentType.YearEndClose]: { method: "POST", route: "/gl/year-end-close/:year/reopen", permission: "accounting.period.reopen", takesReason: true, takesDate: false },
  [ReversalDocumentType.AssetDisposal]: { method: "POST", route: "/assets/:id/undo-disposal", permission: "assets.dispose", takesReason: true, takesDate: true },
  [ReversalDocumentType.HrLeaveProvision]: { method: "POST", route: "/hr/payroll/provisions/:kind/:asOfDate/reverse", permission: "hr.payroll.void", takesReason: true, takesDate: true },
  [ReversalDocumentType.StockAdjustment]: { method: "POST", route: "/inventory/stock-adjustments/:id/reverse", permission: "inventory.adjustment.confirm", takesReason: true, takesDate: true },
  [ReversalDocumentType.Adjustment]: { method: "POST", route: "/inventory/adjustments/:id/reverse", permission: "inventory.adjustment.confirm", takesReason: true, takesDate: true },
  [ReversalDocumentType.WritedownRun]: { method: "POST", route: "/inventory/writedown-runs/:id/reverse", permission: "inventory.writedown.run", takesReason: true, takesDate: true },
  [ReversalDocumentType.LetterOfGuarantee]: { method: "POST", route: "/contracting/guarantees/:id/reverse-last", permission: "contracting.guarantee.release", takesReason: true, takesDate: true },
  [ReversalDocumentType.EquipmentLog]: { method: "POST", route: "/contracting/site/equipment-logs/:id/reverse", permission: "projects.project.manage", takesReason: true, takesDate: true },
  [ReversalDocumentType.MaterialConsumption]: { method: "POST", route: "/contracting/site/consumptions/:id/reverse", permission: "inventory.adjustment.confirm", takesReason: true, takesDate: true },
  [ReversalDocumentType.LandedCost]: { method: "POST", route: "/landed-costs/:id/reverse", permission: "purchases.landed_cost.void", takesReason: false, takesDate: true },
  [ReversalDocumentType.DepreciationRun]: { method: "POST", route: "/assets/depreciation/runs/:id/reverse", permission: "assets.depreciation.run", takesReason: false, takesDate: true },
  [ReversalDocumentType.RecurringJournalTemplate]: { method: "POST", route: "/gl/recurring/runs/:id/reverse", permission: "accounting.recurring.manage", takesReason: true, takesDate: true },
};

export function reversalRoute(type: ReversalDocumentType, params: Readonly<Record<string, string>>): string {
  return DOCUMENT_REVERSAL_PATHS[type].route.replace(/:(\w+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") throw new Error(`reversal route for ${type} needs "${name}"`);
    return encodeURIComponent(value);
  });
}
