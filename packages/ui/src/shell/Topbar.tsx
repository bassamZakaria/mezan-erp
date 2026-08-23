import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "../primitives/atoms";
import type { ThemePreference } from "../hooks/useTheme";
import type { ShellUser } from "./types";

export interface ShellNotification {
  id: string;
  title: string;
  body?: string;
  at?: string;
}

export interface TopbarProps {
  onOpenCommandPalette: () => void;
  searchPlaceholder?: string;
  tenantName?: string;
  scopeLabel?: string;
  theme: ThemePreference;
  onToggleTheme: () => void;
  /** Real notifications to render. An empty list renders the empty state — never a fabricated badge. */
  notifications?: ShellNotification[];
  onLogout?: () => void;
  user: ShellUser;
  className?: string;
}

/** Topbar — search launcher (Ctrl K), tenant chip, branch scope chip, theme toggle, notifications, user menu. */
export function Topbar({
  onOpenCommandPalette,
  searchPlaceholder = "بحث عن صفحة، عميل، فاتورة، أو إجراء…",
  tenantName,
  scopeLabel,
  theme,
  onToggleTheme,
  notifications = [],
  onLogout,
  user,
  className,
}: TopbarProps) {
  const isDark = theme === "dark";
  const [openMenu, setOpenMenu] = useState<"none" | "notifications" | "user">("none");
  const menusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openMenu === "none") return;
    function onDocPointerDown(event: MouseEvent) {
      if (!menusRef.current?.contains(event.target as Node)) setOpenMenu("none");
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu("none");
    }
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

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

      <div ref={menusRef} className="relative flex items-center gap-[12px]">
        <IconButton
          aria-label={notifications.length > 0 ? `الإشعارات (${notifications.length})` : "الإشعارات"}
          aria-expanded={openMenu === "notifications"}
          onClick={() => setOpenMenu((m) => (m === "notifications" ? "none" : "notifications"))}
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
            <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5h-13S5 12 5 8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M8 15.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {notifications.length > 0 ? (
            <span aria-hidden className="absolute top-[7px] end-[7px] h-[7px] w-[7px] rounded-full border-2 border-surface bg-danger" />
          ) : null}
        </IconButton>

        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={openMenu === "user"}
          onClick={() => setOpenMenu((m) => (m === "user" ? "none" : "user"))}
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

        {openMenu === "notifications" ? (
          <div
            role="region"
            aria-label="الإشعارات"
            className="absolute top-[46px] end-0 z-30 w-[320px] rounded-lg border border-border bg-surface p-[12px] shadow-lg"
          >
            <p className="mb-[8px] text-[12.5px] font-bold text-ink">الإشعارات</p>
            {notifications.length === 0 ? (
              <p className="py-[16px] text-center text-[12px] text-ink-muted">لا توجد إشعارات</p>
            ) : (
              <ul className="flex flex-col gap-[8px]">
                {notifications.map((n) => (
                  <li key={n.id} className="rounded-md border border-border bg-surface-2 p-[9px]">
                    <p className="text-[12.5px] font-semibold text-ink">{n.title}</p>
                    {n.body ? <p className="mt-[2px] text-[11.5px] text-ink-muted">{n.body}</p> : null}
                    {n.at ? <p className="mz-lat mt-[2px] text-[10px] text-ink-faint">{n.at}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {openMenu === "user" ? (
          <div role="menu" aria-label="حساب المستخدم" className="absolute top-[46px] end-0 z-30 w-[220px] rounded-lg border border-border bg-surface p-[8px] shadow-lg">
            <div className="border-b border-border px-[8px] pb-[8px]">
              <p className="text-[12.5px] font-bold text-ink">{user.name}</p>
              <p className="mz-lat text-[10.5px] text-ink-faint">{user.role}</p>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpenMenu("none");
                onLogout?.();
              }}
              className="mt-[6px] w-full rounded-md px-[8px] py-[7px] text-start text-[12.5px] font-semibold text-danger transition-colors hover:bg-surface-2"
            >
              تسجيل الخروج
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
