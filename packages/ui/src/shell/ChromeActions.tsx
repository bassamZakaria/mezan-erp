import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import { LOCALE_SHORT_LABEL, useUiTranslation, type Locale } from "../i18n";
import { POPUP_Z_CLASS, usePopupPosition } from "./popup-position";
import type { NavGroup, NavItem } from "./types";

/**
 * The chrome's own controls — language, appearance and the settings/system
 * gear — lifted out of the retired `Topbar` so the two-row bar keeps them.
 *
 * WHY THE GEAR'S PANEL IS PORTALED, NOT `absolute`: row one of `AppShell` is
 * `overflow-hidden` (ground rule §2.9 — the bar may never give the page a
 * sideways scrollbar) and sits inside a `sticky` header. An absolutely
 * positioned panel anchored in that row is clipped at the row's edge AND
 * confined to the header's stacking context, so it opens as a sliver under the
 * page. `usePopupPosition` + `POPUP_Z_CLASS` (primitives/popup-position.ts) is
 * the one way this codebase does that.
 */

/* No resting box: the icons sit straight on the chrome. The fill and the
   brighter ink appear on hover and focus, which is where they carry meaning —
   a bordered container around every glyph made the bar read as five buttons
   competing with the workspace column. */
const CHROME_BUTTON =
  "flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center rounded-md border border-transparent bg-transparent text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink";

const LANGUAGE_NAME_KEY = { ar: "shell.language.name.ar", en: "shell.language.name.en" } as const;

/** The language switcher — flips locale AND direction live, with no reload. */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale, t } = useUiTranslation();
  const next: Locale = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      aria-label={t("shell.language.switchTo", { language: t(LANGUAGE_NAME_KEY[next]) })}
      onClick={() => setLocale(next)}
      className={cn(CHROME_BUTTON, className)}
    >
      <span className={cn("text-xs font-bold", next === "en" && "mz-lat")}>{LOCALE_SHORT_LABEL[next]}</span>
    </button>
  );
}

export interface ThemeToggleProps {
  /** Supply both to drive the toggle from the caller; omit both and it owns its own `useTheme`. */
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  className?: string;
}

/** The appearance toggle — flips light/dark, sitting beside the language switcher. */
export function ThemeToggle({ theme, onToggleTheme, className }: ThemeToggleProps) {
  const { t } = useUiTranslation();
  const own = useTheme();
  const current = theme ?? own.theme;
  const toggle = onToggleTheme ?? own.toggleTheme;
  return (
    <button type="button" aria-label={t("shell.theme.toggle")} onClick={toggle} className={cn(CHROME_BUTTON, className)}>
      {current === "dark" ? (
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
    </button>
  );
}

interface ChromeMenuProps {
  label: string;
  glyph: ReactNode;
  children: (close: () => void) => ReactNode;
}

function ChromeMenu({ label, glyph, children }: ChromeMenuProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const position = usePopupPosition(triggerRef, open, "end");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A vertical menu: ArrowUp/ArrowDown are unaffected by direction.
  function onPanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : ((current < 0 ? (event.key === "ArrowDown" ? -1 : 0) : current) + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
            rows.length;
    rows[next]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={CHROME_BUTTON}
      >
        {glyph}
      </button>

      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="menu"
              aria-label={label}
              onKeyDown={onPanelKeyDown}
              className={cn("fixed w-[290px] overflow-y-auto border border-border-strong bg-surface text-ink shadow-2", POPUP_Z_CLASS)}
              style={{ top: position.top, insetInlineEnd: position.insetInlineEnd, maxHeight: position.maxHeight }}
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function UtilityMenuRow({ item, active, close }: { item: NavItem; active: boolean; close: () => void }) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        aria-current={active ? "page" : undefined}
        onClick={() => {
          item.onClick?.();
          close();
        }}
        className={cn(
          "flex min-h-[var(--h-btn)] w-full items-center gap-[8px] px-[14px] text-start text-sm transition-colors hover:bg-surface-2",
          active ? "bg-surface-2 font-semibold text-accent" : "text-ink",
        )}
      >
        {/* Never colour alone — the open screen also carries this marker and a heavier weight. */}
        <span aria-hidden className={cn("w-[8px] flex-none text-center", active ? "text-accent" : "text-transparent")}>
          ◂
        </span>
        <span className="truncate">{item.label}</span>
      </button>
    </li>
  );
}

/**
 * The one visible way into the shortcuts sheet. `?` opens it too, but a
 * shortcut whose only doorway is itself a shortcut is folklore, not a feature
 * (spec §7: "discoverable, not folklore").
 */
export function HelpButton({ onShowHelp, className }: { onShowHelp: () => void; className?: string }) {
  const { t } = useUiTranslation();
  return (
    <button type="button" aria-label={t("shell.help.shortcuts")} onClick={onShowHelp} className={cn(CHROME_BUTTON, className)}>
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px]">
        <circle cx="10" cy="10" r="7.4" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M7.9 7.9a2.1 2.1 0 1 1 2.9 1.94c-.5.22-.8.7-.8 1.25v.31"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="10" cy="14.1" r="0.85" fill="currentColor" />
      </svg>
    </button>
  );
}

export interface ChromeActionsProps {
  /** Opens the shortcuts sheet. Omit and the help button is not rendered. */
  onShowHelp?: () => void;
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  className?: string;
}

/** The chrome controls as one cluster: help, language, appearance. */
export function ChromeActions({ onShowHelp, theme, onToggleTheme, className }: ChromeActionsProps) {
  const { t } = useUiTranslation();
  return (
    <div className={cn("flex flex-none items-center gap-[6px]", className)} aria-label={t("shell.bar.chromeActions")} role="group">
      {onShowHelp ? <HelpButton onShowHelp={onShowHelp} /> : null}
      <LanguageToggle />
      <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
    </div>
  );
}
