import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../hooks/useTheme";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { Topbar, type TopbarScopeOption } from "./Topbar";
import type { CommandItem, NavGroup, NavItem, ShellUser, UserMenuItem } from "./types";

export interface AppShellProps {
  activeNavKey?: string;
  topNavItem: NavItem;
  navGroups: NavGroup[];
  user: ShellUser;
  commandItems?: CommandItem[];
  tenantName?: string;
  scopeLabel?: string;
  notificationCount?: number;
  onToggleNotifications?: () => void;
  notificationsPanel?: ReactNode;
  userMenuItems?: UserMenuItem[];
  brandName?: string;
  brandSub?: string;
  children: ReactNode;
  className?: string;
  /** Working-branch / warehouse selectors, forwarded straight to `<Topbar>` — see its own props doc. */
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;
}

/**
 * AppShell — the RTL app frame: Sidebar + Topbar + a Ctrl K command palette,
 * wired together. Wraps the routed page content passed as `children`.
 */
export function AppShell({
  activeNavKey,
  topNavItem,
  navGroups,
  user,
  commandItems = [],
  tenantName,
  scopeLabel,
  notificationCount,
  onToggleNotifications,
  notificationsPanel,
  userMenuItems,
  brandName,
  brandSub,
  children,
  className,
  branchOptions,
  warehouseOptions,
  selectedBranchId,
  selectedWarehouseId,
  onSelectBranch,
  onSelectWarehouse,
}: AppShellProps) {
  const { theme, toggleTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={cn("flex min-h-screen bg-bg text-ink", className)}>
      <Sidebar activeKey={activeNavKey} topItem={topNavItem} groups={navGroups} user={user} brandName={brandName} brandSub={brandSub} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenCommandPalette={() => setPaletteOpen(true)}
          tenantName={tenantName}
          scopeLabel={scopeLabel}
          theme={theme}
          onToggleTheme={toggleTheme}
          notificationCount={notificationCount}
          onToggleNotifications={onToggleNotifications}
          notificationsPanel={notificationsPanel}
          userMenuItems={userMenuItems}
          user={user}
          branchOptions={branchOptions}
          warehouseOptions={warehouseOptions}
          selectedBranchId={selectedBranchId}
          selectedWarehouseId={selectedWarehouseId}
          onSelectBranch={onSelectBranch}
          onSelectWarehouse={onSelectWarehouse}
        />
        <main className="flex-1 px-[30px] pb-[72px] pt-[28px]">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={commandItems} />
    </div>
  );
}
