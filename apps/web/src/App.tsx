import { useCallback, useMemo, useState } from "react";
import { AppShell, type NavGroup } from "@mezan/ui";
import { ALL_SCOPE } from "@mezan/domain";
import type { BranchDTO, RoleDTO, ScopeSelectionDTO } from "@mezan/contracts";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { ChartOfAccountsScreen } from "./screens/ChartOfAccountsScreen";
import { ItemsScreen } from "./screens/ItemsScreen";
import { BomsScreen } from "./screens/BomsScreen";
import { WorkOrdersScreen } from "./screens/WorkOrdersScreen";
import { ConfigurableProductsScreen } from "./screens/ConfigurableProductsScreen";
import { ConfigInstancesScreen } from "./screens/ConfigInstancesScreen";
import { SalesInvoicesScreen } from "./screens/SalesInvoicesScreen";
import { CustomersScreen } from "./screens/CustomersScreen";
import { SuppliersScreen } from "./screens/SuppliersScreen";
import { RfqsScreen } from "./screens/RfqsScreen";
import { PurchaseOrdersScreen } from "./screens/PurchaseOrdersScreen";
import { GoodsReceiptsScreen } from "./screens/GoodsReceiptsScreen";
import { PurchaseInvoicesScreen } from "./screens/PurchaseInvoicesScreen";
import { TaxesScreen } from "./screens/TaxesScreen";
import { CostCentersScreen } from "./screens/CostCentersScreen";
import { TreasuryAccountsScreen } from "./screens/TreasuryAccountsScreen";
import { TreasuryVouchersScreen } from "./screens/TreasuryVouchersScreen";
import { BankReconciliationScreen } from "./screens/BankReconciliationScreen";
import { ChequesScreen } from "./screens/ChequesScreen";
import { TrialBalanceReportScreen } from "./screens/TrialBalanceReportScreen";
import { FinancialReportsScreen } from "./screens/FinancialReportsScreen";
import { FiscalPeriodsScreen } from "./screens/FiscalPeriodsScreen";
import { JournalsScreen } from "./screens/JournalsScreen";
import { SalesReturnsScreen } from "./screens/SalesReturnsScreen";
import { PurchaseReturnsScreen } from "./screens/PurchaseReturnsScreen";
import { LandedCostsScreen } from "./screens/LandedCostsScreen";
import { InstallmentPlansScreen } from "./screens/InstallmentPlansScreen";
import { InstallmentFollowUpsScreen } from "./screens/InstallmentFollowUpsScreen";
import { SalesQuotesScreen } from "./screens/SalesQuotesScreen";
import { PriceListsScreen } from "./screens/PriceListsScreen";
import { PromotionsScreen } from "./screens/PromotionsScreen";
import { CostCenterPnLScreen } from "./screens/CostCenterPnLScreen";
import { ExchangeRatesScreen } from "./screens/ExchangeRatesScreen";
import { FxRevaluationScreen } from "./screens/FxRevaluationScreen";
import { ReconciliationScreen } from "./screens/ReconciliationScreen";
import { EtaScreen } from "./screens/EtaScreen";
import {
  SalesByPeriodReportScreen,
  SalesByItemReportScreen,
  SalesByCustomerReportScreen,
  TopProductsReportScreen,
} from "./screens/reports/SalesReportsScreens";
import {
  PurchasesByPeriodReportScreen,
  PurchasesBySupplierReportScreen,
  PurchasesByItemReportScreen,
} from "./screens/reports/PurchasesReportsScreens";
import {
  InventoryStockLevelsReportScreen,
  InventoryMovementReportScreen,
  InventoryLedgerReportScreen,
  InventoryValuationReportScreen,
  InventoryAgingReportScreen,
  InventoryExpiringReportScreen,
  InventorySlowMovingReportScreen,
  InventoryDriftReportScreen,
} from "./screens/reports/InventoryReportsScreens";
import { AgingCustomersReportScreen, AgingSuppliersReportScreen } from "./screens/reports/AgingReportsScreens";
import { InstallmentsOverviewReportScreen, InstallmentsOverdueReportScreen } from "./screens/reports/InstallmentsReportsScreens";
import { VanSalesReportScreen } from "./screens/reports/FieldSalesReportsScreens";
import { MakeVsBuyReportScreen } from "./screens/reports/ManufacturingReportsScreens";
import { LeadsScreen } from "./screens/LeadsScreen";
import { OpportunitiesScreen } from "./screens/OpportunitiesScreen";
import { PipelineScreen } from "./screens/PipelineScreen";
import { PipelineStagesScreen } from "./screens/PipelineStagesScreen";
import { ActivitiesScreen } from "./screens/ActivitiesScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { HrDashboardScreen } from "./screens/HrDashboardScreen";
import { EmployeesScreen } from "./screens/EmployeesScreen";
import { DepartmentsScreen } from "./screens/DepartmentsScreen";
import { JobTitlesScreen } from "./screens/JobTitlesScreen";
import { ContractsScreen } from "./screens/ContractsScreen";
import { HolidaysScreen } from "./screens/HolidaysScreen";
import { MyLeaveScreen } from "./screens/MyLeaveScreen";
import { AttendanceScreen } from "./screens/AttendanceScreen";
import { PayrollRunsScreen } from "./screens/PayrollRunsScreen";
import { EmployeeAdvancesScreen } from "./screens/EmployeeAdvancesScreen";
import { LeaveRequestsScreen } from "./screens/LeaveRequestsScreen";
import { LeavePoliciesScreen } from "./screens/LeavePoliciesScreen";
import { LeaveBalancesScreen } from "./screens/LeaveBalancesScreen";
import { LeaveAccrualBatchesScreen } from "./screens/LeaveAccrualBatchesScreen";
import { AssetCategoriesScreen } from "./screens/AssetCategoriesScreen";
import { AssetRegisterScreen } from "./screens/AssetRegisterScreen";
import { DepreciationRunsScreen } from "./screens/DepreciationRunsScreen";
import { VanTripsScreen } from "./screens/VanTripsScreen";
import { StockAdjustmentsScreen } from "./screens/StockAdjustmentsScreen";
import { StockTransfersScreen } from "./screens/StockTransfersScreen";
import { PhysicalCountsScreen } from "./screens/PhysicalCountsScreen";
import { StockBalanceScreen } from "./screens/StockBalanceScreen";
import { WritedownRunsScreen } from "./screens/WritedownRunsScreen";
import { ProductTemplatesScreen } from "./screens/ProductTemplatesScreen";
import { ItemSpecificationsScreen } from "./screens/ItemSpecificationsScreen";
import { LabelPrintingScreen } from "./screens/LabelPrintingScreen";
import { SettingsGeneral } from "./settings/SettingsGeneral";
import { BranchesPage } from "./settings/BranchesPage";
import { WarehousesPage } from "./settings/WarehousesPage";
import { PrintTemplatesPage } from "./settings/PrintTemplatesPage";
import { NotificationRulesPage } from "./settings/NotificationRulesPage";
import { useNotificationsBell } from "./notifications/NotificationsBell";
import { DataMigrationPage } from "./settings/DataMigrationPage";
import { WorkflowConfigPage } from "./settings/WorkflowConfigPage";
import { ApprovalsInboxScreen } from "./screens/ApprovalsInboxScreen";
import { AuditLogScreen } from "./screens/AuditLogScreen";
import { SequencesPage } from "./settings/SequencesPage";
import { BarcodeConfigPage } from "./settings/BarcodeConfigPage";
import { ProfilePage } from "./settings/ProfilePage";
import { ApiKeysPage } from "./settings/ApiKeysPage";
import { WebhooksPage } from "./settings/WebhooksPage";
import { SalesHubScreen } from "./screens/hubs/SalesHubScreen";
import { PurchasesHubScreen } from "./screens/hubs/PurchasesHubScreen";
import { InventoryHubScreen } from "./screens/hubs/InventoryHubScreen";
import { AccountingHubScreen } from "./screens/hubs/AccountingHubScreen";
import { TreasuryHubScreen } from "./screens/hubs/TreasuryHubScreen";
import { CrmHubScreen } from "./screens/hubs/CrmHubScreen";
import { AssetsHubScreen } from "./screens/hubs/AssetsHubScreen";
import { ManufacturingHubScreen } from "./screens/hubs/ManufacturingHubScreen";
import { ProductionDashboardScreen } from "./screens/hubs/ProductionDashboardScreen";
import { SystemStatusScreen } from "./screens/hubs/SystemStatusScreen";
import { useScopeSelector } from "./data/hub-hooks";
import { LoginScreen } from "./login/LoginScreen";
import { FirstRunWizard } from "./login/FirstRunWizard";
import { buildCommandItems, buildNavGroups, buildTopNavItem } from "./nav-config";
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
import { NavigationProvider, type ScreenIntent } from "./navigation";
import { useGlobalShortcuts } from "./keyboard/useGlobalShortcuts";
import { ShortcutsOverlay } from "./keyboard/ShortcutsOverlay";

