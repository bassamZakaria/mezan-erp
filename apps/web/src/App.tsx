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
import { SettingsGeneral } from "./settings/SettingsGeneral";
import { BranchesPage } from "./settings/BranchesPage";
import { WarehousesPage } from "./settings/WarehousesPage";
import { PrintTemplatesPage } from "./settings/PrintTemplatesPage";
import { LoginScreen } from "./login/LoginScreen";
import { FirstRunWizard } from "./login/FirstRunWizard";
import {
  commandItems,
  demoBranches,
  demoEmployees,
  demoEntitlements,
  demoWarehouses,
  navGroups,
  topNavItem,
} from "./sample-data";
import { useApi } from "./data/ApiContext";
import type { ShellUser } from "@mezan/ui";
import {
  useCreateRole,
  useCreateUser,
  useDeleteRole,
  useRoles,
  useSetUserStatus,
  useUpdateRole,
  useUpdateUser,
  useUsers,
} from "./data/hooks";
import { UsersPage, type UserFormDraft } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import { RoleEditorPage } from "./pages/RoleEditorPage";

/** Nav-item keys this shell can actually navigate to (the rest keep their static "قريباً" tag). */
const ROUTABLE_SCREENS = {
  dashboard: DashboardScreen,
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
  "configurable-products": ConfigurableProductsScreen,
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
  "settings-general": SettingsGeneral,
  "settings-branches": BranchesPage,
  "settings-warehouses": WarehousesPage,
  "settings-print": PrintTemplatesPage,
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
  const { session } = useApi();
  const [mode, setMode] = useState<AppMode>("login");
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("dashboard");
  const [editingRole, setEditingRole] = useState<RoleDTO | null>(null); // null = creating new

  const rolesQuery = useRoles();
  const usersQuery = useUsers();
  const roles = rolesQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const setUserStatus = useSetUserStatus();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRoleMutation = useDeleteRole();

  const allBranchIds = demoBranches.map((b) => b.id);
  const allWarehouseIds = demoWarehouses.map((w) => w.id);

  const usersByRoleId = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) {
      if (u.roleId) map.set(u.roleId, (map.get(u.roleId) ?? 0) + 1);
    }
    return map;
  }, [users]);

  // Wire every routable nav item (لوحة التحكم, Sales Invoices, دليل
  // الحسابات, الأصناف, Settings' عام/الفروع/المستودعات, المستخدمون,
  // الأدوار) to switch screens; every other item keeps whatever static
  // onClick/href sample-data.ts gave it — mostly none, they're "قريباً"
  // placeholders.
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

  return (
    <AppShell
      activeNavKey={activeScreen === "role-editor" ? "roles" : activeScreen}
      topNavItem={routedTopNavItem}
      navGroups={groups}
      user={shellUser}
      commandItems={commandItems}
      tenantName={session.tenantName}
      scopeLabel="الفرع الرئيسي"
      notificationCount={3}
    >
      {ActiveRoutableScreen ? <ActiveRoutableScreen /> : null}

      {activeScreen === "users" ? (
        <UsersPage
          users={users}
          roles={roles}
          branches={demoBranches}
          warehouses={demoWarehouses}
          employees={demoEmployees}
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

      {activeScreen === "role-editor" ? (
        <RoleEditorPage
          role={editingRole}
          entitlements={demoEntitlements}
          onSave={handleSaveRole}
          onCancel={() => setActiveScreen("roles")}
        />
      ) : null}
    </AppShell>
  );
}
