import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../hooks/useTheme";
import { useUiTranslation } from "../i18n";
import { AllScreensPanel } from "./AllScreensPanel";
import { BrandMark } from "./BrandMark";
import { RailFooter } from "./RailFooter";
import { WorkspaceRail } from "./WorkspaceRail";
import { WorkspaceScreensBar } from "./WorkspaceScreensBar";
import type { TopbarScopeOption } from "./ScopeSwitcher";
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
  /** Opens the shortcuts sheet from the chrome. */
  onShowHelp?: () => void;
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
  onShowHelp,
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
  /**
   * NO BAR when the open screen belongs to no workspace — الموافقات, the
   * dashboard. The bar's whole claim is "these are the screens of the
   * workspace you are in", and on those screens the user is in none: showing
   * the last one's chips offers a row of destinations that have nothing to do
   * with what is on the page, and marks none of them current. An honest empty
   * is better than a confident wrong one.
   *
   * `clickedWorkspaceKey` still counts: a workspace with no hub navigates
   * nowhere, and its bar is the only thing that opens after the click.
   */
  const showScreensBar = (activeWorkspaceKey ?? clickedWorkspaceKey) !== undefined && activeGroup !== null;

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


      <div className="flex min-h-0 flex-1 items-stretch">
        <WorkspaceRail
          brand={
            /* The mark is the app's own balance-beam glyph (`BrandMark`) and the
               whole lockup is one link home. It sits INSIDE the column now — the
               column is the only chrome left, so the brand is its header rather
               than a thing floating in a band above the page. */
            <button
              type="button"
              onClick={onNavigateHome}
              aria-label={t("shell.bar.home")}
              className="flex min-h-[var(--h-topbar)] flex-none items-center gap-[8px] px-[14px] text-chrome-ink transition-colors hover:bg-chrome-hover focus-visible:outline-chrome-accent"
            >
              <BrandMark className="h-[24px] w-[24px] flex-none text-accent" />
              <span className="mz-disp text-lg font-bold">{t("shell.brand.name")}</span>
            </button>
          }
          footer={
            <RailFooter
              commandItems={commandItems}
              onShowHelp={onShowHelp}
              theme={theme}
              onToggleTheme={toggleTheme}
              notificationCount={notificationCount}
              onToggleNotifications={onToggleNotifications}
              notificationsPanel={notificationsPanel}
              user={user}
              userMenuItems={userMenuItems}
              branchOptions={branchOptions}
              warehouseOptions={warehouseOptions}
              selectedBranchId={selectedBranchId}
              selectedWarehouseId={selectedWarehouseId}
              onSelectBranch={onSelectBranch}
              onSelectWarehouse={onSelectWarehouse}
            />
          }
          groups={workspaceGroups}
          activeKey={activeWorkspaceKey}
          onChange={handleWorkspaceChange}
          pinnedItems={directNavItems}
          activeItemKey={activeNavKey}
          ariaLabel={t("shell.bar.workspacesLandmark")}
          allScreensLabel={t("shell.rail.all")}
          onOpenAllScreens={() => openAllScreens(null)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Row two no longer spans the full width — it starts where the
              column does, because it lists the screens OF the workspace that
              column has selected. It sticks under row one rather than with it:
              row one is `top-0`, and row one's height is exactly `--h-btn`
              (its tallest child sets it, and it carries no block padding), so
              the offset stays correct if that control scale ever changes. */}
          {showScreensBar ? (
            <WorkspaceScreensBar
              className="sticky top-0 z-30"
              group={activeGroup}
              activeKey={activeNavKey}
              ariaLabel={
                activeGroup ? `${t("shell.bar.workspaceScreens")} — ${activeGroup.label}` : t("shell.bar.workspaceScreens")
              }
              overflowLabel={t("shell.bar.overflow")}
            />
          ) : null}

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
