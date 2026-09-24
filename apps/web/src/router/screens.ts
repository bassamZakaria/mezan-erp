import type { ComponentType } from "react";

/**
 * Every routable screen, as a lazy ROUTE MODULE rather than a React.lazy
 * component.
 *
 * A route-level `lazy` splits the screen AND anything the route needs with
 * it — its loader, its error boundary — where React.lazy can only split the
 * component. The router awaits this before it renders the match, so a screen
 * never mounts without the module that describes it.
 *
 * This map is the only reference to any screen module: nothing else imports
 * them, so nothing can drag one back into the entry chunk. Opening the login
 * page used to parse all 116 as a single 4.7MB bundle.
 */
export type ScreenModuleLoader = () => Promise<{ readonly Component: ComponentType }>;

export const SCREEN_MODULES = {
  dashboard: () => import("../dashboard/DashboardScreen").then((m) => ({ Component: m.DashboardScreen })),
  "sales-hub": () => import("../screens/hubs/SalesHubScreen").then((m) => ({ Component: m.SalesHubScreen })),
  "purchases-hub": () => import("../screens/hubs/PurchasesHubScreen").then((m) => ({ Component: m.PurchasesHubScreen })),
  "inventory-hub": () => import("../screens/hubs/InventoryHubScreen").then((m) => ({ Component: m.InventoryHubScreen })),
  "items-hub": () => import("../screens/hubs/ItemsHubScreen").then((m) => ({ Component: m.ItemsHubScreen })),
  "accounting-hub": () => import("../screens/hubs/AccountingHubScreen").then((m) => ({ Component: m.AccountingHubScreen })),
  "treasury-hub": () => import("../screens/hubs/TreasuryHubScreen").then((m) => ({ Component: m.TreasuryHubScreen })),
  "crm-hub": () => import("../screens/hubs/CrmHubScreen").then((m) => ({ Component: m.CrmHubScreen })),
  "assets-hub": () => import("../screens/hubs/AssetsHubScreen").then((m) => ({ Component: m.AssetsHubScreen })),
  /**
   * BOTH manufacturing landing pages are still here and still routable; only
   * the NAV stopped listing two of them. The workspace opens its hub, and the
   * hub's own «افتح لوحة الإنتاج» button is how the fuller dashboard is
   * reached — a hub linking to its detail, rather than two sibling entries
   * rendering the same `/manufacturing/dashboard` response.
   */
  "manufacturing-hub": () => import("../screens/hubs/ManufacturingHubScreen").then((m) => ({ Component: m.ManufacturingHubScreen })),
  "production-dashboard": () => import("../screens/hubs/ProductionDashboardScreen").then((m) => ({ Component: m.ProductionDashboardScreen })),
  status: () => import("../screens/hubs/SystemStatusScreen").then((m) => ({ Component: m.SystemStatusScreen })),
  notifications: () => import("../screens/NotificationsScreen").then((m) => ({ Component: m.NotificationsScreen })),
  "sales-invoices": () => import("../screens/SalesInvoicesScreen").then((m) => ({ Component: m.SalesInvoicesScreen })),
  quotes: () => import("../screens/sales-quotes").then((m) => ({ Component: m.SalesQuotesScreen })),
  "price-lists": () => import("../screens/PriceListsScreen").then((m) => ({ Component: m.PriceListsScreen })),
  promotions: () => import("../screens/PromotionsScreen").then((m) => ({ Component: m.PromotionsScreen })),
  customers: () => import("../screens/CustomersScreen").then((m) => ({ Component: m.CustomersScreen })),
  vendors: () => import("../screens/SuppliersScreen").then((m) => ({ Component: m.SuppliersScreen })),
  rfqs: () => import("../screens/RfqsScreen").then((m) => ({ Component: m.RfqsScreen })),
  "purchase-orders": () => import("../screens/PurchaseOrdersScreen").then((m) => ({ Component: m.PurchaseOrdersScreen })),
  "goods-receipts": () => import("../screens/GoodsReceiptsScreen").then((m) => ({ Component: m.GoodsReceiptsScreen })),
  "purchase-invoices": () => import("../screens/PurchaseInvoicesScreen").then((m) => ({ Component: m.PurchaseInvoicesScreen })),
  coa: () => import("../screens/ChartOfAccountsScreen").then((m) => ({ Component: m.ChartOfAccountsScreen })),
  journals: () => import("../screens/JournalsScreen").then((m) => ({ Component: m.JournalsScreen })),
  "sales-returns": () => import("../screens/SalesReturnsScreen").then((m) => ({ Component: m.SalesReturnsScreen })),
  "purchase-returns": () => import("../screens/PurchaseReturnsScreen").then((m) => ({ Component: m.PurchaseReturnsScreen })),
  "landed-costs": () => import("../screens/LandedCostsScreen").then((m) => ({ Component: m.LandedCostsScreen })),
  "installment-plans": () => import("../screens/InstallmentPlansScreen").then((m) => ({ Component: m.InstallmentPlansScreen })),
  "installment-follow-ups": () => import("../screens/InstallmentFollowUpsScreen").then((m) => ({ Component: m.InstallmentFollowUpsScreen })),
  items: () => import("../screens/ItemsScreen").then((m) => ({ Component: m.ItemsScreen })),
  "product-templates": () => import("../screens/ProductTemplatesScreen").then((m) => ({ Component: m.ProductTemplatesScreen })),
  "configurable-products": () => import("../screens/ConfigurableProductsScreen").then((m) => ({ Component: m.ConfigurableProductsScreen })),
  "item-specifications": () => import("../screens/ItemSpecificationsScreen").then((m) => ({ Component: m.ItemSpecificationsScreen })),
  "stock-balance": () => import("../screens/StockBalanceScreen").then((m) => ({ Component: m.StockBalanceScreen })),
  "work-orders": () => import("../screens/WorkOrdersScreen").then((m) => ({ Component: m.WorkOrdersScreen })),
  boms: () => import("../screens/BomsScreen").then((m) => ({ Component: m.BomsScreen })),
  "custom-manufacturing": () => import("../screens/ConfigInstancesScreen").then((m) => ({ Component: m.ConfigInstancesScreen })),
  "stock-transfers": () => import("../screens/StockTransfersScreen").then((m) => ({ Component: m.StockTransfersScreen })),
  "stock-adjustments": () => import("../screens/StockAdjustmentsScreen").then((m) => ({ Component: m.StockAdjustmentsScreen })),
  "physical-counts": () => import("../screens/PhysicalCountsScreen").then((m) => ({ Component: m.PhysicalCountsScreen })),
  labels: () => import("../screens/LabelPrintingScreen").then((m) => ({ Component: m.LabelPrintingScreen })),
  "writedown-runs": () => import("../screens/WritedownRunsScreen").then((m) => ({ Component: m.WritedownRunsScreen })),
  "cost-centers": () => import("../screens/CostCentersScreen").then((m) => ({ Component: m.CostCentersScreen })),
  "cost-center-pl": () => import("../screens/CostCenterPnLScreen").then((m) => ({ Component: m.CostCenterPnLScreen })),
  "fiscal-periods": () => import("../screens/FiscalPeriodsScreen").then((m) => ({ Component: m.FiscalPeriodsScreen })),
  "exchange-rates": () => import("../screens/ExchangeRatesScreen").then((m) => ({ Component: m.ExchangeRatesScreen })),
  revaluation: () => import("../screens/FxRevaluationScreen").then((m) => ({ Component: m.FxRevaluationScreen })),
  reconciliation: () => import("../screens/ReconciliationScreen").then((m) => ({ Component: m.ReconciliationScreen })),
  eta: () => import("../screens/EtaScreen").then((m) => ({ Component: m.EtaScreen })),
  taxes: () => import("../screens/TaxesScreen").then((m) => ({ Component: m.TaxesScreen })),
  "treasury-accounts": () => import("../screens/TreasuryAccountsScreen").then((m) => ({ Component: m.TreasuryAccountsScreen })),
  "treasury-vouchers": () => import("../screens/TreasuryVouchersScreen").then((m) => ({ Component: m.TreasuryVouchersScreen })),
  "bank-reconciliation": () => import("../screens/BankReconciliationScreen").then((m) => ({ Component: m.BankReconciliationScreen })),
  cheques: () => import("../screens/ChequesScreen").then((m) => ({ Component: m.ChequesScreen })),
  "trial-balance-report": () => import("../screens/TrialBalanceReportScreen").then((m) => ({ Component: m.TrialBalanceReportScreen })),
  "report-sales-by-period": () => import("../screens/reports/SalesReportsScreens").then((m) => ({ Component: m.SalesByPeriodReportScreen })),
  "report-sales-by-item": () => import("../screens/reports/SalesReportsScreens").then((m) => ({ Component: m.SalesByItemReportScreen })),
  "report-sales-by-customer": () => import("../screens/reports/SalesReportsScreens").then((m) => ({ Component: m.SalesByCustomerReportScreen })),
  "report-sales-by-salesperson": () => import("../screens/reports/SalesReportsScreens").then((m) => ({ Component: m.SalesBySalespersonReportScreen })),
  "report-sales-top-products": () => import("../screens/reports/SalesReportsScreens").then((m) => ({ Component: m.TopProductsReportScreen })),
  "report-purchases-by-period": () => import("../screens/reports/PurchasesReportsScreens").then((m) => ({ Component: m.PurchasesByPeriodReportScreen })),
  "report-purchases-by-supplier": () => import("../screens/reports/PurchasesReportsScreens").then((m) => ({ Component: m.PurchasesBySupplierReportScreen })),
  "report-purchases-by-item": () => import("../screens/reports/PurchasesReportsScreens").then((m) => ({ Component: m.PurchasesByItemReportScreen })),
  "report-inventory-stock-levels": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventoryStockLevelsReportScreen })),
  "report-inventory-movement": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventoryMovementReportScreen })),
  "report-inventory-ledger": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventoryLedgerReportScreen })),
  "report-inventory-valuation": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventoryValuationReportScreen })),
  "report-inventory-aging": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventoryAgingReportScreen })),
  "report-inventory-expiring": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventoryExpiringReportScreen })),
  "report-inventory-slow-moving": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventorySlowMovingReportScreen })),
  "report-inventory-drift": () => import("../screens/reports/InventoryReportsScreens").then((m) => ({ Component: m.InventoryDriftReportScreen })),
  "report-aging-customers": () => import("../screens/reports/AgingReportsScreens").then((m) => ({ Component: m.AgingCustomersReportScreen })),
  "report-aging-suppliers": () => import("../screens/reports/AgingReportsScreens").then((m) => ({ Component: m.AgingSuppliersReportScreen })),
  "report-installments-overview": () => import("../screens/reports/InstallmentsReportsScreens").then((m) => ({ Component: m.InstallmentsOverviewReportScreen })),
  "report-installments-overdue": () => import("../screens/reports/InstallmentsReportsScreens").then((m) => ({ Component: m.InstallmentsOverdueReportScreen })),
  "report-van-sales": () => import("../screens/reports/FieldSalesReportsScreens").then((m) => ({ Component: m.VanSalesReportScreen })),
  "report-make-vs-buy": () => import("../screens/reports/ManufacturingReportsScreens").then((m) => ({ Component: m.MakeVsBuyReportScreen })),
  "financial-reports": () => import("../screens/FinancialReportsScreen").then((m) => ({ Component: m.FinancialReportsScreen })),
  "settings-general": () => import("../settings/SettingsGeneral").then((m) => ({ Component: m.SettingsGeneral })),
  "settings-branches": () => import("../settings/BranchesPage").then((m) => ({ Component: m.BranchesPage })),
  "settings-warehouses": () => import("../settings/WarehousesPage").then((m) => ({ Component: m.WarehousesPage })),
  "settings-print": () => import("../settings/PrintTemplatesPage").then((m) => ({ Component: m.PrintTemplatesPage })),
  "notification-rules": () => import("../settings/NotificationRulesPage").then((m) => ({ Component: m.NotificationRulesPage })),
  "settings-data-migration": () => import("../settings/DataMigrationPage").then((m) => ({ Component: m.DataMigrationPage })),
  "settings-workflow": () => import("../settings/WorkflowConfigPage").then((m) => ({ Component: m.WorkflowConfigPage })),
  "settings-sequences": () => import("../settings/SequencesPage").then((m) => ({ Component: m.SequencesPage })),
  "settings-barcode": () => import("../settings/BarcodeConfigPage").then((m) => ({ Component: m.BarcodeConfigPage })),
  "settings-profile": () => import("../settings/ProfilePage").then((m) => ({ Component: m.ProfilePage })),
  audit: () => import("../screens/AuditLogScreen").then((m) => ({ Component: m.AuditLogScreen })),
  "security-exceptions": () => import("../screens/security/SecurityExceptionsScreen").then((m) => ({ Component: m.SecurityExceptionsScreen })),
  "security-post-posting-changes": () => import("../screens/security/PostPostingChangesScreen").then((m) => ({ Component: m.PostPostingChangesScreen })),
  "security-after-hours": () => import("../screens/security/AfterHoursScreen").then((m) => ({ Component: m.AfterHoursScreen })),
  "security-new-accounts": () => import("../screens/security/NewAccountsScreen").then((m) => ({ Component: m.NewAccountsScreen })),
  devices: () => import("../screens/ConnectedDevicesScreen").then((m) => ({ Component: m.ConnectedDevicesScreen })),
  "settings-backup": () => import("../settings/BackupRestorePage").then((m) => ({ Component: m.BackupRestorePage })),
  approvals: () => import("../screens/ApprovalsInboxScreen").then((m) => ({ Component: m.ApprovalsInboxScreen })),
  leads: () => import("../screens/LeadsScreen").then((m) => ({ Component: m.LeadsScreen })),
  opportunities: () => import("../screens/OpportunitiesScreen").then((m) => ({ Component: m.OpportunitiesScreen })),
  pipeline: () => import("../screens/PipelineScreen").then((m) => ({ Component: m.PipelineScreen })),
  "pipeline-stages": () => import("../screens/PipelineStagesScreen").then((m) => ({ Component: m.PipelineStagesScreen })),
  "crm-activities": () => import("../screens/ActivitiesScreen").then((m) => ({ Component: m.ActivitiesScreen })),
  projects: () => import("../screens/ProjectsScreen").then((m) => ({ Component: m.ProjectsScreen })),
  "asset-categories": () => import("../screens/AssetCategoriesScreen").then((m) => ({ Component: m.AssetCategoriesScreen })),
  "asset-register": () => import("../screens/AssetRegisterScreen").then((m) => ({ Component: m.AssetRegisterScreen })),
  "depreciation-runs": () => import("../screens/DepreciationRunsScreen").then((m) => ({ Component: m.DepreciationRunsScreen })),
  "van-trips": () => import("../screens/VanTripsScreen").then((m) => ({ Component: m.VanTripsScreen })),
  "hr-dashboard": () => import("../screens/HrDashboardScreen").then((m) => ({ Component: m.HrDashboardScreen })),
  employees: () => import("../screens/EmployeesScreen").then((m) => ({ Component: m.EmployeesScreen })),
  departments: () => import("../screens/DepartmentsScreen").then((m) => ({ Component: m.DepartmentsScreen })),
  "job-titles": () => import("../screens/JobTitlesScreen").then((m) => ({ Component: m.JobTitlesScreen })),
  contracts: () => import("../screens/ContractsScreen").then((m) => ({ Component: m.ContractsScreen })),
  holidays: () => import("../screens/HolidaysScreen").then((m) => ({ Component: m.HolidaysScreen })),
  "my-leave": () => import("../screens/MyLeaveScreen").then((m) => ({ Component: m.MyLeaveScreen })),
  attendance: () => import("../screens/AttendanceScreen").then((m) => ({ Component: m.AttendanceScreen })),
  payroll: () => import("../screens/PayrollRunsScreen").then((m) => ({ Component: m.PayrollRunsScreen })),
  advances: () => import("../screens/EmployeeAdvancesScreen").then((m) => ({ Component: m.EmployeeAdvancesScreen })),
  "payroll-components": () => import("../screens/PayrollComponentsScreen").then((m) => ({ Component: m.PayrollComponentsScreen })),
  "leave-requests": () => import("../screens/LeaveRequestsScreen").then((m) => ({ Component: m.LeaveRequestsScreen })),
  "leave-policies": () => import("../screens/LeavePoliciesScreen").then((m) => ({ Component: m.LeavePoliciesScreen })),
  "leave-balances": () => import("../screens/LeaveBalancesScreen").then((m) => ({ Component: m.LeaveBalancesScreen })),
  "leave-accrual-batches": () => import("../screens/LeaveAccrualBatchesScreen").then((m) => ({ Component: m.LeaveAccrualBatchesScreen })),
} as const satisfies Record<string, ScreenModuleLoader>;

/** Every nav-item key this shell routes to. */
export type RoutableKey = keyof typeof SCREEN_MODULES;

export function isRoutable(key: string): key is RoutableKey {
  return key in SCREEN_MODULES;
}

/**
 * المستخدمون / الأدوار aren't stateless screen modules — the role editor needs
 * the in-flight `editingRole` (create vs. edit), and all three share the same
 * real `/roles` + `/users` data, so AppLayout runs them as its own small state
 * machine alongside the routed screens.
 */
export type UsersRolesView = "users" | "roles" | "role-editor";

/**
 * Every key the shell can be addressed by.
 *
 * Declared HERE rather than in App: the screen modules below import this type,
 * and having it live in the layout that renders them made every screen import
 * the layout. Type-only, so it never cost a runtime cycle — but it made the
 * dependency graph read backwards.
 */
export type ScreenKey = RoutableKey | UsersRolesView;
