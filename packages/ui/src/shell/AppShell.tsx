import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useTheme } from "../hooks/useTheme";
import { useUiTranslation } from "../i18n";
import { AllScreensPanel } from "./AllScreensPanel";
import { BrandMark } from "./BrandMark";
import { CommandPalette, useCommandPaletteShortcut } from "./CommandPalette";
import { RailFooter } from "./RailFooter";
import { WorkspaceRail } from "./WorkspaceRail";
import { WorkspaceScreensBar } from "./WorkspaceScreensBar";
import { RAIL_BREAKPOINT, RAIL_DOCKED, RAIL_OVERLAY, SMALL_ONLY } from "./metrics";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { TopbarScopeOption } from "./ScopeSwitcher";
import type { CommandItem, NavGroup, NavItem, ShellUser, UserMenuItem } from "./types";

/** The id the skip link targets; `<main>` carries it and `tabIndex={-1}` so focus lands. */
const MAIN_ID = "mz-main";

/**
 * One of the inboxes, as an icon button beside the wordmark.
 *
 * Icon-only, so the label has to survive twice over: as `aria-label` for a
 * screen reader and as `title` for a hover tooltip. Dropping either turns a
 * named row into an unidentifiable glyph — the count badge alone does not say
 * WHAT is unread, and «صندوق الوارد» and «الموافقات» are easily confused when
 * both are reduced to a small mark.
 *
 * The badge is a bare number, so the count is spelled into the accessible name
 * rather than left for the reader to associate positionally.
 */
