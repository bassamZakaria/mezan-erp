import { useMemo, useState } from "react";
import { AppShell } from "@mezan/ui";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { ChartOfAccountsScreen } from "./screens/ChartOfAccountsScreen";
import { ItemsScreen } from "./screens/ItemsScreen";
import { SalesInvoicesScreen } from "./screens/SalesInvoicesScreen";
import { CustomersScreen } from "./screens/CustomersScreen";
import { SuppliersScreen } from "./screens/SuppliersScreen";
import { commandItems, demoUser, navGroups, topNavItem } from "./sample-data";
import { SettingsGeneral } from "./settings/SettingsGeneral";
import { BranchesPage } from "./settings/BranchesPage";
import { WarehousesPage } from "./settings/WarehousesPage";
import { LoginScreen } from "./login/LoginScreen";
import { FirstRunWizard } from "./login/FirstRunWizard";

/** Nav-item keys this shell can actually navigate to (the rest keep their static "قريباً" tag). */
const ROUTABLE_SCREENS = {
  dashboard: DashboardScreen,
  "sales-invoices": SalesInvoicesScreen,
  customers: CustomersScreen,
  vendors: SuppliersScreen,
  coa: ChartOfAccountsScreen,
  items: ItemsScreen,
  "settings-general": SettingsGeneral,
  "settings-branches": BranchesPage,
  "settings-warehouses": WarehousesPage,
} as const;

type ScreenKey = keyof typeof ROUTABLE_SCREENS;

function isRoutable(key: string): key is ScreenKey {
  return key in ROUTABLE_SCREENS;
}

/** Pre-AppShell app state: desktop login gate, an optional first-run wizard reachable from it, then the routed shell. */
type AppMode = "login" | "wizard" | "app";

export function App() {
  const [mode, setMode] = useState<AppMode>("login");
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("dashboard");

  // Wire every routable nav item (لوحة التحكم, Sales Invoices, دليل
  // الحسابات, الأصناف, Settings' عام/الفروع/المستودعات) to switch screens;
  // every other item keeps whatever static onClick/href sample-data.ts gave
  // it — mostly none, they're "قريباً" placeholders.
  const groups = useMemo(
    () =>
      navGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => {
          const key = item.key;
          return isRoutable(key) ? { ...item, onClick: () => setActiveScreen(key) } : item;
        }),
      })),
    [],
  );

  const routedTopNavItem = useMemo(() => {
    const key = topNavItem.key;
    return isRoutable(key) ? { ...topNavItem, onClick: () => setActiveScreen(key) } : topNavItem;
  }, []);

  if (mode === "login") {
    return <LoginScreen onLogin={() => setMode("app")} onStartWizard={() => setMode("wizard")} />;
  }

  if (mode === "wizard") {
    return <FirstRunWizard onFinish={() => setMode("app")} onCancel={() => setMode("login")} />;
  }

  const ActiveScreen = ROUTABLE_SCREENS[activeScreen];

  return (
    <AppShell
      activeNavKey={activeScreen}
      topNavItem={routedTopNavItem}
      navGroups={groups}
      user={demoUser}
      commandItems={commandItems}
      scopeLabel="الفرع الرئيسي"
      notificationCount={3}
    >
      <ActiveScreen />
    </AppShell>
  );
}
