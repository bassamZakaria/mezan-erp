import { useMemo, useState } from "react";
import { AppShell } from "@mezan/ui";
import { ChartOfAccountsScreen } from "./screens/ChartOfAccountsScreen";
import { SalesInvoicesScreen } from "./screens/SalesInvoicesScreen";
import { commandItems, demoUser, navGroups, topNavItem } from "./sample-data";
import { SettingsGeneral } from "./settings/SettingsGeneral";
import { BranchesPage } from "./settings/BranchesPage";
import { WarehousesPage } from "./settings/WarehousesPage";

/** Nav-item keys this shell can actually navigate to (the rest keep their static "قريباً" tag). */
const ROUTABLE_SCREENS = {
  "sales-invoices": SalesInvoicesScreen,
  coa: ChartOfAccountsScreen,
  "settings-general": SettingsGeneral,
  "settings-branches": BranchesPage,
  "settings-warehouses": WarehousesPage,
} as const;

type ScreenKey = keyof typeof ROUTABLE_SCREENS;

function isRoutable(key: string): key is ScreenKey {
  return key in ROUTABLE_SCREENS;
}

export function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("sales-invoices");

  // Wire every routable nav item (Sales Invoices, دليل الحسابات, Settings'
  // عام/الفروع/المستودعات) to switch screens; every other item keeps
  // whatever static onClick/href sample-data.ts gave it (mostly none —
  // they're "قريباً" placeholders).
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

  const ActiveScreen = ROUTABLE_SCREENS[activeScreen];

  return (
    <AppShell
      activeNavKey={activeScreen}
      topNavItem={topNavItem}
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