function BrandAction({ item, active, onActivate }: { item: NavItem; active: boolean; onActivate: () => void }) {
  const label = item.tag ? `${item.label} (${item.tag.label})` : item.label;
  return (
    <button
      type="button"
      onClick={() => {
        onActivate();
        item.onClick?.();
      }}
      onPointerEnter={item.onIntent}
      onFocus={item.onIntent}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[32px] w-[32px] flex-none items-center justify-center rounded-md transition-colors",
        "focus-visible:outline-chrome-accent",
        active ? "bg-chrome-active text-chrome-ink" : "text-chrome-ink-muted hover:bg-chrome-hover hover:text-chrome-ink",
      )}
    >
      {item.icon}
      {item.tag ? (
        // Positioned on the glyph rather than after it: at 32px there is no
        // room for a number beside the icon, and the badge must stay legible
        // at a glance — it is the only reason to look at this control.
        <span
          aria-hidden
          className="mz-num absolute -top-[2px] end-[1px] min-w-[14px] rounded-pill bg-chrome-accent px-[3px] text-center text-2xs font-bold leading-[14px] text-chrome"
        >
          {item.tag.label}
        </span>
      ) : null}
    </button>
  );
}

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
  /** Opens الملف الشخصي — the user chip in the column's foot is its link. */
  onOpenProfile?: () => void;
  /** Ends the session, from the column's foot. */
  onSignOut?: () => void;

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
 * AppShell — design direction ب (`docs/artifacts/directions/nav-level.html`): the six
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
 * one would slice both off at its edge. Row TWO scrolls horizontally instead
 * of clipping, but its own dropdowns are still portaled (see
 * `WorkspaceScreensBar`) rather than reasoning about a scroll container's
 * stacking context.
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
  onOpenProfile,
  onSignOut,
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
  /**
   * The workspace column as a DRAWER, below `RAIL_BREAKPOINT`.
   *
   * Above the breakpoint this stays false and changes nothing: the column is a
   * normal sibling of the content and the toggle that sets this is not
   * rendered. Below it the column leaves the flow entirely, because a fixed
   * 256px sibling on a 390px phone left 134px for the screen and the page
   * scrolled sideways.
   */
  const [railOpen, setRailOpen] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);

  /*
   * Closing on a resize past the breakpoint, not just on navigation: a drawer
   * left "open" while the layout goes back to two columns would keep the scrim
   * over a desktop screen, and the toggle that dismisses it is hidden at that
   * size — an unclosable overlay.
   */
  useEffect(() => {
    // `matchMedia` is absent in jsdom, and this shell renders in ~40 unit
    // tests. Guarded rather than stubbed in each of them: a shell that throws
    // without a media API would also break any non-browser render.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia(`(min-width: ${RAIL_BREAKPOINT + 1}px)`);
    const sync = () => {
      if (wide.matches) setRailOpen(false);
    };
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);

  useFocusTrap({ active: railOpen, containerRef: railRef, onEscape: () => setRailOpen(false) });

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
  /**
   * ...and it is forgotten the moment the user lands anywhere. Without this it
   * outlived the click that set it: opening الموافقات or the dashboard — both
   * of which belong to NO workspace — left the previous workspace's screens on
   * the bar, offering five destinations unrelated to the page and marking none
   * of them current. `activeNavKey` changing IS the signal that navigation
   * happened; a hub-less workspace does not move it, which is exactly the case
   * the clicked key exists to cover.
   */
  useEffect(() => {
    setClickedWorkspaceKey(undefined);
  }, [activeNavKey]);
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

  /** ⌘K and the column's search row open the same dialog. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);

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
    <div className={cn("mz-print-flow flex min-h-screen flex-col bg-bg text-ink", className)}>
      {/*
        Parked above the viewport rather than built out of `sr-only` +
        `focus:not-sr-only`: that pair resets `position` to static on focus, so
        the link would drop into the flow and shove the whole bar down as soon
        as a keyboard user reached it. Fixed in both states, it only slides.
      */}
      <a
        href={`#${MAIN_ID}`}
        className="mz-screen-only fixed start-[8px] top-[-200px] z-50 inline-flex min-h-[var(--h-btn)] items-center whitespace-nowrap rounded-md border border-border-strong bg-surface px-[16px] text-sm font-semibold text-ink focus:top-[8px]"
      >
        {t("shell.bar.skip")}
      </a>


      {/*
        The small-screen header. It exists ONLY below the breakpoint and holds
        the one control that opens the drawer — without it the column, and with
        it the brand, the workspace list and RailFooter's theme, notifications
        and user menu, would simply be unreachable on a phone.
      */}
      <div
        className={cn(
          SMALL_ONLY,
          "mz-screen-only sticky top-0 z-40 flex min-h-[var(--h-topbar)] items-center gap-[10px] border-b border-chrome-border bg-chrome px-[12px] text-chrome-ink",
        )}
      >
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          aria-label={t("shell.bar.openMenu")}
          aria-expanded={railOpen}
          className="flex min-h-[34px] min-w-[34px] flex-none items-center justify-center rounded-md border border-transparent text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink focus-visible:outline-chrome-accent"
        >
          <svg viewBox="0 0 24 24" aria-hidden focusable="false" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.75}>
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        {/*
          The brand is a LABEL here, not a second home button. The docked column
          already has one carrying that accessible name, and two controls with
          the same name in one page is an ambiguity for a screen-reader user —
          and for any test that asks for it by name. Home stays one tap away
          inside the drawer.
        */}
        {/*
          The MARK only, with no wordmark text. The docked column carries the
          full lockup, and CSS hides one of the two headers at any given width —
          but only in a browser. Anything reading the DOM (a screen reader's
          buffer, a test) sees both, and a duplicated brand name is an
          ambiguity in both. The mark is decorative here; the accessible name
          for this bar is the menu button beside it.
        */}
        <BrandMark aria-hidden className="h-[22px] w-[22px] flex-none text-chrome-accent" />
      </div>

      {/* The scrim. Clicking it dismisses, which is the gesture every drawer owes. */}
      {railOpen ? (
        <div
          aria-hidden
          onClick={() => setRailOpen(false)}
          className={cn(SMALL_ONLY, "mz-screen-only fixed inset-0 z-40 bg-[rgb(0_0_0/45%)]")}
        />
      ) : null}

      <div className="mz-print-flow flex min-h-0 flex-1 items-stretch">
        <WorkspaceRail
          containerRef={railRef}
          /* Docked above the breakpoint; an overlay below it, and only when
             open — a hidden drawer must not sit in the tab order. */
          className={cn("mz-screen-only", railOpen ? RAIL_OVERLAY : RAIL_DOCKED)}
          onNavigate={() => setRailOpen(false)}
          brand={
            /* The mark is the app's own balance-beam glyph (`BrandMark`) and the
               whole lockup is one link home. It sits INSIDE the column now — the
               column is the only chrome left, so the brand is its header rather
               than a thing floating in a band above the page.

               لوحة التحكم and the two inboxes sit BESIDE it as icons rather
               than as rows in the list below. They are single destinations,
               not workspaces: every other row in the column opens a whole shelf
               of screens, these open exactly one each. They are also the same
               three in every workspace, and two carry live counts — a badge
               that scrolls out of view with the list is a badge nobody sees. */
            <div className="flex min-h-[var(--h-topbar)] flex-none items-center gap-[4px] pe-[8px] ps-[14px]">
              <button
                type="button"
                onClick={() => {
                  setRailOpen(false);
                  onNavigateHome?.();
                }}
                aria-label={t("shell.bar.home")}
                className="flex min-w-0 flex-1 items-center gap-[8px] py-[6px] text-chrome-ink transition-colors hover:text-chrome-ink focus-visible:outline-chrome-accent"
              >
                <BrandMark className="h-[24px] w-[24px] flex-none text-chrome-accent" />
                <span className="mz-disp truncate text-lg font-bold">{t("shell.brand.name")}</span>
              </button>
              {directNavItems.map((item) => (
                <BrandAction
                  key={item.key}
                  item={item}
                  active={item.key === activeNavKey}
                  onActivate={() => setRailOpen(false)}
                />
              ))}
            </div>
          }
          footer={
            <RailFooter
              onOpenPalette={() => {
                setRailOpen(false);
                openPalette();
              }}
              onShowHelp={onShowHelp}
              theme={theme}
              onToggleTheme={toggleTheme}
              user={user}
              onOpenProfile={
                onOpenProfile
                  ? () => {
                      setRailOpen(false);
                      onOpenProfile();
                    }
                  : undefined
              }
              onSignOut={onSignOut}
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
          /* The pinned rows moved into the brand row above as icons; the rail
             now carries workspaces only. */
          pinnedItems={[]}
          activeItemKey={activeNavKey}
          ariaLabel={t("shell.bar.workspacesLandmark")}
          allScreensLabel={t("shell.rail.all")}
          onOpenAllScreens={() => openAllScreens(null)}
        />

        <div className="mz-print-flow flex min-w-0 flex-1 flex-col">
          {/* Row two no longer spans the full width — it starts where the
              column does, because it lists the screens OF the workspace that
              column has selected. It sticks under row one rather than with it:
              row one is `top-0`, and row one's height is exactly `--h-btn`
              (its tallest child sets it, and it carries no block padding), so
              the offset stays correct if that control scale ever changes. */}
          {showScreensBar ? (
            <WorkspaceScreensBar
              className="mz-screen-only sticky top-0 z-30"
              group={activeGroup}
              activeKey={activeNavKey}
              ariaLabel={
                activeGroup ? `${t("shell.bar.workspaceScreens")} — ${activeGroup.label}` : t("shell.bar.workspaceScreens")
              }
            />
          ) : null}

          <div className="mz-print-flow flex min-h-0 flex-1 items-stretch">
            <main id={MAIN_ID} tabIndex={-1} className="mz-print-flow min-w-0 flex-1 px-[24px] pb-[64px] pt-[20px]">
              {children}
            </main>

            {gutter ? <div className="mz-screen-only contents">{gutter}</div> : null}
          </div>
        </div>
      </div>

      <CommandPalette
        items={commandItems}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        placeholder={t("shell.command.placeholder")}
      />

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
