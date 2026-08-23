import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { ThemePreference } from "../hooks/useTheme";
import { LOCALE_SHORT_LABEL, useUiTranslation, type Locale } from "../i18n";
import { CommandBar } from "./CommandBar";
import { TopbarMenu } from "./TopbarMenu";
import type { CommandItem, ShellUser, UserMenuItem } from "./types";

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

interface ChromeIconButtonProps {
  "aria-label": string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

/** The topbar's icon button — the shell chrome is dark teal in both themes, so it cannot reuse the surface-token `IconButton`. */
function ChromeIconButton({ onClick, children, className, ...rest }: ChromeIconButtonProps) {
  return (
    <button
      {...rest}
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
}

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
  /** The theme control now lives at the foot of the sidebar rail (spec §5); accepted here for source compatibility. */
  theme?: ThemePreference;
  onToggleTheme?: () => void;
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

/** Topbar — the persistent command bar, tenant chip, language toggle, notifications and the user menu, all on the dark chrome. */
export function Topbar({
  commandItems = [],
  searchPlaceholder,
  tenantName,
  scopeLabel,
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
        "sticky top-0 z-20 flex h-[62px] flex-none items-center gap-[12px] border-b border-chrome-border bg-chrome px-[22px] text-chrome-ink",
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

        {scopeLabel ? (
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

        <LanguageToggle />

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
