import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, SkeletonTable, navGroupItems, type NavGroup, type NavItem } from "@mezan/ui";
import { ALL_SCOPE } from "@mezan/domain";
import type { BranchDTO, RoleDTO, ScopeSelectionDTO } from "@mezan/contracts";
import { TenantPreferences } from "./settings/TenantPreferences";

import { useScopeSelector } from "./data/hub-hooks";
import { useProfile } from "./data/account-hooks";
import { LoginScreen } from "./login/LoginScreen";
import { FirstRunWizard } from "./login/FirstRunWizard";
import { buildCommandItems, buildGoToCommandItems, buildNavGroups, buildTopNavItem, PINNED_NAV_ITEM_KEYS } from "./nav-config";
import { useAppTranslation, type AppTranslationKey } from "./i18n";
import { useApi } from "./data/ApiContext";
import type { CommandItem, ShellUser, UserMenuItem } from "@mezan/ui";
import {
  useBranches,
  useCreateRole,
  useCreateUser,
  useDeleteRole,
  useEmployees,
  useEntitlements,
  useUnreadNotificationCount,
  useJobTitles,
  usePendingApprovalCount,
  useRoles,
  useSetUserStatus,
  useUpdateRole,
  useUpdateUser,
  useUsers,
  useWarehouses,
} from "./data/hooks";
import { UsersPage, type UserFormDraft } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import { RoleEditorPage } from "./pages/RoleEditorPage";
import { NavigationProvider, toScreenIntent, type ScreenIntent, type ScreenIntentInput } from "./navigation";
import { groupKeyForScreen, hashForRoute, hubScreenForGroup, parseHash } from "./routing";
import { Breadcrumbs, parentSegments } from "./Breadcrumbs";
import { useGlobalShortcuts } from "./keyboard/useGlobalShortcuts";
import { ShortcutsOverlay } from "./keyboard/ShortcutsOverlay";

/** Every nav-item key this shell routes to. A key here without a nav entry is unreachable; a nav entry without a key here is a dead click. */
/**
 * Every routable screen is its own chunk.
 *
 * All 117 were static imports, so opening the login page parsed the entire ERP
 * — every report, every settings tab, every module the user may never touch —
 * as one 4.7MB bundle. They are reached exclusively through ROUTABLE_SCREENS
 * below, which is a lazy boundary by construction: nothing else references
 * them, so nothing else can drag one back into the entry chunk.
 *
 * The desktop edition loads from file:// (apps/desktop/src/main/window.ts uses
 * loadFile), where a chunk is fetched as a module script — that needs Vite's
 * `base: "./"` and, in Electron, a custom protocol rather than raw file://.
 * See docs/tasks.md.
 */
