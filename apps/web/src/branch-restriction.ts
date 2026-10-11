import {
  BRANCH_POLICY_TABLE,
  BRANCH_REFUSALS,
  BranchRefusalCode,
  BranchRestrictedAccess,
  branchPolicyFor,
  branchRestrictedAccess,
  type BranchPolicyEntry,
  type ScopeSelectionDTO,
} from "@mezan/contracts";

const ALL_BRANCHES = "*";

export function isBranchRestricted(session: { readonly branchScope: ScopeSelectionDTO } | null | undefined): boolean {
  return session !== null && session !== undefined && session.branchScope !== ALL_BRANCHES;
}

/**
 * The API family each screen reads. WHETHER a branch-restricted session may
 * open it is not written here: it is read from `BRANCH_POLICY_TABLE`, the
 * table the server enforces, so the two cannot drift. A screen with no entry
 * reads a family every session may reach.
 */
export const NAV_ITEM_API: Readonly<Record<string, string>> = {
  projects: "/projects",
  "contracting-contracts": "/contracting/contracts",
  "variation-orders": "/contracting/contracts",
  certificates: "/contracting/certificates",
  "internal-certificate": "/contracting/certificates",
  subcontracts: "/contracting/subcontracts",
  "subcontract-certificates": "/contracting/subcontracts",
  guarantees: "/contracting/guarantees",
  "revenue-recognition": "/contracting/recognition",
  "site-issues": "/contracting/site",
  "material-consumption": "/contracting/site",
  "custody-register": "/contracting/site",
  "equipment-logs": "/contracting/site",
  retention: "/contracting/retention",
  "contracting-reports": "/contracting/reports",
  leads: "/crm/leads",
  reconciliation: "/reconciliation",
  revaluation: "/revaluation",
  "tax-simplified-regime": "/tax/simplified-regime",
  "report-simplified-regime-comparison": "/tax/simplified-regime",
  "hr-dashboard": "/hr/dashboard",
  "production-dashboard": "/manufacturing/dashboard",
  "settings-data-migration": "/data-migration",
  "report-security-exceptions": "/security-reports",
  "report-post-posting-changes": "/security-reports",
  "report-after-hours": "/security-reports",
  "report-new-accounts": "/security-reports",
  "report-sod-conflicts": "/security-reports",
  "report-installments-overdue": "/installments/plans/overdue",
  "report-inventory-drift": "/inventory/drift",
  "leave-accrual-batches": "/hr/leave-accrual-batches",

  "price-lists": "/price-lists",
  promotions: "/promotions",
  boms: "/manufacturing/boms",
  "configurable-products": "/manufacturing/configurable-products",
  coa: "/accounts",
  taxes: "/tax-rates",
  "exchange-rates": "/exchange-rates",
  "fiscal-periods": "/fiscal-periods",
  "pipeline-stages": "/crm/pipeline-stages",
  "asset-categories": "/assets/categories",
  departments: "/hr/departments",
  "job-titles": "/hr/job-titles",
  holidays: "/hr/holidays",
  "leave-policies": "/hr/leave-policies",
  "payroll-components": "/hr/payroll/components",
  "payroll-statutory": "/hr/payroll/statutory-tables",
  "pos-payment-methods": "/pos/payment-methods",
  "pos-settings": "/pos/settings",
  "settings-general": "/settings",
  "settings-branches": "/branches",
  "settings-sequences": "/sequences",
  "settings-print": "/print-template-config",
  "settings-barcode": "/barcode-config",
  "settings-workflow": "/workflow/configs",
  "notification-rules": "/notification-rules",
  roles: "/roles",
};

/** An action or tile inside a screen that stays open, backed by a family of its own. */
export enum BranchGatedAction {
  YearEndClose = "year_end_close",
  VatFilings = "vat_filings",
  OpeningBalanceDuplicates = "opening_balance_duplicates",
  BalancesByCurrency = "balances_by_currency",
  RecurringDue = "recurring_due",
  RecurringGenerateDue = "recurring_generate_due",
  RecurringDepreciationDue = "recurring_depreciation_due",
  RecurringSkips = "recurring_skips",
  AuditVerify = "audit_verify",
  EtaReports = "eta_reports",
  EtaReceiptsSummary = "eta_receipts_summary",
  EtaTestConnection = "eta_test_connection",
  EtaProcessQueue = "eta_process_queue",
  EtaSubmitAll = "eta_submit_all",
  EtaBulkRequeue = "eta_bulk_requeue",
  PayrollProvisions = "payroll_provisions",
  SalesHistoricalImport = "sales_historical_import",
  PurchasesHistoricalImport = "purchases_historical_import",
  InventoryRebuild = "inventory_rebuild",
  AttendanceImport = "attendance_import",
  DeviceRegister = "device_register",
}

