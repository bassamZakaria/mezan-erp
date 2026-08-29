import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { ChromeActions } from "./ChromeActions";
import { CommandBar } from "./CommandBar";
import { ScopeSwitchers, type TopbarScopeOption } from "./ScopeSwitcher";
import { TopbarMenu } from "./TopbarMenu";
import type { ThemePreference } from "../hooks/useTheme";
import type { CommandItem, ShellUser, UserMenuItem } from "./types";

/**
 * THE FOOT OF THE WORKSPACE COLUMN — everything that used to be row one.
 *
 *   ┌──────────────────┐
 *   │ ⌕ ابحث…      ⌘K │  search, results opening UPWARD
 *   │ 🏠 الفرع الرئيسي │  the working scope
 *   │ 🏬 كل المستودعات │
 *   ├──────────────────┤
 *   │ ؟ ع ☀ 🔔   م محمد│  utilities, then the session
 *   └──────────────────┘
 *
 * Row one is gone (direction أ): a full-width band cost 56px on every screen
 * to carry controls that are touched once or twice a day, and the search — the
 * one thing in it used every minute — was a 250px box wedged between the
 * appearance toggle and the bell. Down here the same controls cost NO
 * horizontal band at all, and the column that holds them is chrome the user is
 * already looking at to navigate.
 *
 * EVERY PANEL OPENS UPWARD. At the bottom of the viewport a menu dropped
 * downward is drawn past the fold and cannot be reached — `openUp` on
 * `TopbarMenu` and `CommandBar` exists for exactly this position.
 */
export interface RailFooterProps {
  commandItems?: CommandItem[];
  onShowHelp?: () => void;
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  notificationCount?: number;
  onToggleNotifications?: () => void;
  notificationsPanel?: ReactNode;
  user: ShellUser;
  userMenuItems?: UserMenuItem[];
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;
}

export function RailFooter({
  commandItems = [],
  onShowHelp,
  theme,
  onToggleTheme,
  notificationCount = 0,
  onToggleNotifications,
  notificationsPanel,
  user,
  userMenuItems = [],
  branchOptions,
  warehouseOptions,
  selectedBranchId,
  selectedWarehouseId,
  onSelectBranch,
  onSelectWarehouse,
}: RailFooterProps) {
  const { t } = useUiTranslation();

  return (
    <div className="mt-auto flex flex-none flex-col gap-[8px] border-t border-chrome-border px-[10px] pt-[10px]">
      <CommandBar
        items={commandItems}
        placeholder={t("shell.command.placeholder")}
        openUp
        className="w-full [&>div]:min-h-[38px] [&>div]:px-[10px]"
      />

      <ScopeSwitchers
        orientation="rail"
        expanded
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
      {/* IDENTITY ON ITS OWN ROW. Sharing one 200px row with four 44px icons
          squeezed the chip to ~24px and spilled it over the column's edge. */}
      <div className="flex flex-col gap-[2px] border-t border-chrome-border pt-[6px]">
        <TopbarMenu
          label={user.name}
          openUp
          panelClassName="w-[232px]"
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              className={cn(
                "flex min-h-[var(--h-btn)] w-full min-w-0 items-center gap-[8px] rounded-md border border-transparent",
                "px-[6px] text-start transition-colors hover:bg-chrome-hover focus-visible:outline-chrome-accent",
              )}
            >
              <span className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full bg-accent font-display text-[11px] font-extrabold text-accent-ink">
                {user.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold leading-[1.2] text-chrome-ink">{user.name}</span>
                <span className="mz-lat block truncate text-2xs text-chrome-ink-muted">{user.role}</span>
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

        <div className="flex items-center gap-[2px]">
          <ChromeActions onShowHelp={onShowHelp} theme={theme} onToggleTheme={onToggleTheme} className="gap-[2px]" />

          <div className="relative flex-none">
            <button
              type="button"
              onClick={onToggleNotifications}
              aria-label={
                notificationCount > 0 ? t("shell.notifications.withCount", { count: notificationCount }) : t("shell.notifications")
              }
              className="relative flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center rounded-md border border-transparent bg-transparent text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink focus-visible:outline-chrome-accent"
            >
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
                <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M8 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              {/* Never colour alone, and never a bare dot: the number is text,
                  so it survives greyscale. Past 9 it would outgrow the icon —
                  the accessible name above keeps the true figure. */}
              {notificationCount > 0 ? (
                <span
                  aria-hidden
                  className="mz-lat absolute top-[5px] end-[5px] flex h-[16px] min-w-[16px] items-center justify-center rounded-pill border-2 border-chrome bg-danger px-[3px] text-[10px] font-bold leading-none text-danger-on"
                >
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              ) : null}
            </button>
            {notificationsPanel}
          </div>
        </div>
      </div>
    </div>
  );
}