/** Every nav-item key this shell routes to. A key here without a nav entry is unreachable; a nav entry without a key here is a dead click. */
const ROUTABLE_SCREENS = {
  dashboard: DashboardScreen,
  "sales-hub": SalesHubScreen,
  "purchases-hub": PurchasesHubScreen,
  "inventory-hub": InventoryHubScreen,
  "accounting-hub": AccountingHubScreen,
  "treasury-hub": TreasuryHubScreen,
  "crm-hub": CrmHubScreen,
  "assets-hub": AssetsHubScreen,
  "manufacturing-hub": ManufacturingHubScreen,
  "production-dashboard": ProductionDashboardScreen,
  status: SystemStatusScreen,
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
  "work-orders": WorkOrdersScreen,
  boms: BomsScreen,
  "custom-manufacturing": ConfigInstancesScreen,
  "configurable-products": ConfigurableProductsScreen,
  "stock-balance": StockBalanceScreen,
  "stock-transfers": StockTransfersScreen,
  "stock-adjustments": StockAdjustmentsScreen,
  "physical-counts": PhysicalCountsScreen,
  "product-templates": ProductTemplatesScreen,
  "item-specifications": ItemSpecificationsScreen,
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
  "settings-api-keys": ApiKeysPage,
  "settings-webhooks": WebhooksPage,
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
  "leave-requests": LeaveRequestsScreen,
  "leave-policies": LeavePoliciesScreen,
  "leave-balances": LeaveBalancesScreen,
  "leave-accrual-batches": LeaveAccrualBatchesScreen,
} as const;

