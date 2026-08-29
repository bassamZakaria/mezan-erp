import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { Avatar } from "./Avatar";
import { ChromeActions } from "./ChromeActions";
import { CommandTrigger } from "./CommandPalette";
import { ScopeSwitchers, type TopbarScopeOption } from "./ScopeSwitcher";
import type { ThemePreference } from "../hooks/useTheme";
import type { ShellUser } from "./types";

/**
 * THE FOOT OF THE WORKSPACE COLUMN — everything that used to be row one.
 *
 *   ┌──────────────────┐
 *   │ ⌕ ابحث…      ⌘K │  search, results opening UPWARD
 *   │ 🏠 الفرع الرئيسي │  the working scope
 *   │ 🏬 كل المستودعات │
 *   ├──────────────────┤
 *   │ (م) محمد الشهابي │  the user — one click to their profile
 *   │ ؟ ع ☀        ⏻  │  utilities, then sign out
 *   └──────────────────┘
 *
 * Row one is gone (direction أ): a full-width band cost 56px on every screen
 * to carry controls that are touched once or twice a day, and the search — the
 * one thing in it used every minute — was a 250px box wedged between the
 * appearance toggle and the bell. Down here the same controls cost NO
 * horizontal band at all, and the column that holds them is chrome the user is
 * already looking at to navigate.
 *
 * NO MENU ON THE USER. The chip held a two-item dropdown — profile, sign out —
 * which is a popup to reach a page and a popup to reach a button. The chip IS
 * the link to the profile now, and signing out is its own control beside the
 * appearance toggle. Notifications left this row entirely: they are صندوق
 * الوارد, a pinned destination at the top of the column, not a bell.
 */
export interface RailFooterProps {
  /** Opens the ⌘K dialog; the foot only carries its trigger. */
  onOpenPalette: () => void;
  onShowHelp?: () => void;
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  user: ShellUser;
  /** The chip's destination — الملف الشخصي. */
  onOpenProfile?: () => void;
  /** Ends the session. Omit and the sign-out control is not drawn. */
  onSignOut?: () => void;
  signOutLabel?: string;
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;
}

export function RailFooter({
  onOpenPalette,
  onShowHelp,
  theme,
  onToggleTheme,
  user,
  onOpenProfile,
  onSignOut,
  signOutLabel,
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
      <CommandTrigger onOpen={onOpenPalette} />

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
      {/* IDENTITY ON ITS OWN ROW, and it is a LINK. Sharing one row with four
          44px icons squeezed the chip to ~24px and spilled it over the edge. */}
      <div className="flex flex-col gap-[2px] border-t border-chrome-border pt-[6px]">
        <button
          type="button"
          onClick={onOpenProfile}
          className={cn(
            "flex min-h-[var(--h-btn)] w-full min-w-0 items-center gap-[9px] rounded-md border border-transparent",
            "px-[6px] text-start transition-colors hover:bg-chrome-hover focus-visible:outline-chrome-accent",
          )}
        >
          <Avatar user={user} size={30} />
          {/* NAME ONLY. The role sat under it as a second line and is the one
              thing here nobody needs at a glance; it is on the profile this
              button opens, beside everything else about the user. */}
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-chrome-ink">{user.name}</span>
        </button>

        <div className="flex items-center gap-[2px]">
          <ChromeActions onShowHelp={onShowHelp} theme={theme} onToggleTheme={onToggleTheme} className="gap-[2px]" />

          {onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              aria-label={signOutLabel ?? t("shell.signOut")}
              title={signOutLabel ?? t("shell.signOut")}
              className={cn(
                "ms-auto flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center rounded-md",
                "border border-transparent bg-transparent text-chrome-ink-muted transition-colors",
                "hover:bg-chrome-hover hover:text-danger focus-visible:outline-chrome-accent",
              )}
            >
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
                <path
                  d="M12.5 6.5V4.8A1.8 1.8 0 0 0 10.7 3H5.3A1.8 1.8 0 0 0 3.5 4.8v10.4A1.8 1.8 0 0 0 5.3 17h5.4a1.8 1.8 0 0 0 1.8-1.8v-1.7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M8 10h8.5m0 0-2.4-2.4M16.5 10l-2.4 2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
