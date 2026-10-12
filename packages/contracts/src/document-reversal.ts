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

export enum ReversalPermission {
  FxRevaluation = "accounting.revaluation.reverse",
  PayrollRun = "hr.payroll.reverse",
  EmployeeAdvance = "hr.advance.reverse",
  Cheque = "cheques.reverse",
  YearEndClose = "accounting.year_end_close.reverse",
  AssetDisposal = "assets.disposal.reverse",
  HrLeaveProvision = "hr.provision.reverse",
  StockAdjustment = "inventory.adjustment.reverse",
  WritedownRun = "inventory.writedown.reverse",
  LetterOfGuarantee = "contracting.guarantee.reverse",
  EquipmentLog = "contracting.equipment_log.reverse",
  MaterialConsumption = "contracting.consumption.reverse",
  LandedCost = "purchases.landed_cost.reverse",
  DepreciationRun = "assets.depreciation.reverse",
  RecurringJournalRun = "accounting.recurring.reverse",
}

export interface DocumentReversalPath {
  readonly method: "POST";
  readonly route: string;
  readonly permission: ReversalPermission;
  /** The permission that gated this route before it had one of its own; every role that held it was given `permission` once. */
  readonly replaces: string;
  readonly takesReason: boolean;
  readonly takesDate: boolean;
}

export const DOCUMENT_REVERSAL_PATHS: Readonly<Record<ReversalDocumentType, DocumentReversalPath>> = {
  [ReversalDocumentType.FxRevaluation]: { method: "POST", route: "/revaluation/runs/:entryId/reverse", permission: ReversalPermission.FxRevaluation, replaces: "accounting.journal.post", takesReason: true, takesDate: true },
  [ReversalDocumentType.PayrollRun]: { method: "POST", route: "/hr/payroll/runs/:id/reverse-approval", permission: ReversalPermission.PayrollRun, replaces: "hr.payroll.void", takesReason: true, takesDate: true },
  [ReversalDocumentType.EmployeeAdvance]: { method: "POST", route: "/hr/advances/:id/cancel", permission: ReversalPermission.EmployeeAdvance, replaces: "hr.advance.approve", takesReason: false, takesDate: true },
  [ReversalDocumentType.Cheque]: { method: "POST", route: "/cheques/:id/return", permission: ReversalPermission.Cheque, replaces: "cheques.bounce", takesReason: false, takesDate: true },
  [ReversalDocumentType.YearEndClose]: { method: "POST", route: "/gl/year-end-close/:year/reopen", permission: ReversalPermission.YearEndClose, replaces: "accounting.period.reopen", takesReason: true, takesDate: false },
  [ReversalDocumentType.AssetDisposal]: { method: "POST", route: "/assets/:id/undo-disposal", permission: ReversalPermission.AssetDisposal, replaces: "assets.dispose", takesReason: true, takesDate: true },
  [ReversalDocumentType.HrLeaveProvision]: { method: "POST", route: "/hr/payroll/provisions/:kind/:asOfDate/reverse", permission: ReversalPermission.HrLeaveProvision, replaces: "hr.payroll.void", takesReason: true, takesDate: true },
  [ReversalDocumentType.StockAdjustment]: { method: "POST", route: "/inventory/stock-adjustments/:id/reverse", permission: ReversalPermission.StockAdjustment, replaces: "inventory.adjustment.confirm", takesReason: true, takesDate: true },
  [ReversalDocumentType.Adjustment]: { method: "POST", route: "/inventory/adjustments/:id/reverse", permission: ReversalPermission.StockAdjustment, replaces: "inventory.adjustment.confirm", takesReason: true, takesDate: true },
  [ReversalDocumentType.WritedownRun]: { method: "POST", route: "/inventory/writedown-runs/:id/reverse", permission: ReversalPermission.WritedownRun, replaces: "inventory.writedown.run", takesReason: true, takesDate: true },
  [ReversalDocumentType.LetterOfGuarantee]: { method: "POST", route: "/contracting/guarantees/:id/reverse-last", permission: ReversalPermission.LetterOfGuarantee, replaces: "contracting.guarantee.release", takesReason: true, takesDate: true },
  [ReversalDocumentType.EquipmentLog]: { method: "POST", route: "/contracting/site/equipment-logs/:id/reverse", permission: ReversalPermission.EquipmentLog, replaces: "projects.project.manage", takesReason: true, takesDate: true },
  [ReversalDocumentType.MaterialConsumption]: { method: "POST", route: "/contracting/site/consumptions/:id/reverse", permission: ReversalPermission.MaterialConsumption, replaces: "inventory.adjustment.confirm", takesReason: true, takesDate: true },
  [ReversalDocumentType.LandedCost]: { method: "POST", route: "/landed-costs/:id/reverse", permission: ReversalPermission.LandedCost, replaces: "purchases.landed_cost.void", takesReason: false, takesDate: true },
  [ReversalDocumentType.DepreciationRun]: { method: "POST", route: "/assets/depreciation/runs/:id/reverse", permission: ReversalPermission.DepreciationRun, replaces: "assets.depreciation.run", takesReason: false, takesDate: true },
  [ReversalDocumentType.RecurringJournalTemplate]: { method: "POST", route: "/gl/recurring/runs/:id/reverse", permission: ReversalPermission.RecurringJournalRun, replaces: "accounting.recurring.manage", takesReason: true, takesDate: true },
};

/** Old permission → the reversal permissions its holders were given, read off the registry so the two cannot drift. */
export function reversalPermissionSuccessors(): ReadonlyMap<string, readonly ReversalPermission[]> {
  const out = new Map<string, ReversalPermission[]>();
  for (const path of Object.values(DOCUMENT_REVERSAL_PATHS)) {
    const granted = out.get(path.replaces) ?? [];
    if (!granted.includes(path.permission)) granted.push(path.permission);
    out.set(path.replaces, granted);
  }
  return out;
}

/** The permissions a role holds, with the reversal permission of every older one it carries. */
export function withReversalPermissions(permissions: readonly string[]): string[] {
  const successors = reversalPermissionSuccessors();
  const out = [...permissions];
  for (const code of permissions) {
    for (const reversal of successors.get(code) ?? []) if (!out.includes(reversal)) out.push(reversal);
  }
  return out;
}

export function reversalRoute(type: ReversalDocumentType, params: Readonly<Record<string, string>>): string {
  return DOCUMENT_REVERSAL_PATHS[type].route.replace(/:(\w+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") throw new Error(`reversal route for ${type} needs "${name}"`);
    return encodeURIComponent(value);
  });
}
