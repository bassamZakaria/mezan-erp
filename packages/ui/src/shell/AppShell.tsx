import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../hooks/useTheme";
import { useUiTranslation } from "../i18n";
import { AllScreensPanel } from "./AllScreensPanel";
import { BrandMark } from "./BrandMark";
import { ChromeActions } from "./ChromeActions";
import { CommandBar } from "./CommandBar";
import { ScopeSwitchers } from "./ScopeSwitcher";
import { TopbarMenu } from "./TopbarMenu";
import { WorkspaceRail } from "./WorkspaceRail";
import { WorkspaceScreensBar } from "./WorkspaceScreensBar";
import type { TopbarScopeOption } from "./Topbar";
import type { CommandItem, NavGroup, NavItem, ShellUser, UserMenuItem } from "./types";

/** The id the skip link targets; `<main>` carries it and `tabIndex={-1}` so focus lands. */
const MAIN_ID = "mz-main";

export interface AppShellProps {
  /** Opens the main dashboard — the logo and wordmark are one link to it. */
  onNavigateHome?: () => void;
  /**
   * Single destinations that are NOT workspaces — الموافقات. A workspace row
   * promises a row two; these have exactly one screen behind them, so they sit
   * in row one beside the wordmark rather than in the column, where they would
   * be a seventh "workspace" whose second row is a single chip. A `tag` renders
   * as its count badge.
   */
  directNavItems?: readonly NavItem[];
  /**
   * The workspaces as full nav groups. The COLUMN renders their names; ROW TWO
   * renders the active one's hub as a chip and each of its sections as a
   * dropdown. Without it there is nothing to navigate.
   */
  workspaceGroups?: readonly NavGroup[];
  activeWorkspaceKey?: string;
  /**
   * Opens the workspace's hub. Return `false` when that workspace has no hub
   * to open: the shell then opens «كل الشاشات» filtered to it, so a click on a
   * workspace is never a no-op.
   */
  onWorkspaceChange?: (key: string) => boolean | void;
  /** The live column at the inline end of the content, when a screen feeds one. */
  gutter?: ReactNode;
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
 * AppShell — design direction ب (`design/directions/nav-level.html`): the six
 * workspaces live in a 200px column, not in the top bar.
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ row one   logo · الموافقات ·········· ⌘K scope ع ☀ ⚙ 🔔 م │  chrome
 *   ├──────────┬────────────────────────────────────────────┤
 *   │ مساحات   │ row two  hub · [اليومي ▾] [التقارير ▾] · +N │  the active
 *   │ العمل    ├──────────────────────────────┬─────────────┤   workspace's
 *   │          │            main              │   gutter    │   own screens
 *   │          │                              │             │
 *   │ ☰ كل الشاشات                              │             │
 *   └──────────┴──────────────────────────────┴─────────────┘
 *
 * Taking the workspaces out of row one is what lets the chrome's own controls —
 * language, appearance, settings, notifications, the user menu — all stay
 * visible as themselves instead of collapsing into a «⋯» nobody opens.
 *
 * The column and row two SHARE A TOP EDGE, both starting where row one ends.
 * Row one is the only full-width band, because it is the only one that is
 * global: brand, search, scope, the user. Everything below it belongs to the
 * open workspace, so the workspace (the column) and the workspace's screens
 * (row two) are drawn as one block rather than as two stacked bands with the
 * screens on top of the thing they belong to.
 *
 * THREE navigation landmarks, each with its own Arabic name: the workspace
 * column, row one's direct links, and row two. A skip link to `<main>` is the
 * first focusable element on the page.
 *
 * ROW ONE IS NOT `overflow-hidden`: the user menu and the notifications panel
 * are anchored (`position: absolute`) rather than portaled, and clipping row
 * one would slice both off at its edge. Row TWO is clipped — that is how it
 * truncates to «+N» — so every dropdown it opens is portaled instead (see
 * `WorkspaceScreensBar`).
 */
export function AppShell({
  onNavigateHome,
  directNavItems = [],
  workspaceGroups = [],
  activeWorkspaceKey,
  onWorkspaceChange,
  gutter,
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
  /**
   * Row two follows row one — but a screen that belongs to no workspace tab
   * (الموافقات, every الإعدادات screen) leaves `activeWorkspaceKey` undefined,
   * and falling back to `workspaceGroups[0]` would silently swap row two to the
   * first workspace the moment one of those is opened. The last workspace the
   * user was actually in stays on the bar instead; only the CHIP loses its
   * `aria-current`, which is the honest signal.
   */
  const [lastWorkspaceKey, setLastWorkspaceKey] = useState<string | undefined>(activeWorkspaceKey);
  useEffect(() => {
    if (activeWorkspaceKey) setLastWorkspaceKey(activeWorkspaceKey);
  }, [activeWorkspaceKey]);
  /**
   * A workspace with no hub of its own navigates nowhere when it is clicked,
   * so `activeWorkspaceKey` never moves to it — without this the column would
   * refuse to open the very workspace the user just asked for.
   */
  const [clickedWorkspaceKey, setClickedWorkspaceKey] = useState<string | undefined>(undefined);
  const rowTwoKey = activeWorkspaceKey ?? clickedWorkspaceKey ?? lastWorkspaceKey;
  const activeGroup = workspaceGroups.find((group) => group.key === rowTwoKey) ?? workspaceGroups[0] ?? null;

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
      setClickedWorkspaceKey(key);
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
        <div className="flex min-h-[var(--h-topbar)] items-center gap-[10px] py-[6px] ps-[14px] pe-[20px]">
          {/* The mark is the app's own balance-beam glyph (`BrandMark`) — there
              is no logo file in the repo — and the whole lockup is one link
              home, which is the convention every user already expects. */}
          <button
            type="button"
            onClick={onNavigateHome}
            aria-label={t("shell.bar.home")}
            className="flex min-h-[var(--h-btn)] flex-none items-center gap-[8px] rounded-md px-[10px] text-chrome-ink transition-colors hover:bg-chrome-hover"
          >
            <BrandMark className="h-[24px] w-[24px] flex-none text-accent" />
            <span className="mz-disp text-lg font-bold max-[900px]:hidden">{t("shell.brand.name")}</span>
          </button>

          {/* Row one holds the brand and the chrome controls only. The direct
              links (الموافقات) moved into the workspace column, so every
              navigation target lives in one place. This spacer is what lets the
              controls sit at the inline end. */}
          <div className="min-w-0 flex-1" />

          <div className="flex flex-none items-center gap-[8px]">
            <CommandBar
              items={commandItems}
              placeholder={t("shell.command.placeholder")}
              // `CommandBar`'s own box is 38px (the shared control scale); the
              // bar's minimum target is 44 (`--h-btn`), so it is raised here
              // rather than in the primitive every screen shares.
              className="w-[250px] [&>div]:min-h-[var(--h-btn)] max-[1280px]:w-[180px] max-[980px]:hidden"
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
                className="relative flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center rounded-md border border-transparent bg-transparent text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink"
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

      </header>

      <div className="flex min-h-0 flex-1 items-stretch">
        <WorkspaceRail
          groups={workspaceGroups}
          activeKey={activeWorkspaceKey}
          onChange={handleWorkspaceChange}
          pinnedItems={directNavItems}
          activeItemKey={activeNavKey}
          ariaLabel={t("shell.bar.workspacesLandmark")}
          allScreensLabel={t("shell.rail.all")}
          onOpenAllScreens={() => openAllScreens(null)}
          // The column and row two start on the same line and need a rule
          // under the chrome, but the column is a dark panel: a light
          // `--border` there reads as a bright scar across the teal.
          className="border-t border-chrome-border"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Row two no longer spans the full width — it starts where the
              column does, because it lists the screens OF the workspace that
              column has selected. It sticks under row one rather than with it:
              row one is `top-0`, and row one's height is exactly `--h-btn`
              (its tallest child sets it, and it carries no block padding), so
              the offset stays correct if that control scale ever changes. */}
          <WorkspaceScreensBar
            className="sticky top-[var(--h-topbar)] z-30"
            group={activeGroup}
            activeKey={activeNavKey}
            ariaLabel={
              activeGroup ? `${t("shell.bar.workspaceScreens")} — ${activeGroup.label}` : t("shell.bar.workspaceScreens")
            }
            overflowLabel={t("shell.bar.overflow")}
          />

          <div className="flex min-h-0 flex-1 items-stretch">
            <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 px-[24px] pb-[64px] pt-[20px]">
              {children}
            </main>

            {gutter}
          </div>
        </div>
      </div>

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
