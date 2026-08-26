import { forwardRef, type ReactNode } from "react";
import { cn } from "../lib/cn";
import type { ThemePreference } from "../hooks/useTheme";
import { LOCALE_SHORT_LABEL, useUiTranslation, type Locale } from "../i18n";
import { CommandBar } from "./CommandBar";
import { ScopeSwitchers } from "./ScopeSwitcher";
import { TopbarMenu } from "./TopbarMenu";
import type { CommandItem, NavGroup, ShellUser, UserMenuItem } from "./types";

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

/** The header's always-visible system-status pill (R1.7) — a real check, not a decorative green dot. */
export interface TopbarSystemStatus {
  tone: "success" | "warning" | "danger" | "neutral";
  /** Already localized, short — this renders in the chrome, not a report. */
  label: string;
  onClick?: () => void;
}

/** One action in the header's support entry point (R1.8). */
export interface TopbarSupportItem {
  key: string;
  label: string;
  onSelect: () => void;
}

const SYSTEM_STATUS_DOT_CLASS: Record<TopbarSystemStatus["tone"], string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-ink-faint",
};

interface ChromeIconButtonProps {
  "aria-label": string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * The topbar's icon button — the shell chrome is dark teal in both themes, so
 * it cannot reuse the surface-token `IconButton`. `forwardRef` because
 * `TopbarMenu` attaches a ref to whatever its `trigger` renders, to focus it
 * back after Escape closes the panel.
 */
const ChromeIconButton = forwardRef<HTMLButtonElement, ChromeIconButtonProps>(function ChromeIconButton(
  { onClick, children, className, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[36px] w-[36px] flex-none items-center justify-center rounded-md border border-chrome-border text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink",
        className,
      )}
    >
      {children}
    </button>
  );
});

export interface TopbarProps {
  /**
   * Superseded by the always-visible command bar (spec §7) — accepted so
   * existing callers keep compiling, but nothing in the topbar opens a modal
   * palette any more.
   */
  onOpenCommandPalette?: () => void;
  /** Commands the always-visible command bar routes to. */
  commandItems?: CommandItem[];
  searchPlaceholder?: string;
  tenantName?: string;
  scopeLabel?: string;
  /** Drives which glyph the appearance toggle shows; the toggle only renders when `onToggleTheme` is supplied. */
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  /**
   * Nav groups lifted out of the sidebar rail into the header's gear menu —
   * settings and system. Their items keep the same `onClick` the rail gave
   * them, so routing is unchanged.
   */
  /**
   * Working-branch / warehouse selectors — real dropdowns that narrow which
   * data the app queries, not a cosmetic relabel. Omit `branchOptions` to
   * render neither; never rendered with a fabricated option list.
   */
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;
  allBranchesLabel?: string;
  allWarehousesLabel?: string;
  utilityGroups?: readonly NavGroup[];
  /** Highlights the matching utility item, mirroring the rail's active row. */
  activeNavKey?: string;
  /** The always-visible system-status pill (R1.7). Omit to render nothing — never a fabricated "all systems operational". */
  systemStatus?: TopbarSystemStatus;
  /** The support entry point's menu items (R1.8). Omit (or empty) to render no headset icon. */
  supportItems?: readonly TopbarSupportItem[];
  notificationCount?: number;
  /** Toggles the caller-supplied `notificationsPanel` open — omit both to keep the bell inert. */
  onToggleNotifications?: () => void;
  /** Rendered anchored under the bell when the caller has it open — see `NotificationsPanel`. */
  notificationsPanel?: ReactNode;
  userMenuItems?: UserMenuItem[];
  user: ShellUser;
  className?: string;
}

const LANGUAGE_NAME_KEY = { ar: "shell.language.name.ar", en: "shell.language.name.en" } as const;