export const BRANCH_GATED_ACTION_API: Readonly<Record<BranchGatedAction, string>> = {
  [BranchGatedAction.YearEndClose]: "/gl/year-end-close",
  [BranchGatedAction.VatFilings]: "/gl/vat-filings",
  [BranchGatedAction.OpeningBalanceDuplicates]: "/gl/opening-balance-duplicates",
  [BranchGatedAction.BalancesByCurrency]: "/gl/balances-by-currency",
  [BranchGatedAction.RecurringDue]: "/gl/recurring/due",
  [BranchGatedAction.RecurringGenerateDue]: "/gl/recurring/generate-due",
  [BranchGatedAction.RecurringDepreciationDue]: "/gl/recurring/depreciation-due",
  [BranchGatedAction.RecurringSkips]: "/gl/recurring/skips",
  [BranchGatedAction.AuditVerify]: "/audit/verify",
  [BranchGatedAction.EtaReports]: "/eta/reports",
  [BranchGatedAction.EtaReceiptsSummary]: "/eta/receipts/summary",
  [BranchGatedAction.EtaTestConnection]: "/eta/test-connection",
  [BranchGatedAction.EtaProcessQueue]: "/eta/submissions/process",
  [BranchGatedAction.EtaSubmitAll]: "/eta/submissions/submit-all",
  [BranchGatedAction.EtaBulkRequeue]: "/eta/submissions/bulk-requeue-submit",
  [BranchGatedAction.PayrollProvisions]: "/hr/payroll/provisions",
  [BranchGatedAction.SalesHistoricalImport]: "/sales/historical-import",
  [BranchGatedAction.PurchasesHistoricalImport]: "/purchases/historical-import",
  [BranchGatedAction.InventoryRebuild]: "/inventory/rebuild",
  [BranchGatedAction.AttendanceImport]: "/hr/attendance/import",
  [BranchGatedAction.DeviceRegister]: "/lan/sessions",
};

/** Company-wide families no signed-in screen reaches: the first-run wizard runs before there is a session. */
export const COMPANY_WIDE_WITHOUT_A_SURFACE: readonly string[] = ["/bootstrap"];

export function navItemAccess(key: string, table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): BranchRestrictedAccess {
  const api = NAV_ITEM_API[key];
  return api === undefined ? BranchRestrictedAccess.Full : branchRestrictedAccess(api, "GET", table);
}

export function actionAccess(action: BranchGatedAction, table: readonly BranchPolicyEntry[] = BRANCH_POLICY_TABLE): BranchRestrictedAccess {
  return branchRestrictedAccess(BRANCH_GATED_ACTION_API[action], "GET", table);
}

/** The fields of a shared record a branch-restricted session may not set — the server's own list. */
export function restrictedFieldsOf(apiPrefix: string): readonly string[] {
  return branchPolicyFor(apiPrefix)?.restrictedFields ?? [];
}

interface NavItemLike {
  readonly key: string;
}

interface NavGroupLike<Item extends NavItemLike> {
  readonly items: readonly Item[];
  readonly sections?: readonly { readonly items: readonly Item[] }[];
}

/** The nav tree without the screens a branch-restricted session cannot open; a shelf or workspace left empty goes with them. */
export function withoutBranchUnavailable<Item extends NavItemLike, Group extends NavGroupLike<Item>>(groups: readonly Group[]): Group[] {
  const open = (item: Item) => navItemAccess(item.key) !== BranchRestrictedAccess.Unavailable;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(open),
      sections: group.sections?.map((section) => ({ ...section, items: section.items.filter(open) })).filter((section) => section.items.length > 0),
    }))
    .filter((group) => group.items.length > 0 || (group.sections?.length ?? 0) > 0);
}

interface RefusalBody {
  readonly error: BranchRefusalCode;
  readonly message: string;
  readonly messageEn: string;
}

/**
 * The refusal the server would send a branch-restricted session for this
 * request, or null when it would let it through — so a call the table already
 * refuses is answered on the device instead of travelling to collect a 403.
 */
export function branchRefusalBefore(path: string, method: string): RefusalBody | null {
  const access = branchRestrictedAccess(path, method);
  if (access === BranchRestrictedAccess.Unavailable) return BRANCH_REFUSALS[branchPolicyFor(path.split("?")[0]!) ? BranchRefusalCode.CompanyWideOnly : BranchRefusalCode.PolicyUndeclared];
  return null;
}
