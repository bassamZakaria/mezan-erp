import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../hooks/useTheme";
import { Sidebar } from "./Sidebar";
import { Topbar, type TopbarScopeOption, type TopbarSystemStatus, type TopbarSupportItem } from "./Topbar";
import type { CommandItem, NavGroup, NavItem, ShellUser, UserMenuItem } from "./types";

export interface AppShellProps {
  activeNavKey?: string;
  topNavItem: NavItem;
  navGroups: NavGroup[];
  /** Groups that belong in the header's gear menu rather than the rail — settings and system. */
  utilityGroups?: NavGroup[];
  /** Items promoted out of the rail into the header as icon buttons — the approvals inbox. */
  headerNavItems?: NavItem[];
  user: ShellUser;
  commandItems?: CommandItem[];
  tenantName?: string;
  scopeLabel?: string;
  /** The header's always-visible system-status pill (R1.7), forwarded straight to `<Topbar>`. */
  systemStatus?: TopbarSystemStatus;
  /** The header's support entry point (R1.8), forwarded straight to `<Topbar>`. */
  supportItems?: readonly TopbarSupportItem[];
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
 * AppShell — the app frame: the collapsible dark-teal Sidebar rail plus a
 * Topbar carrying the always-visible command bar, wired together. Wraps the
 * routed page content passed as `children`. Its layout is direction-agnostic:
 * the active locale's `dir` on <html> mirrors it.
 */
export function AppShell({
  activeNavKey,
  topNavItem,
  navGroups,
  utilityGroups,
  headerNavItems,
  user,
  commandItems = [],
  tenantName,
  scopeLabel,
  systemStatus,
  supportItems,
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

  return (
    <div className={cn("flex min-h-screen bg-bg text-ink", className)}>
      <Sidebar
        activeKey={activeNavKey}
        topItem={topNavItem}
        groups={navGroups}
        brandName={brandName}
        brandSub={brandSub}
        tenantName={tenantName}
        scopeLabel={scopeLabel}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          commandItems={commandItems}
          systemStatus={systemStatus}
          supportItems={supportItems}
          notificationCount={notificationCount}
          onToggleNotifications={onToggleNotifications}
          notificationsPanel={notificationsPanel}
          userMenuItems={userMenuItems}
          user={user}
          theme={theme}
          onToggleTheme={toggleTheme}
          utilityGroups={utilityGroups}
          headerNavItems={headerNavItems}
          activeNavKey={activeNavKey}
          branchOptions={branchOptions}
          warehouseOptions={warehouseOptions}
          selectedBranchId={selectedBranchId}
          selectedWarehouseId={selectedWarehouseId}
          onSelectBranch={onSelectBranch}
          onSelectWarehouse={onSelectWarehouse}
        />
        <main className="flex-1 px-[30px] pb-[72px] pt-[28px]">{children}</main>
      </div>
    </div>
  );
}
