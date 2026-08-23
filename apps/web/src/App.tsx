import { useMemo, useState } from "react";
import { AppShell, type NavGroup } from "@mezan/ui";
import { ALL_SCOPE } from "@mezan/domain";
import type { RoleDTO, ScopeSelectionDTO } from "@mezan/contracts";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { ChartOfAccountsScreen } from "./screens/ChartOfAccountsScreen";
import { ItemsScreen } from "./screens/ItemsScreen";
import { BomsScreen } from "./screens/BomsScreen";
import { WorkOrdersScreen } from "./screens/WorkOrdersScreen";
import { ConfigurableProductsScreen } from "./screens/ConfigurableProductsScreen";
import { ItemSpecificationsScreen } from "./screens/ItemSpecificationsScreen";
import { ProductTemplatesScreen } from "./screens/ProductTemplatesScreen";
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
  InventorySlowMovingReportScreen,
  InventoryDriftReportScreen,
} from "./screens/reports/InventoryReportsScreens";
import { AgingCustomersReportScreen, AgingSuppliersReportScreen } from "./screens/reports/AgingReportsScreens";
import { InstallmentsOverviewReportScreen, InstallmentsOverdueReportScreen } from "./screens/reports/InstallmentsReportsScreens";
import { LeadsScreen } from "./screens/LeadsScreen";
import { OpportunitiesScreen } from "./screens/OpportunitiesScreen";
import { PipelineScreen } from "./screens/PipelineScreen";
import { PipelineStagesScreen } from "./screens/PipelineStagesScreen";
import { ActivitiesScreen } from "./screens/ActivitiesScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { AssetCategoriesScreen } from "./screens/AssetCategoriesScreen";
import { AssetRegisterScreen } from "./screens/AssetRegisterScreen";
import { DepreciationRunsScreen } from "./screens/DepreciationRunsScreen";
import { VanTripsScreen } from "./screens/VanTripsScreen";
import { StockAdjustmentsScreen } from "./screens/StockAdjustmentsScreen";
import { StockTransfersScreen } from "./screens/StockTransfersScreen";
import { PhysicalCountsScreen } from "./screens/PhysicalCountsScreen";
import { LabelPrintingScreen } from "./screens/LabelPrintingScreen";
import { StockBalanceScreen } from "./screens/StockBalanceScreen";
import { SettingsGeneral } from "./settings/SettingsGeneral";
import { BranchesPage } from "./settings/BranchesPage";
import { WarehousesPage } from "./settings/WarehousesPage";
import { PrintTemplatesPage } from "./settings/PrintTemplatesPage";
import { SequencesPage } from "./settings/SequencesPage";
import { DataMigrationPage } from "./settings/DataMigrationPage";
import { BarcodeConfigPage } from "./settings/BarcodeConfigPage";
import { ApprovalsScreen } from "./screens/ApprovalsScreen";
import { NotificationRulesScreen } from "./screens/NotificationRulesScreen";
import { useShellNotifications } from "./data/notification-hooks";
import { WorkflowConfigPage } from "./settings/WorkflowConfigPage";
import { ProfilePage } from "./settings/ProfilePage";
import { ApiKeysPage } from "./settings/ApiKeysPage";
import { WebhooksPage } from "./settings/WebhooksPage";
import { AuditLogScreen } from "./screens/AuditLogScreen";
import { LoginScreen } from "./login/LoginScreen";
import { FirstRunWizard } from "./login/FirstRunWizard";
import { NavigationProvider } from "./navigation";
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
import { navGroups, topNavItem } from "./navigation/registry";
import { useApi } from "./data/ApiContext";
import type { CommandItem, ShellUser } from "@mezan/ui";
import {
  useBranches,
  useCreateRole,
  useCreateUser,
  useDeleteRole,
  useEntitlements,
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


/**
 * The user form's "الموظف المرتبط" picker needs an employees master list, but
 * there is no employees/HR endpoint anywhere in `@mezan/api` — `employeeId`
 * is stored as a free-form string reference (see `users-routes.ts`,
 * `field-sales-routes.ts`) with no backing repository to list from. An empty
 * list is the honest state until an employees API exists, rather than
 * fabricating names.
 */
const NO_EMPLOYEES: { id: string; name: string; position: string }[] = [];

/** Nav-item keys this shell can actually navigate to (the rest keep their static "قريباً" tag). */
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
  specifications: ItemSpecificationsScreen,
  "product-templates": ProductTemplatesScreen,
  "stock-balance": StockBalanceScreen,
  "stock-transfers": StockTransfersScreen,
  "stock-adjustments": StockAdjustmentsScreen,
  "physical-counts": PhysicalCountsScreen,
  "label-printing": LabelPrintingScreen,
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
  "report-inventory-slow-moving": InventorySlowMovingReportScreen,
  "report-inventory-drift": InventoryDriftReportScreen,
  "report-aging-customers": AgingCustomersReportScreen,
  "report-aging-suppliers": AgingSuppliersReportScreen,
  "report-installments-overview": InstallmentsOverviewReportScreen,
  "report-installments-overdue": InstallmentsOverdueReportScreen,
  "financial-reports": FinancialReportsScreen,
  "settings-general": SettingsGeneral,
  "settings-branches": BranchesPage,
  "settings-warehouses": WarehousesPage,
  "settings-print": PrintTemplatesPage,
  "settings-sequences": SequencesPage,
  "settings-data-migration": DataMigrationPage,
  "settings-barcode": BarcodeConfigPage,
  "settings-workflow": WorkflowConfigPage,
  approvals: ApprovalsScreen,
  "notification-rules": NotificationRulesScreen,
  "settings-profile": ProfilePage,
  "settings-api-keys": ApiKeysPage,
  "settings-webhooks": WebhooksPage,
  audit: AuditLogScreen,
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
} as const;

