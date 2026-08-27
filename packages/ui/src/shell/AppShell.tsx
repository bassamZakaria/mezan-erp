import { useCallback, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../hooks/useTheme";
import { useTranslation, useUiTranslation } from "../i18n";
import { AllScreensPanel } from "./AllScreensPanel";
import { ChromeActions } from "./ChromeActions";
import { CommandBar } from "./CommandBar";
import { ScopeSwitchers } from "./ScopeSwitcher";
import { TopbarMenu } from "./TopbarMenu";
import { WorkspaceScreensBar } from "./WorkspaceScreensBar";
import { WorkspaceTabs } from "./WorkspaceTabs";
import type { TopbarScopeOption } from "./Topbar";
import type { CommandItem, NavGroup, NavItem, ShellUser, UserMenuItem } from "./types";

/** The id the skip link targets; `<main>` carries it and `tabIndex={-1}` so focus lands. */
const MAIN_ID = "mz-main";

export interface AppShellProps {
  /** The workspaces, as labelled tabs in row one. */
  workspaces?: readonly NavItem[];
  /**
   * The same workspaces as full nav groups — what ROW TWO renders: the active
   * one's hub and first-section screens as chips, its remaining sections as
   * dropdowns. Without it row two carries only «كل الشاشات».
   */
  workspaceGroups?: readonly NavGroup[];
  activeWorkspaceKey?: string;
  /**
   * Opens the workspace's hub. Return `false` when that workspace has no hub
   * to open: the shell then opens «كل الشاشات» filtered to it, so a tab click
   * is never a no-op.
   */
  onWorkspaceChange?: (key: string) => boolean | void;
  /**
   * Every destination, workspace-grouped — what «كل الشاشات» browses. Supply
   * it and the button opens `AllScreensPanel`; leave it empty and the button
   * falls back to `onOpenAllScreens`.
   */
  allScreensGroups?: readonly NavGroup[];
  /** Only consulted when `allScreensGroups` is empty. */
  onOpenAllScreens?: () => void;
  /** Settings and system, behind row one's gear. Omit to drop the gear. */
  utilityGroups?: readonly NavGroup[];
  /** Marks the matching row-two chip (and utility row) `aria-current="page"`. */
  activeNavKey?: string;

  user: ShellUser;
  commandItems?: CommandItem[];
  notificationCount?: number;
  onToggleNotifications?: () => void;
  notificationsPanel?: ReactNode;
  userMenuItems?: UserMenuItem[];

  /** Working-branch / warehouse selectors, rendered at the inline end of row one. */
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;

  children: ReactNode;
  className?: string;
}

/**
 * AppShell — a two-row top bar and no side rail.
 *
 * Row one: the wordmark, the workspaces as labelled tabs, the command bar, the
 * branch/warehouse scope, the language switcher, the appearance toggle, the
 * settings gear, notifications and the user menu. Row two: the ACTIVE
 * workspace's own screens — its hub and first section as chips, its later
 * sections as dropdowns — then «كل الشاشات». Row two changes when row one does,
 * which is what makes the ~118 destinations browsable rather than recallable.
 *
 * Both rows are their own `<nav>` landmark with its own Arabic name, and a skip
 * link to `<main>` is the first focusable element on the page.
 *
 * ROW ONE IS NOT `overflow-hidden`. Only the tab strip inside it is: the user
 * menu and the notifications panel are anchored (`position: absolute`) rather
 * than portaled, and clipping row one would slice both off at its edge. Row
 * TWO is clipped — that is how it truncates to «+N» — so every dropdown it
 * opens is portaled instead (see `WorkspaceScreensBar`).
 */
export function AppShell({
  workspaces = [],
  workspaceGroups = [],
  activeWorkspaceKey,
  onWorkspaceChange,
  allScreensGroups = [],
  onOpenAllScreens,
  utilityGroups = [],
  activeNavKey,
  user,
  commandItems = [],
  notificationCount = 0,
  onToggleNotifications,
  notificationsPanel,
  userMenuItems = [],
  branchOptions,
  warehouseOptions,
  selectedBranchId,
  selectedWarehouseId,
  onSelectBranch,
  onSelectWarehouse,
  children,
  className,
}: AppShellProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useUiTranslation();
  const { direction } = useTranslation();
  const rtl = direction === "rtl";

  const activeGroup = workspaceGroups.find((group) => group.key === activeWorkspaceKey) ?? workspaceGroups[0] ?? null;

  const canBrowse = allScreensGroups.length > 0;
  const [allScreensOpen, setAllScreensOpen] = useState(false);
  /** Which workspace «كل الشاشات» opens filtered to; null is the whole tree. */
  const [allScreensWorkspace, setAllScreensWorkspace] = useState<string | null>(null);

  const openAllScreens = useCallback(
    (workspaceKey: string | null) => {
      if (!canBrowse) {
        onOpenAllScreens?.();
        return;
      }
      setAllScreensWorkspace(workspaceKey);
      setAllScreensOpen(true);
    },
    [canBrowse, onOpenAllScreens],
  );

  /**
   * A workspace tab opens that workspace's hub. When the caller reports it has
   * no hub, the tab falls back to the browse panel filtered to that workspace:
   * a tab that lands nowhere is what sent people hunting through the palette.
   */
  const handleWorkspaceChange = useCallback(
    (key: string) => {
      const opened = onWorkspaceChange?.(key);
      if (opened === false) openAllScreens(key);
    },
    [onWorkspaceChange, openAllScreens],
  );

  return (
    <div className={cn("flex min-h-screen flex-col bg-bg text-ink", className)}>
      {/*
        Parked above the viewport rather than built out of `sr-only` +
        `focus:not-sr-only`: that pair resets `position` to static on focus, so
        the link would drop into the flow and shove the whole bar down as soon
        as a keyboard user reached it. Fixed in both states, it only slides.
      */}
      <a
        href={`#${MAIN_ID}`}
        className="fixed start-[8px] top-[-200px] z-50 inline-flex min-h-[var(--h-btn)] items-center whitespace-nowrap rounded-md border border-border-strong bg-surface px-[16px] text-sm font-semibold text-ink focus:top-[8px]"
      >
        {t("shell.bar.skip")}
      </a>

      <header className="sticky top-0 z-40 flex-none bg-chrome text-chrome-ink shadow-chrome">
        <div className="flex items-center gap-[10px] ps-[6px] pe-[12px]">
          <span className="mz-disp flex-none px-[12px] text-lg font-bold max-[900px]:hidden">{t("shell.brand.name")}</span>

          {/* The one clipped region of row one: the tab strip yields first when
              the viewport narrows, so the controls at the inline end stay put. */}
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <WorkspaceTabs
              items={workspaces}
              activeKey={activeWorkspaceKey}
              onChange={handleWorkspaceChange}
              ariaLabel={t("shell.bar.workspaces")}
              direction={rtl ? "rtl" : "ltr"}
            />
          </div>

          <div className="flex flex-none items-center gap-[8px]">
            <CommandBar
              items={commandItems}
              placeholder={t("shell.command.placeholder")}
              className="w-[230px] max-[1400px]:w-[160px] max-[1100px]:hidden"
            />

            <ScopeSwitchers
              orientation="header"
              branchAriaLabel={t("shell.scope.branch")}
              warehouseAriaLabel={t("shell.scope.warehouse")}
              branchOptions={branchOptions}
              warehouseOptions={warehouseOptions}
              selectedBranchId={selectedBranchId}
              selectedWarehouseId={selectedWarehouseId}
              onSelectBranch={onSelectBranch}
              onSelectWarehouse={onSelectWarehouse}
              allBranchesLabel={t("shell.scope.allBranches")}
              allWarehousesLabel={t("shell.scope.allWarehouses")}
            />

            {/* The language switcher, the appearance toggle and the settings
                gear. They belonged to the retired `Topbar`; dropping it took
                them off the screen entirely. */}
            <ChromeActions
              utilityGroups={utilityGroups}
              activeNavKey={activeNavKey}
              theme={theme}
              onToggleTheme={toggleTheme}
            />

            <div className="relative flex-none">
              <button
                type="button"
                onClick={onToggleNotifications}
                aria-label={
                  notificationCount > 0 ? t("shell.notifications.withCount", { count: notificationCount }) : t("shell.notifications")
                }
                className="relative flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center rounded-md border border-chrome-border bg-chrome-hover text-chrome-ink-muted transition-colors hover:bg-chrome-active hover:text-chrome-ink"
              >
                <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
                  <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M8 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                {/* Never colour alone: the count is in the accessible name above. */}
                {notificationCount > 0 ? (
                  <span aria-hidden className="absolute top-[8px] end-[8px] h-[7px] w-[7px] rounded-full border-2 border-chrome bg-danger" />
                ) : null}
              </button>
              {notificationsPanel}
            </div>

            <TopbarMenu
              label={user.name}
              panelClassName="w-[232px]"
              trigger={(triggerProps) => (
                <button
                  {...triggerProps}
                  type="button"
                  className="flex min-h-[var(--h-btn)] flex-none items-center gap-[9px] rounded-pill border border-chrome-border bg-chrome-hover pe-[12px] ps-[6px] transition-colors hover:border-chrome-accent"
                >
                  <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-accent font-display text-[11px] font-extrabold text-accent-ink">
                    {user.initials}
                  </span>
                  <span className="text-start max-[1280px]:hidden">
                    <span className="block text-xs font-bold leading-[1.2] text-chrome-ink">{user.name}</span>
                    <span className="mz-lat block text-2xs text-chrome-ink-muted">{user.role}</span>
                  </span>
                </button>
              )}
            >
              {(close) => (
                <>
                  <div className="border-b border-border px-[14px] py-[11px]">
                    <div className="text-sm font-bold text-ink">{user.name}</div>
                    <div className="mz-lat text-xs text-ink-faint">{user.role}</div>
                  </div>
                  <ul className="py-[4px]">
                    {userMenuItems.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            item.onSelect();
                            close();
                          }}
                          className={cn(
                            "flex min-h-[var(--h-btn)] w-full items-center px-[14px] text-start text-sm transition-colors hover:bg-surface-2",
                            item.tone === "danger" ? "text-danger-ink" : "text-ink",
                          )}
                        >
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </TopbarMenu>
          </div>
        </div>

        <WorkspaceScreensBar
          group={activeGroup}
          activeKey={activeNavKey}
          onOpenAllScreens={() => openAllScreens(null)}
          ariaLabel={
            activeGroup ? `${t("shell.bar.workspaceScreens")} — ${activeGroup.label}` : t("shell.bar.workspaceScreens")
          }
          allScreensLabel={t("shell.rail.all")}
          overflowLabel={t("shell.bar.overflow")}
        />
      </header>

      <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 px-[24px] pb-[64px] pt-[20px]">
        <div className="ms-auto me-auto w-full max-w-[1440px]">{children}</div>
      </main>

      <AllScreensPanel
        open={allScreensOpen}
        onClose={() => setAllScreensOpen(false)}
        groups={allScreensGroups}
        activeKey={activeNavKey}
        workspaceKey={allScreensWorkspace}
      />
    </div>
  );
}
