import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "../primitives/atoms";
import type { ThemePreference } from "../hooks/useTheme";
import { TopbarMenu } from "./TopbarMenu";
import type { ShellUser, UserMenuItem } from "./types";

/**
 * A notification row as the shell renders it. Kept here (rather than in the
 * app) because `apps/web`'s notification hooks type their feed against it.
 */
export interface ShellNotification {
  id: string;
  title: string;
  body?: string;
  at?: string;
  /** Undefined when the caller has no read-state to report. */
  read?: boolean;
}

export interface TopbarScopeOption {
  id: string;
  label: string;
}

interface ScopeSelectProps {
  ariaLabel: string;
  value: string | null;
  onChange?: (id: string | null) => void;
  allLabel: string;
  options: readonly TopbarScopeOption[];
  icon: ReactNode;
}

/** One working-scope dropdown (branch or warehouse) — a native `<select>` styled as a topbar pill so it stays keyboard- and screen-reader-accessible. */
function ScopeSelect({ ariaLabel, value, onChange, allLabel, options, icon }: ScopeSelectProps) {
  return (
    <div className="relative flex items-center gap-[7px] rounded-pill border border-border bg-surface-2 ps-[12px] pe-[8px] py-[7px] text-[12.5px] font-medium text-ink-muted transition-colors hover:border-border-strong">
      {icon}
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value === "" ? null : event.target.value)}
        className="cursor-pointer appearance-none bg-transparent pe-[14px] text-[12.5px] font-medium text-ink-muted outline-none"
      >
        <option value="">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 12 12" fill="none" className="pointer-events-none absolute end-[8px] h-[9px] w-[9px] opacity-70">
        <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export interface TopbarProps {
  onOpenCommandPalette: () => void;
  searchPlaceholder?: string;
  tenantName?: string;
  scopeLabel?: string;
  theme: ThemePreference;
  onToggleTheme: () => void;
  notificationCount?: number;
  /** Toggles the caller-supplied `notificationsPanel` open — omit both to keep the bell inert. */
  onToggleNotifications?: () => void;
  /** Rendered anchored under the bell when the caller has it open — see `NotificationsPanel`. */
  notificationsPanel?: ReactNode;
  userMenuItems?: UserMenuItem[];
  user: ShellUser;
  className?: string;
  /**
   * Working-branch / warehouse selectors — real dropdowns that narrow which
   * data the app queries (see `apps/web/src/data/hub-hooks.ts`
   * `useScopeSelector` and `authHeaders` in `apps/web/src/data/session.ts`),
   * not a cosmetic relabel. Omit `branchOptions` to render neither — never
   * rendered with a fabricated option list.
   */
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;
  allBranchesLabel?: string;
  allWarehousesLabel?: string;
}

/** Topbar — search launcher (Ctrl K), tenant chip, branch scope chip, theme toggle, notifications, user menu. */
export function Topbar({
  onOpenCommandPalette,
  searchPlaceholder = "بحث عن صفحة، عميل، فاتورة، أو إجراء…",
  tenantName,
  scopeLabel,
  theme,
  onToggleTheme,
  notificationCount = 0,
  onToggleNotifications,
  notificationsPanel,
  userMenuItems = [],
  user,
  className,
  branchOptions,
  warehouseOptions = [],
  selectedBranchId = null,
  selectedWarehouseId = null,
  onSelectBranch,
  onSelectWarehouse,
  allBranchesLabel = "كل الفروع",
  allWarehousesLabel = "كل المخازن",
}: TopbarProps) {
  const isDark = theme === "dark";

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-[62px] items-center gap-[12px] border-b border-border bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-[22px] backdrop-blur-[8px]",
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpenCommandPalette}
        className="flex w-[340px] max-w-[38vw] items-center gap-[9px] rounded-md border border-border bg-surface-2 px-[13px] py-[8px] text-[13px] text-ink-faint transition-colors hover:border-border-strong"
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] flex-none">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="flex-1 truncate text-start">{searchPlaceholder}</span>
        <span className="mz-lat rounded-[5px] border border-border-strong bg-surface px-[6px] py-[2px] font-mono text-[10px] text-ink-faint">
          Ctrl K
        </span>
      </button>

      <div className="flex-1" />

      {tenantName ? (
        <div className="mz-lat flex items-center gap-[7px] rounded-pill border border-border bg-surface-2 px-[12px] py-[7px] text-[12.5px] font-semibold text-ink">
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] text-ink-faint">
            <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M7 8h6M7 11h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {tenantName}
        </div>
      ) : null}

      {scopeLabel ? (
        <div className="flex items-center gap-[7px] rounded-pill border border-border bg-surface-2 px-[12px] py-[7px] text-[12.5px] font-medium text-ink-muted">
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] text-ink-faint">
            <path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V8.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          {scopeLabel}
        </div>
      ) : null}

      {branchOptions && branchOptions.length > 0 ? (
        <ScopeSelect
          ariaLabel="الفرع الحالي"
          value={selectedBranchId}
          onChange={onSelectBranch}
          allLabel={allBranchesLabel}
          options={branchOptions}
          icon={
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] text-ink-faint">
              <path d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V8.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          }
        />
      ) : null}

      {branchOptions && branchOptions.length > 0 ? (
        <ScopeSelect
          ariaLabel="المخزن الحالي"
          value={selectedWarehouseId}
          onChange={onSelectWarehouse}
          allLabel={allWarehousesLabel}
          options={warehouseOptions}
          icon={
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] text-ink-faint">
              <rect x="3" y="7" width="14" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M2.5 7 10 3l7.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          }
        />
      ) : null}

      <IconButton aria-label="تبديل المظهر" onClick={onToggleTheme}>
        {isDark ? (
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
            <path d="M16.5 12.6A6.8 6.8 0 0 1 7.4 3.5 6.8 6.8 0 1 0 16.5 12.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
            <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10 2v2M10 16v2M4 4l1.4 1.4M14.6 14.6 16 16M2 10h2M16 10h2M4 16l1.4-1.4M14.6 5.4 16 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
      </IconButton>

      <div className="relative">
        <IconButton
          aria-label={notificationCount > 0 ? `الإشعارات (${notificationCount})` : "الإشعارات"}
          onClick={onToggleNotifications}
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
            <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M8 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {notificationCount > 0 ? (
            <span aria-hidden className="absolute top-[7px] end-[7px] h-[7px] w-[7px] rounded-full border-2 border-surface bg-danger" />
          ) : null}
        </IconButton>
        {notificationsPanel}
      </div>

      <TopbarMenu
        label={user.name}
        trigger={(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            className="flex items-center gap-[9px] rounded-pill border border-border bg-surface py-[5px] pe-[12px] ps-[6px] transition-colors hover:border-border-strong"
          >
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-brand-strong font-display text-[11px] font-bold text-brand-ink">
              {user.initials}
            </span>
            <span className="text-start">
              <span className="block text-[12.5px] font-bold leading-[1.2] text-ink">{user.name}</span>
              <span className="mz-lat block text-[10px] text-ink-faint">{user.role}</span>
            </span>
          </button>
        )}
        panelClassName="w-[232px]"
      >
        {(close) => (
          <>
            <div className="border-b border-border px-[14px] py-[11px]">
              <div className="text-[12.5px] font-bold text-ink">{user.name}</div>
              <div className="mz-lat text-[11px] text-ink-faint">{user.role}</div>
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
                      "w-full px-[14px] py-[8px] text-start text-[12.5px] transition-colors hover:bg-surface-2",
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
    </header>
  );
}