type RoutableKey = keyof typeof ROUTABLE_SCREENS;
/**
 * المستخدمون / الأدوار aren't stateless ROUTABLE_SCREENS entries — the role
 * editor needs the in-flight `editingRole` (create vs. edit), and all three
 * share the same real `/roles` + `/users` data, so they're handled as their
 * own small state machine alongside the routable-screen lookup instead.
 */
type UsersRolesView = "users" | "roles" | "role-editor";
type ScreenKey = RoutableKey | UsersRolesView;

function isRoutable(key: string): key is RoutableKey {
  return key in ROUTABLE_SCREENS;
}

function scopeIdsToSelection(ids: string[], allIds: string[]): ScopeSelectionDTO {
  return ids.length === allIds.length ? ALL_SCOPE : ids;
}

/** Pre-AppShell app state: desktop login gate, an optional first-run wizard reachable from it, then the routed shell. */
type AppMode = "login" | "wizard" | "app";

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
  // A persisted session (data/session.ts) must land on the app, not the login
  // gate — otherwise a page refresh silently signs the user back out.
  const [mode, setMode] = useState<AppMode>(() => (session ? "app" : "login"));
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("dashboard");
  const [editingRole, setEditingRole] = useState<RoleDTO | null>(null); // null = creating new

  const { branchOptions, warehouseOptions, selection, setBranch, setWarehouse } = useScopeSelector();
  const notificationFeed = useShellNotifications();
  const entitlementsQuery = useEntitlements();
  const entitlements = entitlementsQuery.data ?? null;
  const rolesQuery = useRoles();
  const usersQuery = useUsers();
  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();
  const roles = rolesQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const branches = branchesQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const setUserStatus = useSetUserStatus();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRoleMutation = useDeleteRole();

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
      navGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => {
          const key = item.key;
          if (isRoutable(key) || key === "users" || key === "roles") {
            return { ...item, onClick: () => setActiveScreen(key as ScreenKey) };
          }
          return item;
        }),
      })),
    [],
  );

  const commandItems: CommandItem[] = useMemo(() => {
    const goto: CommandItem[] = navGroups.flatMap((group) =>
      group.items
        .filter((item) => isRoutable(item.key) || item.key === "users" || item.key === "roles")
        .map((item) => ({
          id: `goto-${item.key}`,
          label: item.label,
          group: group.label,
          onSelect: () => setActiveScreen(item.key as ScreenKey),
        })),
    );
    return [
      { id: "cmd-invoice", label: "فاتورة مبيعات جديدة", group: "إجراءات سريعة", hint: "N", onSelect: () => setActiveScreen("sales-invoices") },
      { id: "cmd-receipt", label: "سند نقدي جديد", group: "إجراءات سريعة", onSelect: () => setActiveScreen("treasury-vouchers") },
      { id: "cmd-quote", label: "عرض سعر جديد", group: "إجراءات سريعة", onSelect: () => setActiveScreen("quotes") },
      { id: "goto-dashboard", label: "لوحة التحكم", group: "الانتقال إلى", onSelect: () => setActiveScreen("dashboard") },
      ...goto,
    ];
  }, []);

  const routedTopNavItem = useMemo(() => {
    const key = topNavItem.key;
    return isRoutable(key) ? { ...topNavItem, onClick: () => setActiveScreen(key) } : topNavItem;
  }, []);

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

  function handleLogout() {
    setSession(null);
    setActiveScreen("dashboard");
    setMode("login");
  }

  if (mode === "wizard") {
    return <FirstRunWizard onFinish={() => setMode("app")} onCancel={() => setMode("login")} />;
  }

  if (mode === "login" || !session) {
    return <LoginScreen onLogin={() => setMode("app")} onStartWizard={() => setMode("wizard")} />;
  }

  const ActiveRoutableScreen = isRoutable(activeScreen) ? ROUTABLE_SCREENS[activeScreen] : null;
  const shellUser: ShellUser = {
    name: session.fullName,
    role: session.isCompanyAdmin ? "مدير الشركة" : "مستخدم",
    initials: initialsFor(session.fullName),
  };
  const scopeLabel =
    session.branchScope === "*"
      ? "كل الفروع"
      : branches
          .filter((b) => (session.branchScope as string[]).includes(b.id))
          .map((b) => b.name)
          .join("، ") || undefined;

  return (
    <AppShell
      activeNavKey={activeScreen === "role-editor" ? "roles" : activeScreen}
      topNavItem={routedTopNavItem}
      navGroups={groups}
      user={shellUser}
      commandItems={commandItems}
      tenantName={session.tenantName}
      scopeLabel={scopeLabel}
      onLogout={handleLogout}
      notifications={notificationFeed.notifications}
      unreadNotificationCount={notificationFeed.unreadCount}
      onMarkNotificationRead={notificationFeed.markRead}
      onMarkAllNotificationsRead={notificationFeed.markAllRead}
      branchOptions={branchOptions}
      warehouseOptions={warehouseOptions}
      selectedBranchId={selection.branchId}
      selectedWarehouseId={selection.warehouseId}
      onSelectBranch={setBranch}
      onSelectWarehouse={setWarehouse}
    >
      <NavigationProvider navigate={(key) => setActiveScreen(key as ScreenKey)}>
        {ActiveRoutableScreen ? <ActiveRoutableScreen /> : null}
      </NavigationProvider>

      {activeScreen === "users" ? (
        <UsersPage
          users={users}
          roles={roles}
          branches={branches}
          warehouses={warehouses}
          employees={NO_EMPLOYEES}
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
    </AppShell>
  );
}