type RoutableKey = keyof typeof ROUTABLE_SCREENS;

/** Where ⌘N goes when the screen on display has no create flow of its own. */
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

function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join(".");
}

export function App() {
  const { session, setSession } = useApi();
  const { t } = useAppTranslation();
  const [showWizard, setShowWizard] = useState(false);
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("dashboard");
  const [editingRole, setEditingRole] = useState<RoleDTO | null>(null); // null = creating new
  const [pendingIntent, setPendingIntent] = useState<ScreenIntent | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // How many mounted screens accept a "create" intent. Only one routable
  // screen is mounted at a time, so > 0 means "this screen can create".
  const [intentTargets, setIntentTargets] = useState(0);

  const navigate = useCallback((screen: ScreenKey, intent?: ScreenIntent) => {
    setActiveScreen(screen);
    setPendingIntent(intent ?? null);
  }, []);
  const clearIntent = useCallback(() => setPendingIntent(null), []);
  const registerIntentTarget = useCallback(() => {
    setIntentTargets((n) => n + 1);
    return () => setIntentTargets((n) => n - 1);
  }, []);
  const navigation = useMemo(
    () => ({ navigate, intent: pendingIntent, clearIntent, registerIntentTarget }),
    [navigate, pendingIntent, clearIntent, registerIntentTarget],
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
  const notificationsBell = useNotificationsBell();
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

  const groups: NavGroup[] = useMemo(
    () =>
      buildNavGroups(t).map((group) => ({
        ...group,
        items: group.items.map((item) => {
          const key = item.key;
          // الموافقات carries a global pending-count badge (docs/catalog/09
          // §الموافقات inbox nav item) — a real count off /workflow/requests/
          // pending-count, not a placeholder.
          const tag = key === "approvals" && pendingApprovalCount > 0 ? { label: String(pendingApprovalCount), tone: "pattern" as const } : item.tag;
          if (isRoutable(key) || key === "users" || key === "roles") {
            return { ...item, tag, onClick: () => navigate(key as ScreenKey) };
          }
          return { ...item, tag };
        }),
      })),
    [navigate, pendingApprovalCount, t],
  );

  const routedCommandItems: CommandItem[] = useMemo(() => {
    const targets: Record<string, () => void> = {
      "cmd-invoice": () => navigate("sales-invoices", "create"),
      "cmd-receipt": () => navigate("treasury-vouchers", "create"),
      "cmd-coa": () => navigate("coa"),
      "cmd-journals": () => navigate("journals"),
      "cmd-shortcuts": () => setShortcutsOpen(true),
    };
    return buildCommandItems(t).map((item) => {
      const onSelect = targets[item.id];
      return onSelect ? { ...item, onSelect } : item;
    });
  }, [navigate, t]);

  const userMenuItems: UserMenuItem[] = useMemo(
    () => [
      { key: "users", label: t("shell.menu.users"), onSelect: () => navigate("users") },
      { key: "roles", label: t("shell.menu.roles"), onSelect: () => navigate("roles") },
      { key: "settings", label: t("shell.menu.settings"), onSelect: () => navigate("settings-general") },
      {
        key: "sign-out",
        label: t("shell.menu.signOut"),
        tone: "danger",
        onSelect: () => {
          setActiveScreen("dashboard");
          setSession(null);
        },
      },
    ],
    [navigate, setSession, t],
  );

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

  const { moduleJumps } = useGlobalShortcuts({
    navGroups: groups,
    topNavItem: routedTopNavItem,
    onCreate: createOnCurrentScreen,
    onShowHelp: () => setShortcutsOpen(true),
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
    };
    try {
      const value = editingId
        ? await updateUser.mutateAsync({ id: editingId, body: fields })
        : await createUser.mutateAsync({ ...fields, password: fields.password ?? "" });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذر حفظ المستخدم" };
    }
  }

  async function handleSaveRole(cmd: { code: string; name: string; description: string; permissions: string[] }) {
    try {
      const value = editingRole ? await updateRole.mutateAsync({ id: editingRole.id, body: cmd }) : await createRole.mutateAsync(cmd);
      setActiveScreen("roles");
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذر حفظ الدور" };
    }
  }

  async function handleRemoveRole(roleId: string) {
    try {
      await deleteRoleMutation.mutateAsync(roleId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذر حذف الدور" };
    }
  }

  async function handleToggleUserStatus(userId: string, status: "active" | "inactive") {
    try {
      const value = await setUserStatus.mutateAsync({ id: userId, status });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذر تحديث حالة المستخدم" };
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
    initials: initialsFor(session.fullName),
  };
  const scopeLabel = scopeLabelFor(session.branchScope, branches, t);

  return (
    <NavigationProvider value={navigation}>
    <AppShell
      activeNavKey={activeScreen === "role-editor" ? "roles" : activeScreen}
      topNavItem={routedTopNavItem}
      navGroups={groups}
      user={shellUser}
      commandItems={routedCommandItems}
      tenantName={session.tenantName}
      scopeLabel={scopeLabel}
      userMenuItems={userMenuItems}
      notificationCount={notificationsBell.unreadCount}
      onToggleNotifications={notificationsBell.onToggle}
      notificationsPanel={notificationsBell.panel}
      branchOptions={branchOptions}
      warehouseOptions={warehouseOptions}
      selectedBranchId={selection.branchId}
      selectedWarehouseId={selection.warehouseId}
      onSelectBranch={setBranch}
      onSelectWarehouse={setWarehouse}
    >
      {ActiveRoutableScreen ? <ActiveRoutableScreen /> : null}

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
            setActiveScreen("role-editor");
          }}
          onEdit={(role) => {
            setEditingRole(role);
            setActiveScreen("role-editor");
          }}
          onDelete={handleRemoveRole}
        />
      ) : null}

      {activeScreen === "role-editor" && entitlements ? (
        <RoleEditorPage
          role={editingRole}
          entitlements={entitlements}
          onSave={handleSaveRole}
          onCancel={() => setActiveScreen("roles")}
        />
      ) : null}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} moduleJumps={moduleJumps} />
    </AppShell>
    </NavigationProvider>
  );
}