/** The language switcher — flips locale AND direction live, with no reload. */
function LanguageToggle() {
  const { locale, setLocale, t } = useUiTranslation();
  const next: Locale = locale === "ar" ? "en" : "ar";
  return (
    <ChromeIconButton
      aria-label={t("shell.language.switchTo", { language: t(LANGUAGE_NAME_KEY[next]) })}
      onClick={() => setLocale(next)}
    >
      <span className={cn("text-xs font-bold", next === "en" && "mz-lat")}>{LOCALE_SHORT_LABEL[next]}</span>
    </ChromeIconButton>
  );
}

/** The appearance toggle — flips light/dark, sitting beside the language switcher. */
function ThemeToggle({ theme, onToggleTheme }: { theme?: ThemePreference; onToggleTheme: () => void }) {
  const { t } = useUiTranslation();
  return (
    <ChromeIconButton aria-label={t("shell.theme.toggle")} onClick={onToggleTheme}>
      {theme === "dark" ? (
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px]">
          <path
            d="M16.5 12.6A6.8 6.8 0 0 1 7.4 3.5 6.8 6.8 0 1 0 16.5 12.6Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px]">
          <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10 2v2M10 16v2M4 4l1.4 1.4M14.6 14.6 16 16M2 10h2M16 10h2M4 16l1.4-1.4M14.6 5.4 16 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </ChromeIconButton>
  );
}

/** The gear menu — settings and system, grouped, opened from the header. */
function UtilityMenu({ groups, activeNavKey }: { groups: readonly NavGroup[]; activeNavKey?: string }) {
  const { t } = useUiTranslation();
  const label = t("shell.utility.menu");
  return (
    <TopbarMenu
      label={label}
      panelClassName="max-h-[calc(100vh-92px)] w-[268px] overflow-y-auto"
      trigger={(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          aria-label={label}
          className="flex h-[36px] w-[36px] flex-none items-center justify-center rounded-md border border-chrome-border text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink"
        >
          <svg aria-hidden viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]">
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      )}
    >
      {(close) => (
        <>
          {groups.map((group) => (
            <div key={group.key} className="border-b border-border last:border-b-0">
              <div className="px-[14px] pb-[4px] pt-[10px] text-2xs font-bold uppercase tracking-wide text-ink-faint">{group.label}</div>
              <ul className="pb-[6px]">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        item.onClick?.();
                        close();
                      }}
                      className={cn(
                        "w-full px-[14px] py-[7px] text-start text-sm transition-colors hover:bg-surface-2",
                        item.key === activeNavKey ? "bg-surface-2 font-semibold text-ink" : "text-ink",
                      )}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </TopbarMenu>
  );
}

/** The support entry point (R1.8) — a headset icon opening a short list of real, already-live actions. */
function SupportMenu({ items }: { items: readonly TopbarSupportItem[] }) {
  const { t } = useUiTranslation();
  const label = t("shell.support.menu");
  return (
    <TopbarMenu
      label={label}
      panelClassName="w-[220px]"
      trigger={(triggerProps) => (
        <ChromeIconButton {...triggerProps} aria-label={label}>
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px]">
            <path
              d="M4 11.5V10a6 6 0 0 1 12 0v1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <rect x="3" y="11" width="3.4" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
            <rect x="13.6" y="11" width="3.4" height="5" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16.4 16v.5a2.5 2.5 0 0 1-2.5 2.5H11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ChromeIconButton>
      )}
    >
      {(close) => (
        <ul className="py-[4px]">
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onSelect();
                  close();
                }}
                className="w-full px-[14px] py-[8px] text-start text-sm text-ink transition-colors hover:bg-surface-2"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </TopbarMenu>
  );
}

/** Topbar — the persistent command bar, tenant chip, the branch/warehouse scope selectors, the settings/system gear menu, language and appearance toggles, notifications and the user menu, all on the dark chrome. */
export function Topbar({
  commandItems = [],
  searchPlaceholder,
  tenantName,
  scopeLabel,
  theme,
  onToggleTheme,
  branchOptions,
  warehouseOptions,
  selectedBranchId,
  selectedWarehouseId,
  onSelectBranch,
  onSelectWarehouse,
  allBranchesLabel,
  allWarehousesLabel,
  utilityGroups = [],
  activeNavKey,
  systemStatus,
  supportItems = [],
  notificationCount = 0,
  onToggleNotifications,
  notificationsPanel,
  userMenuItems = [],
  user,
  className,
}: TopbarProps) {
  const { t } = useUiTranslation();

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-[62px] flex-none items-center gap-[12px] border-b border-chrome-border bg-chrome px-[22px] text-chrome-ink",
        className,
      )}
    >
      <CommandBar items={commandItems} placeholder={searchPlaceholder} className="w-full max-w-[560px] flex-1" />

      <div className="flex flex-1 items-center justify-end gap-[8px]">
        {tenantName ? (
          <div className="mz-lat flex items-center gap-[7px] rounded-pill border border-chrome-border bg-chrome-hover px-[12px] py-[7px] text-xs font-semibold text-chrome-ink">
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] text-chrome-ink-muted">
              <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7 8h6M7 11h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {tenantName}
          </div>
        ) : null}

        {scopeLabel && !branchOptions?.length ? (
          <div className="flex items-center gap-[7px] rounded-pill border border-chrome-border bg-chrome-hover px-[12px] py-[7px] text-xs font-medium text-chrome-ink">
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] text-chrome-ink-muted">
              <path
                d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V8.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            {scopeLabel}
          </div>
        ) : null}

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
          allBranchesLabel={allBranchesLabel ?? t("shell.scope.allBranches")}
          allWarehousesLabel={allWarehousesLabel ?? t("shell.scope.allWarehouses")}
        />

        {systemStatus ? (
          <button
            type="button"
            onClick={systemStatus.onClick}
            aria-label={t("shell.systemStatus.ariaLabel", { label: systemStatus.label })}
            className="mz-lat flex items-center gap-[7px] rounded-pill border border-chrome-border bg-chrome-hover px-[12px] py-[7px] text-xs font-medium text-chrome-ink transition-colors hover:border-chrome-accent"
          >
            <span aria-hidden className={cn("h-[7px] w-[7px] flex-none rounded-full", SYSTEM_STATUS_DOT_CLASS[systemStatus.tone])} />
            {systemStatus.label}
          </button>
        ) : null}

        {utilityGroups.length > 0 ? <UtilityMenu groups={utilityGroups} activeNavKey={activeNavKey} /> : null}
        {supportItems.length > 0 ? <SupportMenu items={supportItems} /> : null}

        <LanguageToggle />
        {onToggleTheme ? <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} /> : null}

        <div className="relative">
          <ChromeIconButton
            aria-label={
              notificationCount > 0 ? t("shell.notifications.withCount", { count: notificationCount }) : t("shell.notifications")
            }
            onClick={onToggleNotifications}
            className="relative"
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
              <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M8 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {notificationCount > 0 ? (
              <span aria-hidden className="absolute top-[6px] end-[6px] h-[7px] w-[7px] rounded-full border-2 border-chrome bg-danger" />
            ) : null}
          </ChromeIconButton>
          {notificationsPanel}
        </div>

        <TopbarMenu
          label={user.name}
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              type="button"
              className="flex items-center gap-[9px] rounded-pill border border-chrome-border bg-chrome-hover py-[5px] pe-[12px] ps-[6px] transition-colors hover:border-chrome-accent"
            >
              <span className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-strong font-display text-[11px] font-extrabold text-[color:var(--chrome-2)]">
                {user.initials}
              </span>
              <span className="text-start">
                <span className="block text-xs font-bold leading-[1.2] text-chrome-ink">{user.name}</span>
                <span className="mz-lat block text-2xs text-chrome-ink-muted">{user.role}</span>
              </span>
            </button>
          )}
          panelClassName="w-[232px]"
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
                        "w-full px-[14px] py-[8px] text-start text-sm transition-colors hover:bg-surface-2",
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
    </header>
  );
}