const AccountingHubScreen = lazy(() => import("./screens/hubs/AccountingHubScreen").then((m) => ({ default: m.AccountingHubScreen })));
const ActivitiesScreen = lazy(() => import("./screens/ActivitiesScreen").then((m) => ({ default: m.ActivitiesScreen })));
const ApprovalsInboxScreen = lazy(() => import("./screens/ApprovalsInboxScreen").then((m) => ({ default: m.ApprovalsInboxScreen })));
const AssetCategoriesScreen = lazy(() => import("./screens/AssetCategoriesScreen").then((m) => ({ default: m.AssetCategoriesScreen })));
const AssetRegisterScreen = lazy(() => import("./screens/AssetRegisterScreen").then((m) => ({ default: m.AssetRegisterScreen })));
const AssetsHubScreen = lazy(() => import("./screens/hubs/AssetsHubScreen").then((m) => ({ default: m.AssetsHubScreen })));
const AttendanceScreen = lazy(() => import("./screens/AttendanceScreen").then((m) => ({ default: m.AttendanceScreen })));
const AuditLogScreen = lazy(() => import("./screens/AuditLogScreen").then((m) => ({ default: m.AuditLogScreen })));
const BankReconciliationScreen = lazy(() => import("./screens/BankReconciliationScreen").then((m) => ({ default: m.BankReconciliationScreen })));
const BarcodeConfigPage = lazy(() => import("./settings/BarcodeConfigPage").then((m) => ({ default: m.BarcodeConfigPage })));
const BomsScreen = lazy(() => import("./screens/BomsScreen").then((m) => ({ default: m.BomsScreen })));
const BranchesPage = lazy(() => import("./settings/BranchesPage").then((m) => ({ default: m.BranchesPage })));
const ChartOfAccountsScreen = lazy(() => import("./screens/ChartOfAccountsScreen").then((m) => ({ default: m.ChartOfAccountsScreen })));
const ChequesScreen = lazy(() => import("./screens/ChequesScreen").then((m) => ({ default: m.ChequesScreen })));
const ConfigInstancesScreen = lazy(() => import("./screens/ConfigInstancesScreen").then((m) => ({ default: m.ConfigInstancesScreen })));
const ContractsScreen = lazy(() => import("./screens/ContractsScreen").then((m) => ({ default: m.ContractsScreen })));
const CostCenterPnLScreen = lazy(() => import("./screens/CostCenterPnLScreen").then((m) => ({ default: m.CostCenterPnLScreen })));
const CostCentersScreen = lazy(() => import("./screens/CostCentersScreen").then((m) => ({ default: m.CostCentersScreen })));
const CrmHubScreen = lazy(() => import("./screens/hubs/CrmHubScreen").then((m) => ({ default: m.CrmHubScreen })));
const CustomersScreen = lazy(() => import("./screens/CustomersScreen").then((m) => ({ default: m.CustomersScreen })));
const DashboardScreen = lazy(() => import("./dashboard/DashboardScreen").then((m) => ({ default: m.DashboardScreen })));
const DataMigrationPage = lazy(() => import("./settings/DataMigrationPage").then((m) => ({ default: m.DataMigrationPage })));
const DepartmentsScreen = lazy(() => import("./screens/DepartmentsScreen").then((m) => ({ default: m.DepartmentsScreen })));
const DepreciationRunsScreen = lazy(() => import("./screens/DepreciationRunsScreen").then((m) => ({ default: m.DepreciationRunsScreen })));
const EmployeeAdvancesScreen = lazy(() => import("./screens/EmployeeAdvancesScreen").then((m) => ({ default: m.EmployeeAdvancesScreen })));
const EmployeesScreen = lazy(() => import("./screens/EmployeesScreen").then((m) => ({ default: m.EmployeesScreen })));
const EtaScreen = lazy(() => import("./screens/EtaScreen").then((m) => ({ default: m.EtaScreen })));
const ExchangeRatesScreen = lazy(() => import("./screens/ExchangeRatesScreen").then((m) => ({ default: m.ExchangeRatesScreen })));
const FinancialReportsScreen = lazy(() => import("./screens/FinancialReportsScreen").then((m) => ({ default: m.FinancialReportsScreen })));
const FiscalPeriodsScreen = lazy(() => import("./screens/FiscalPeriodsScreen").then((m) => ({ default: m.FiscalPeriodsScreen })));
const FxRevaluationScreen = lazy(() => import("./screens/FxRevaluationScreen").then((m) => ({ default: m.FxRevaluationScreen })));
const GoodsReceiptsScreen = lazy(() => import("./screens/GoodsReceiptsScreen").then((m) => ({ default: m.GoodsReceiptsScreen })));
const HolidaysScreen = lazy(() => import("./screens/HolidaysScreen").then((m) => ({ default: m.HolidaysScreen })));
const HrDashboardScreen = lazy(() => import("./screens/HrDashboardScreen").then((m) => ({ default: m.HrDashboardScreen })));
const InstallmentFollowUpsScreen = lazy(() => import("./screens/InstallmentFollowUpsScreen").then((m) => ({ default: m.InstallmentFollowUpsScreen })));
const InstallmentPlansScreen = lazy(() => import("./screens/InstallmentPlansScreen").then((m) => ({ default: m.InstallmentPlansScreen })));
const InventoryAgingReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventoryAgingReportScreen })));
const InventoryDriftReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventoryDriftReportScreen })));
const InventoryExpiringReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventoryExpiringReportScreen })));
const InventoryHubScreen = lazy(() => import("./screens/hubs/InventoryHubScreen").then((m) => ({ default: m.InventoryHubScreen })));
const InventoryLedgerReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventoryLedgerReportScreen })));
const InventoryMovementReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventoryMovementReportScreen })));
const InventorySlowMovingReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventorySlowMovingReportScreen })));
const InventoryStockLevelsReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventoryStockLevelsReportScreen })));
const InventoryValuationReportScreen = lazy(() => import("./screens/reports/InventoryReportsScreens").then((m) => ({ default: m.InventoryValuationReportScreen })));
const ItemsHubScreen = lazy(() => import("./screens/hubs/ItemsHubScreen").then((m) => ({ default: m.ItemsHubScreen })));
const ItemsScreen = lazy(() => import("./screens/ItemsScreen").then((m) => ({ default: m.ItemsScreen })));
const ItemSpecificationsScreen = lazy(() => import("./screens/ItemSpecificationsScreen").then((m) => ({ default: m.ItemSpecificationsScreen })));
const JobTitlesScreen = lazy(() => import("./screens/JobTitlesScreen").then((m) => ({ default: m.JobTitlesScreen })));
const JournalsScreen = lazy(() => import("./screens/JournalsScreen").then((m) => ({ default: m.JournalsScreen })));
const LabelPrintingScreen = lazy(() => import("./screens/LabelPrintingScreen").then((m) => ({ default: m.LabelPrintingScreen })));
const LandedCostsScreen = lazy(() => import("./screens/LandedCostsScreen").then((m) => ({ default: m.LandedCostsScreen })));
const LeadsScreen = lazy(() => import("./screens/LeadsScreen").then((m) => ({ default: m.LeadsScreen })));
const LeaveAccrualBatchesScreen = lazy(() => import("./screens/LeaveAccrualBatchesScreen").then((m) => ({ default: m.LeaveAccrualBatchesScreen })));
const LeaveBalancesScreen = lazy(() => import("./screens/LeaveBalancesScreen").then((m) => ({ default: m.LeaveBalancesScreen })));
const LeavePoliciesScreen = lazy(() => import("./screens/LeavePoliciesScreen").then((m) => ({ default: m.LeavePoliciesScreen })));
const LeaveRequestsScreen = lazy(() => import("./screens/LeaveRequestsScreen").then((m) => ({ default: m.LeaveRequestsScreen })));
const MakeVsBuyReportScreen = lazy(() => import("./screens/reports/ManufacturingReportsScreens").then((m) => ({ default: m.MakeVsBuyReportScreen })));
const ManufacturingHubScreen = lazy(() => import("./screens/hubs/ManufacturingHubScreen").then((m) => ({ default: m.ManufacturingHubScreen })));
const MyLeaveScreen = lazy(() => import("./screens/MyLeaveScreen").then((m) => ({ default: m.MyLeaveScreen })));
const NotificationRulesPage = lazy(() => import("./settings/NotificationRulesPage").then((m) => ({ default: m.NotificationRulesPage })));
const NotificationsScreen = lazy(() => import("./screens/NotificationsScreen").then((m) => ({ default: m.NotificationsScreen })));
const OpportunitiesScreen = lazy(() => import("./screens/OpportunitiesScreen").then((m) => ({ default: m.OpportunitiesScreen })));
const PayrollComponentsScreen = lazy(() => import("./screens/PayrollComponentsScreen").then((m) => ({ default: m.PayrollComponentsScreen })));
const PayrollRunsScreen = lazy(() => import("./screens/PayrollRunsScreen").then((m) => ({ default: m.PayrollRunsScreen })));
const PhysicalCountsScreen = lazy(() => import("./screens/PhysicalCountsScreen").then((m) => ({ default: m.PhysicalCountsScreen })));
const PipelineScreen = lazy(() => import("./screens/PipelineScreen").then((m) => ({ default: m.PipelineScreen })));
const PipelineStagesScreen = lazy(() => import("./screens/PipelineStagesScreen").then((m) => ({ default: m.PipelineStagesScreen })));
const PriceListsScreen = lazy(() => import("./screens/PriceListsScreen").then((m) => ({ default: m.PriceListsScreen })));
const PrintTemplatesPage = lazy(() => import("./settings/PrintTemplatesPage").then((m) => ({ default: m.PrintTemplatesPage })));
const ProductionDashboardScreen = lazy(() => import("./screens/hubs/ProductionDashboardScreen").then((m) => ({ default: m.ProductionDashboardScreen })));
const ProductTemplatesScreen = lazy(() => import("./screens/ProductTemplatesScreen").then((m) => ({ default: m.ProductTemplatesScreen })));
const ConfigurableProductsScreen = lazy(() => import("./screens/ConfigurableProductsScreen").then((m) => ({ default: m.ConfigurableProductsScreen })));
const StockBalanceScreen = lazy(() => import("./screens/StockBalanceScreen").then((m) => ({ default: m.StockBalanceScreen })));
const ProfilePage = lazy(() => import("./settings/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const ProjectsScreen = lazy(() => import("./screens/ProjectsScreen").then((m) => ({ default: m.ProjectsScreen })));
const PromotionsScreen = lazy(() => import("./screens/PromotionsScreen").then((m) => ({ default: m.PromotionsScreen })));
const PurchaseInvoicesScreen = lazy(() => import("./screens/PurchaseInvoicesScreen").then((m) => ({ default: m.PurchaseInvoicesScreen })));
const PurchaseOrdersScreen = lazy(() => import("./screens/PurchaseOrdersScreen").then((m) => ({ default: m.PurchaseOrdersScreen })));
const PurchaseReturnsScreen = lazy(() => import("./screens/PurchaseReturnsScreen").then((m) => ({ default: m.PurchaseReturnsScreen })));
const PurchasesByItemReportScreen = lazy(() => import("./screens/reports/PurchasesReportsScreens").then((m) => ({ default: m.PurchasesByItemReportScreen })));
const PurchasesByPeriodReportScreen = lazy(() => import("./screens/reports/PurchasesReportsScreens").then((m) => ({ default: m.PurchasesByPeriodReportScreen })));
const PurchasesBySupplierReportScreen = lazy(() => import("./screens/reports/PurchasesReportsScreens").then((m) => ({ default: m.PurchasesBySupplierReportScreen })));
const PurchasesHubScreen = lazy(() => import("./screens/hubs/PurchasesHubScreen").then((m) => ({ default: m.PurchasesHubScreen })));
const ReconciliationScreen = lazy(() => import("./screens/ReconciliationScreen").then((m) => ({ default: m.ReconciliationScreen })));
const RfqsScreen = lazy(() => import("./screens/RfqsScreen").then((m) => ({ default: m.RfqsScreen })));
const SalesByCustomerReportScreen = lazy(() => import("./screens/reports/SalesReportsScreens").then((m) => ({ default: m.SalesByCustomerReportScreen })));
const SalesByItemReportScreen = lazy(() => import("./screens/reports/SalesReportsScreens").then((m) => ({ default: m.SalesByItemReportScreen })));
const SalesByPeriodReportScreen = lazy(() => import("./screens/reports/SalesReportsScreens").then((m) => ({ default: m.SalesByPeriodReportScreen })));
const SalesBySalespersonReportScreen = lazy(() => import("./screens/reports/SalesReportsScreens").then((m) => ({ default: m.SalesBySalespersonReportScreen })));
const SalesHubScreen = lazy(() => import("./screens/hubs/SalesHubScreen").then((m) => ({ default: m.SalesHubScreen })));
const SalesInvoicesScreen = lazy(() => import("./screens/SalesInvoicesScreen").then((m) => ({ default: m.SalesInvoicesScreen })));
const SalesQuotesScreen = lazy(() => import("./screens/sales-quotes").then((m) => ({ default: m.SalesQuotesScreen })));
const SalesReturnsScreen = lazy(() => import("./screens/SalesReturnsScreen").then((m) => ({ default: m.SalesReturnsScreen })));
const SequencesPage = lazy(() => import("./settings/SequencesPage").then((m) => ({ default: m.SequencesPage })));
const SettingsGeneral = lazy(() => import("./settings/SettingsGeneral").then((m) => ({ default: m.SettingsGeneral })));
const StockAdjustmentsScreen = lazy(() => import("./screens/StockAdjustmentsScreen").then((m) => ({ default: m.StockAdjustmentsScreen })));
const StockTransfersScreen = lazy(() => import("./screens/StockTransfersScreen").then((m) => ({ default: m.StockTransfersScreen })));
const SuppliersScreen = lazy(() => import("./screens/SuppliersScreen").then((m) => ({ default: m.SuppliersScreen })));
const SystemStatusScreen = lazy(() => import("./screens/hubs/SystemStatusScreen").then((m) => ({ default: m.SystemStatusScreen })));
const TaxesScreen = lazy(() => import("./screens/TaxesScreen").then((m) => ({ default: m.TaxesScreen })));
const TopProductsReportScreen = lazy(() => import("./screens/reports/SalesReportsScreens").then((m) => ({ default: m.TopProductsReportScreen })));
const TreasuryAccountsScreen = lazy(() => import("./screens/TreasuryAccountsScreen").then((m) => ({ default: m.TreasuryAccountsScreen })));
const TreasuryHubScreen = lazy(() => import("./screens/hubs/TreasuryHubScreen").then((m) => ({ default: m.TreasuryHubScreen })));
const TreasuryVouchersScreen = lazy(() => import("./screens/TreasuryVouchersScreen").then((m) => ({ default: m.TreasuryVouchersScreen })));
const TrialBalanceReportScreen = lazy(() => import("./screens/TrialBalanceReportScreen").then((m) => ({ default: m.TrialBalanceReportScreen })));
const VanSalesReportScreen = lazy(() => import("./screens/reports/FieldSalesReportsScreens").then((m) => ({ default: m.VanSalesReportScreen })));
const VanTripsScreen = lazy(() => import("./screens/VanTripsScreen").then((m) => ({ default: m.VanTripsScreen })));
const WarehousesPage = lazy(() => import("./settings/WarehousesPage").then((m) => ({ default: m.WarehousesPage })));
const WorkOrdersScreen = lazy(() => import("./screens/WorkOrdersScreen").then((m) => ({ default: m.WorkOrdersScreen })));
const WorkflowConfigPage = lazy(() => import("./settings/WorkflowConfigPage").then((m) => ({ default: m.WorkflowConfigPage })));
const WritedownRunsScreen = lazy(() => import("./screens/WritedownRunsScreen").then((m) => ({ default: m.WritedownRunsScreen })));

const AgingCustomersReportScreen = lazy(() => import("./screens/reports/AgingReportsScreens").then((m) => ({ default: m.AgingCustomersReportScreen })));
const AgingSuppliersReportScreen = lazy(() => import("./screens/reports/AgingReportsScreens").then((m) => ({ default: m.AgingSuppliersReportScreen })));
const InstallmentsOverviewReportScreen = lazy(() => import("./screens/reports/InstallmentsReportsScreens").then((m) => ({ default: m.InstallmentsOverviewReportScreen })));
const InstallmentsOverdueReportScreen = lazy(() => import("./screens/reports/InstallmentsReportsScreens").then((m) => ({ default: m.InstallmentsOverdueReportScreen })));

function ScreenLoading() {
  return (
    <div className="p-[24px]">
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}

const ROUTABLE_SCREENS = {
  dashboard: DashboardScreen,
  "sales-hub": SalesHubScreen,
  "purchases-hub": PurchasesHubScreen,
  "inventory-hub": InventoryHubScreen,
  "items-hub": ItemsHubScreen,
  "accounting-hub": AccountingHubScreen,
  "treasury-hub": TreasuryHubScreen,
  "crm-hub": CrmHubScreen,
  "assets-hub": AssetsHubScreen,
  /**
   * BOTH manufacturing landing pages are still here and still routable; only
   * the NAV stopped listing two of them. The workspace opens its hub, and the
   * hub's own «افتح لوحة الإنتاج» button is how the fuller dashboard is
   * reached — a hub linking to its detail, rather than two sibling entries
   * rendering the same `/manufacturing/dashboard` response.
   */
  "manufacturing-hub": ManufacturingHubScreen,
  "production-dashboard": ProductionDashboardScreen,
  status: SystemStatusScreen,
  notifications: NotificationsScreen,
  "sales-invoices": SalesInvoicesScreen,
  quotes: SalesQuotesScreen,
  "price-lists": PriceListsScreen,
  promotions: PromotionsScreen,
  customers: CustomersScreen,
  vendors: SuppliersScreen,
  rfqs: RfqsScreen,
  "purchase-orders": PurchaseOrdersScreen,
  "goods-receipts": GoodsReceiptsScreen,
  "purchase-invoices": PurchaseInvoicesScreen,
  coa: ChartOfAccountsScreen,
  journals: JournalsScreen,
  "sales-returns": SalesReturnsScreen,
  "purchase-returns": PurchaseReturnsScreen,
  "landed-costs": LandedCostsScreen,
  "installment-plans": InstallmentPlansScreen,
  "installment-follow-ups": InstallmentFollowUpsScreen,
  items: ItemsScreen,
  /**
   * Merged into a tab or into another page, and kept routable so no URL that
   * ever worked stops working — and so nothing here is unreachable code. Each
   * one is rendered by the page that absorbed it: the three item screens are
   * tabs of `items`, `stock-balance` is the inventory hub's own table, and the
   * four reports are views inside their surviving sibling.
   */
  "product-templates": ProductTemplatesScreen,
  "configurable-products": ConfigurableProductsScreen,
  "item-specifications": ItemSpecificationsScreen,
  "stock-balance": StockBalanceScreen,
  "work-orders": WorkOrdersScreen,
  boms: BomsScreen,
  "custom-manufacturing": ConfigInstancesScreen,
  "stock-transfers": StockTransfersScreen,
  "stock-adjustments": StockAdjustmentsScreen,
  "physical-counts": PhysicalCountsScreen,
  labels: LabelPrintingScreen,
  "writedown-runs": WritedownRunsScreen,
  "cost-centers": CostCentersScreen,
  "cost-center-pl": CostCenterPnLScreen,
  "fiscal-periods": FiscalPeriodsScreen,
  "exchange-rates": ExchangeRatesScreen,
  revaluation: FxRevaluationScreen,
  reconciliation: ReconciliationScreen,
  eta: EtaScreen,
  taxes: TaxesScreen,
  "treasury-accounts": TreasuryAccountsScreen,
  "treasury-vouchers": TreasuryVouchersScreen,
  "bank-reconciliation": BankReconciliationScreen,
  cheques: ChequesScreen,
  "trial-balance-report": TrialBalanceReportScreen,
  "report-sales-by-period": SalesByPeriodReportScreen,
  "report-sales-by-item": SalesByItemReportScreen,
  "report-sales-by-customer": SalesByCustomerReportScreen,
  "report-sales-by-salesperson": SalesBySalespersonReportScreen,
  "report-sales-top-products": TopProductsReportScreen,
  "report-purchases-by-period": PurchasesByPeriodReportScreen,
  "report-purchases-by-supplier": PurchasesBySupplierReportScreen,
  "report-purchases-by-item": PurchasesByItemReportScreen,
  "report-inventory-stock-levels": InventoryStockLevelsReportScreen,
  "report-inventory-movement": InventoryMovementReportScreen,
  "report-inventory-ledger": InventoryLedgerReportScreen,
  "report-inventory-valuation": InventoryValuationReportScreen,
  "report-inventory-aging": InventoryAgingReportScreen,
  "report-inventory-expiring": InventoryExpiringReportScreen,
  "report-inventory-slow-moving": InventorySlowMovingReportScreen,
  "report-inventory-drift": InventoryDriftReportScreen,
  "report-aging-customers": AgingCustomersReportScreen,
  "report-aging-suppliers": AgingSuppliersReportScreen,
  "report-installments-overview": InstallmentsOverviewReportScreen,
  "report-installments-overdue": InstallmentsOverdueReportScreen,
  "report-van-sales": VanSalesReportScreen,
  "report-make-vs-buy": MakeVsBuyReportScreen,
  "financial-reports": FinancialReportsScreen,
  "settings-general": SettingsGeneral,
  "settings-branches": BranchesPage,
  "settings-warehouses": WarehousesPage,
  "settings-print": PrintTemplatesPage,
  "notification-rules": NotificationRulesPage,
  "settings-data-migration": DataMigrationPage,
  "settings-workflow": WorkflowConfigPage,
  "settings-sequences": SequencesPage,
  "settings-barcode": BarcodeConfigPage,
  "settings-profile": ProfilePage,
  audit: AuditLogScreen,
  approvals: ApprovalsInboxScreen,
  leads: LeadsScreen,
  opportunities: OpportunitiesScreen,
  pipeline: PipelineScreen,
  "pipeline-stages": PipelineStagesScreen,
  "crm-activities": ActivitiesScreen,
  projects: ProjectsScreen,
  "asset-categories": AssetCategoriesScreen,
  "asset-register": AssetRegisterScreen,
  "depreciation-runs": DepreciationRunsScreen,
  "van-trips": VanTripsScreen,
  "hr-dashboard": HrDashboardScreen,
  employees: EmployeesScreen,
  departments: DepartmentsScreen,
  "job-titles": JobTitlesScreen,
  contracts: ContractsScreen,
  holidays: HolidaysScreen,
  "my-leave": MyLeaveScreen,
  attendance: AttendanceScreen,
  payroll: PayrollRunsScreen,
  advances: EmployeeAdvancesScreen,
  "payroll-components": PayrollComponentsScreen,
  "leave-requests": LeaveRequestsScreen,
  "leave-policies": LeavePoliciesScreen,
  "leave-balances": LeaveBalancesScreen,
  "leave-accrual-batches": LeaveAccrualBatchesScreen,
} as const;

type RoutableKey = keyof typeof ROUTABLE_SCREENS;

/** Where ⌘N goes when the screen on display has no create flow of its own. */
const RECENT_SCREENS_KEY = "mezan.nav.recent";

function loadRecentScreens(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SCREENS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function persistRecentScreens(keys: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENT_SCREENS_KEY, JSON.stringify(keys));
  } catch {
    // Ignore write failures — recents still hold for this session.
  }
}

const DEFAULT_CREATE_SCREEN = "sales-invoices" satisfies RoutableKey;

/**
 * المستخدمون / الأدوار aren't stateless ROUTABLE_SCREENS entries — the role
 * editor needs the in-flight `editingRole` (create vs. edit), and all three
 * share the same real `/roles` + `/users` data, so they're handled as their
 * own small state machine alongside the routable-screen lookup instead.
 */
type UsersRolesView = "users" | "roles" | "role-editor";
export type ScreenKey = RoutableKey | UsersRolesView;

function isRoutable(key: string): key is RoutableKey {
  return key in ROUTABLE_SCREENS;
}

function scopeIdsToSelection(ids: string[], allIds: string[]): ScopeSelectionDTO {
  return ids.length === allIds.length ? ALL_SCOPE : ids;
}

/** The header's branch-scope chip, resolved from the session's real scope against the live branch list. */
function scopeLabelFor(
  branchScope: ScopeSelectionDTO,
  branches: readonly BranchDTO[],
  t: (key: AppTranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (branchScope === ALL_SCOPE) return t("shell.scope.allBranches");
  if (branchScope.length === 1) return branches.find((b) => b.id === branchScope[0])?.name ?? branchScope[0]!;
  return t("shell.scope.branchCount", { count: branchScope.length });
}

function initialsFor(fullName: string, unknown: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return unknown;
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join(".");
}

export function App() {
  const { session, setSession, request } = useApi();
  const profile = useProfile();
  const { t } = useAppTranslation();
  const [showWizard, setShowWizard] = useState(false);
  // The URL is the source of truth for which screen and sub-page is on display.
  const [route, setRoute] = useState(() => parseHash(window.location.hash, "dashboard"));
  const activeScreen = route.screen;
  const setActiveScreen = useCallback((screen: ScreenKey) => {
    window.location.hash = hashForRoute(screen);
  }, []);
  const [editingRole, setEditingRole] = useState<RoleDTO | null>(null); // null = creating new
  const [roleTemplate, setRoleTemplate] = useState<RoleDTO | null>(null); // the role a new one is duplicated from
  const [pendingIntent, setPendingIntent] = useState<ScreenIntent | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // How many mounted screens accept a "create" intent. Only one routable
  // screen is mounted at a time, so > 0 means "this screen can create".
  const [intentTargets, setIntentTargets] = useState(0);

  useEffect(() => {
    /**
     * The route swap is a transition, not synchronous input.
     *
     * Every screen is a lazy chunk, so this setState can suspend. Left
     * synchronous, React tears the CURRENT screen down and shows the fallback
     * the instant a nav item is clicked — the user watches their populated
     * list flash to a skeleton before the next screen arrives. Inside a
     * transition, React keeps the current screen on display until the new
     * chunk resolves, and only falls back if that takes long enough to be
     * worth telling the user about.
     */
    const onHashChange = () =>
      startTransition(() => setRoute(parseHash(window.location.hash, "dashboard")));
    window.addEventListener("hashchange", onHashChange);
    // Stamp the opening address so the first screen is linkable too.
    if (window.location.hash === "") window.location.replace(hashForRoute("dashboard"));
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback(
    (screen: ScreenKey, intent?: ScreenIntentInput) => {
      setActiveScreen(screen);
      setPendingIntent(intent ? { ...toScreenIntent(intent), screen } : null);
    },
    [setActiveScreen],
  );
  const openSubPage = useCallback(
    (segments: readonly string[]) => {
      window.location.hash = hashForRoute(route.screen, segments);
    },
    [route.screen],
  );
  const openScreenAt = useCallback((screen: ScreenKey, segments: readonly string[]) => {
    setActiveScreen(screen);
    window.location.hash = hashForRoute(screen, segments);
  }, []);
  const clearIntent = useCallback(() => setPendingIntent(null), []);
  const registerIntentTarget = useCallback(() => {
    setIntentTargets((n) => n + 1);
    return () => setIntentTargets((n) => n - 1);
  }, []);
  // Only hand an intent to the screen it names — see ScreenIntent.screen.
  const deliverableIntent = pendingIntent && (pendingIntent.screen === undefined || pendingIntent.screen === route.screen) ? pendingIntent : null;
  const navigation = useMemo(
    () => ({ navigate, segments: route.segments, openSubPage, openScreenAt, intent: deliverableIntent, clearIntent, registerIntentTarget }),
    [navigate, route.segments, openSubPage, openScreenAt, deliverableIntent, clearIntent, registerIntentTarget],
  );

  const rolesQuery = useRoles();
  const usersQuery = useUsers();
  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();
  const entitlementsQuery = useEntitlements();
  const employeesQuery = useEmployees();
  const jobTitlesQuery = useJobTitles();
  const pendingApprovalCountQuery = usePendingApprovalCount();
  const pendingApprovalCount = pendingApprovalCountQuery.data ?? 0;
  const unreadNotificationCount = useUnreadNotificationCount().data ?? 0;
  const roles = rolesQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const branches = branchesQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const entitlements = entitlementsQuery.data ?? null;
  // The user form links a login to its HR employee record (docs/catalog/09 §الموظف المرتبط).
  const employees = useMemo(() => {
    const jobTitleById = new Map((jobTitlesQuery.data ?? []).map((j) => [j.id, j.nameAr ?? j.name]));
    return (employeesQuery.data ?? []).map((e) => ({
      id: e.id,
      name: `${e.firstNameAr ?? e.firstName} ${e.lastNameAr ?? e.lastName}`.trim(),
      position: (e.jobTitleId ? jobTitleById.get(e.jobTitleId) : null) ?? "—",
    }));
  }, [employeesQuery.data, jobTitlesQuery.data]);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const setUserStatus = useSetUserStatus();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRoleMutation = useDeleteRole();
  const { branchOptions, warehouseOptions, selection, setBranch, setWarehouse } = useScopeSelector();

  const allBranchIds = branches.map((b) => b.id);
  const allWarehouseIds = warehouses.map((w) => w.id);

  const usersByRoleId = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) {
      if (u.roleId) map.set(u.roleId, (map.get(u.roleId) ?? 0) + 1);
    }
    return map;
  }, [users]);

  const groups: NavGroup[] = useMemo(() => {
    // Section items must be wired too, not just the ones hanging off the group:
    // التقارير keeps all 22 of its screens in sections, so wiring `items` alone
    // leaves every report row inert.
    const wire = (items: NavItem[]): NavItem[] =>
      items.map((item) => {
        const key = item.key;
        // الموافقات carries a global pending-count badge (docs/catalog/09
        // §الموافقات inbox nav item) — a real count off /workflow/requests/
        // pending-count, not a placeholder.
        const tag =
          key === "approvals" && pendingApprovalCount > 0
            ? { label: String(pendingApprovalCount), tone: "pattern" as const }
            : key === "notifications" && unreadNotificationCount > 0
              ? { label: String(unreadNotificationCount), tone: "pattern" as const }
              : item.tag;
        if (isRoutable(key) || key === "users" || key === "roles") {
          return { ...item, tag, onClick: () => navigate(key as ScreenKey) };
        }
        return { ...item, tag };
      });
    return buildNavGroups(t).map((group) => ({
      ...group,
      items: wire(group.items),
      sections: group.sections?.map((section) => ({ ...section, items: wire(section.items) })),
    }));
  }, [navigate, pendingApprovalCount, unreadNotificationCount, t]);

  // "Workspace" here is the top-level grouping `nav-config.tsx` already names:
  // the two-row top bar switches between them in row one instead of a left
  // rail, and ROW TWO renders the active one's own screens. الإعداد والصلاحيات
  // is deliberately not a tab — it is the gear menu, and «كل الشاشات» lists it.
  //
  // Nothing is lifted out of a workspace any more. الموافقات used to be pulled
  // out as a fixed rail pin; row two is not personal, so removing it here would
  // simply delete the approvals inbox from the only place its workspace lists it.
  // الموافقات is one destination, not a workspace: a tab promises a second row
  // of screens and this has exactly one, so it is drawn beside the tabs as a
  // plain link. Its group (سير العمل) then holds nothing and drops out of the
  // tabs — «كل الشاشات» still lists it, since it is handed the whole tree.
  const directNavItems = useMemo(
    () => groups.flatMap((group) => group.items).filter((item) => PINNED_NAV_ITEM_KEYS.includes(item.key)),
    [groups],
  );

  /**
   * The six workspaces of the column, الإعداد والصلاحيات among them.
   *
   * It used to be behind the header gear as well, on the argument that the
   * gear is the shortcut for someone already at work — but that made three
   * components draw the same fifteen screens (rail, gear, avatar menu) and
   * gave "where do I change settings" three answers. The rail holds it; ⌘K
   * reaches every screen in it by name.
   */
  const workspaceGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, items: group.items.filter((item) => !PINNED_NAV_ITEM_KEYS.includes(item.key)) }))
        // A group may carry all of its screens in sections and none directly —
        // التقارير does — so an empty `items` is not an empty group.
        .filter((group) => navGroupItems(group).length > 0),
    [groups],
  );

  /**
   * Undefined when the screen on display belongs to no workspace tab —
   * الموافقات and every الإعدادات screen do. No tab is then marked current;
   * `AppShell` keeps the last real workspace on row two so the bar does not
   * silently swap to البيع the moment either is opened.
   */
  const resolvedWorkspaceKey = groupKeyForScreen(activeScreen);
  const activeWorkspaceKey = workspaceGroups.some((g) => g.key === resolvedWorkspaceKey) ? (resolvedWorkspaceKey ?? undefined) : undefined;

  /**
   * Each workspace tab opens that workspace's hub. `hubScreenForGroup` resolves
   * the group's own hub screen and, where it has none, its first screen.
   * Reporting `false` is not decorative: `AppShell` then opens «كل الشاشات»
   * filtered to that workspace, so the tab always lands on its own screens.
   */
  const onWorkspaceChange = useCallback(
    (key: string) => {
      const hub = hubScreenForGroup(key);
      if (!hub || !isRoutable(hub)) return false;
      navigate(hub as ScreenKey);
      return true;
    },
    [navigate],
  );

  const routedCommandItems: CommandItem[] = useMemo(() => {
    const targets: Record<string, () => void> = {
      "cmd-invoice": () => navigate("sales-invoices", "create"),
      // Three entries with three different names used to dispatch the same
      // untyped create, so «تحصيل من عميل» and «دفع لمورد» were labels for
      // something the app did not do. Each now opens on its own voucher type.
      "cmd-collect": () => navigate("treasury-vouchers", { kind: "create", prefill: { voucherType: "customer_collection" } }),
      "cmd-receipt": () => navigate("treasury-vouchers", "create"),
      "cmd-receive": () => navigate("goods-receipts", "create"),
      "cmd-pay-supplier": () => navigate("treasury-vouchers", { kind: "create", prefill: { voucherType: "supplier_payment" } }),
      "cmd-purchase-invoice": () => navigate("purchase-invoices", "create"),
      "cmd-quote": () => navigate("quotes", "create"),
      "cmd-item": () => navigate("items", "create"),
      "cmd-adjustment": () => navigate("stock-adjustments", "create"),
      "cmd-shortcuts": () => setShortcutsOpen(true),
    };
    const quickActions = buildCommandItems(t).map((item) => {
      const onSelect = targets[item.id];
      return onSelect ? { ...item, onSelect } : item;
    });
    // Every navigable screen gets a go-to entry (R1.5). Built from the nav
    // specs rather than listed, so a screen added to the sidebar is reachable
    // here without anyone remembering to add it in two places.
    const goTo = buildGoToCommandItems(t)
      .map((item) => {
        const key = item.id.slice("goto-".length);
        return isRoutable(key) ? { ...item, onSelect: () => navigate(key as ScreenKey) } : null;
      })
      .filter((item): item is CommandItem => item !== null);
    return [...quickActions, ...goTo];
  }, [navigate, t]);

  // The user chip in the column's foot IS the link to الملف الشخصي, and signing
  // out is its own control beside it — the two-item dropdown they used to share
  // was a popup to reach a page and a popup to reach a button.
  const openProfile = useCallback(() => navigate("settings-profile"), [navigate]);
  const signOut = useCallback(() => {
    // Revoke server-side first: clearing the client's copy alone left the
    // token valid until it idled out, so a copied token outlived sign-out.
    void request("/auth/logout", { method: "POST" }).catch(() => undefined);
    setActiveScreen("dashboard");
    setSession(null);
  }, [request, setSession]);

  const routedTopNavItem = useMemo(() => {
    const topNavItem = buildTopNavItem(t);
    const key = topNavItem.key;
    return isRoutable(key) ? { ...topNavItem, onClick: () => navigate(key) } : topNavItem;
  }, [navigate, t]);

  const createOnCurrentScreen = useCallback(() => {
    // A screen that wired `useScreenIntent` opens its own create flow;
    // anywhere else ⌘N falls back to the app's primary create action — the
    // same one the command bar lists first.
    navigate(intentTargets > 0 ? activeScreen : DEFAULT_CREATE_SCREEN, "create");
  }, [activeScreen, intentTargets, navigate]);

  const backOnCurrentScreen = useCallback(() => {
    if (route.segments.length === 0) return;
    openSubPage(parentSegments(route.segments));
  }, [route.segments, openSubPage]);

  const { moduleJumps } = useGlobalShortcuts({
    navGroups: groups,
    topNavItem: routedTopNavItem,
    onCreate: createOnCurrentScreen,
    onShowHelp: () => setShortcutsOpen(true),
    onBack: backOnCurrentScreen,
    disabled: !session || showWizard || shortcutsOpen,
  });

  async function handleSaveUser(draft: UserFormDraft, editingId: string | null) {
    const fields = {
      fullName: draft.fullName,
      email: draft.email,
      phone: draft.phone.trim() === "" ? null : draft.phone,
      password: draft.password.trim() === "" ? undefined : draft.password,
      pin: draft.pin.trim() === "" ? undefined : draft.pin,
      roleId: draft.roleId,
      isCompanyAdmin: draft.isCompanyAdmin,
      employeeId: draft.employeeId,
      branchScope: scopeIdsToSelection(draft.branchIds, allBranchIds),
      warehouseScope: scopeIdsToSelection(draft.warehouseIds, allWarehouseIds),
      status: draft.status,
      // The admin's user form does not edit photos — people set their own in
      // الملف الشخصي — so this carries the stored value through untouched.
      photoUrl: draft.photoUrl ?? null,
    };
    try {
      const value = editingId
        ? await updateUser.mutateAsync({ id: editingId, body: fields })
        : await createUser.mutateAsync({ ...fields, password: fields.password ?? "" });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.userSaveFailed") };
    }
  }

  async function handleSaveRole(cmd: { code: string; name: string; description: string; permissions: string[] }) {
    try {
      const value = editingRole ? await updateRole.mutateAsync({ id: editingRole.id, body: cmd }) : await createRole.mutateAsync(cmd);
      setActiveScreen("roles");
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.roleSaveFailed") };
    }
  }

  async function handleRemoveRole(roleId: string) {
    try {
      await deleteRoleMutation.mutateAsync(roleId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.roleDeleteFailed") };
    }
  }

  async function handleToggleUserStatus(userId: string, status: "active" | "inactive") {
    try {
      const value = await setUserStatus.mutateAsync({ id: userId, status });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.userStatusFailed") };
    }
  }

  // Checked before the session gate on purpose: the wizard's admin step
  // establishes a session mid-flow, so a session-first gate would unmount the
  // wizard before its remaining steps run.
  if (showWizard) {
    return (
      <FirstRunWizard
        onFinish={() => setShowWizard(false)}
        onCancel={() => {
          setSession(null);
          setShowWizard(false);
        }}
      />
    );
  }

  if (!session) {
    return <LoginScreen onStartWizard={() => setShowWizard(true)} />;
  }

  const ActiveRoutableScreen = isRoutable(activeScreen) ? ROUTABLE_SCREENS[activeScreen] : null;
  const shellUser: ShellUser = {
    name: session.fullName,
    role: session.isCompanyAdmin ? t("shell.user.role.companyAdmin") : t("shell.user.role.member"),
    initials: initialsFor(session.fullName, t("app.unknownInitial")),
    // The photo comes from the profile, not the session: it changes while the
    // session lives, and the login response is issued once.
    photoUrl: profile.data?.photoUrl ?? null,
  };
  const scopeLabel = scopeLabelFor(session.branchScope, branches, t);

  return (
    <TenantPreferences>
    <NavigationProvider value={navigation}>
    <AppShell
      activeNavKey={activeScreen === "role-editor" ? "roles" : activeScreen}
      onNavigateHome={() => navigate("dashboard")}
      directNavItems={directNavItems}
      activeWorkspaceKey={activeWorkspaceKey}
      onWorkspaceChange={onWorkspaceChange}
      // Row two: the active workspace's own screens.
      workspaceGroups={workspaceGroups}
      // Every group, الإعداد والصلاحيات included — «كل الشاشات» is the
      // unfiltered map, so a screen no workspace tab shows is still browsable.
      allScreensGroups={groups}
      onShowHelp={() => setShortcutsOpen(true)}
      user={shellUser}
      commandItems={routedCommandItems}
      onOpenProfile={openProfile}
      onSignOut={signOut}
      branchOptions={branchOptions}
      warehouseOptions={warehouseOptions}
      selectedBranchId={selection.branchId}
      selectedWarehouseId={selection.warehouseId}
      onSelectBranch={setBranch}
      onSelectWarehouse={setWarehouse}
    >
      <Breadcrumbs screen={activeScreen} />
      {ActiveRoutableScreen ? (
        // Each screen is a separate chunk, so switching screens can suspend.
        // The fallback is a skeleton rather than a spinner: the page frame is
        // already on screen and only the content area is waiting.
        <Suspense fallback={<ScreenLoading />}>
          <ActiveRoutableScreen />
        </Suspense>
      ) : null}

      {activeScreen === "users" ? (
        <UsersPage
          users={users}
          roles={roles}
          branches={branches}
          warehouses={warehouses}
          employees={employees}
          onSave={handleSaveUser}
          onToggleStatus={handleToggleUserStatus}
        />
      ) : null}

      {activeScreen === "roles" ? (
        <RolesPage
          roles={roles}
          usersByRoleId={usersByRoleId}
          onCreate={() => {
            setEditingRole(null);
            setRoleTemplate(null);
            setActiveScreen("role-editor");
          }}
          onEdit={(role) => {
            setEditingRole(role);
            setRoleTemplate(null);
            setActiveScreen("role-editor");
          }}
          onDuplicate={(role) => {
            setEditingRole(null);
            setRoleTemplate(role);
            setActiveScreen("role-editor");
          }}
          onDelete={handleRemoveRole}
        />
      ) : null}

      {activeScreen === "role-editor" && entitlements ? (
        <RoleEditorPage
          role={editingRole}
          template={roleTemplate}
          entitlements={entitlements}
          onSave={handleSaveRole}
          onCancel={() => setActiveScreen("roles")}
        />
      ) : null}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} moduleJumps={moduleJumps} />
    </AppShell>
    </NavigationProvider>
    </TenantPreferences>
  );
}
