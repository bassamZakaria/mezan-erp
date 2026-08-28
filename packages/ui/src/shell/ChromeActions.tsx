import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import { LOCALE_SHORT_LABEL, useUiTranslation, type Locale } from "../i18n";
import { POPUP_Z_CLASS, usePopupPosition } from "./popup-position";
import type { NavGroup, NavItem } from "./types";

/**
 * The chrome's own controls — help, language and appearance.
 *
 * The settings gear used to sit here too. It was a third component drawing the
 * same fifteen screens the rail already carries as a workspace and ⌘K already
 * reaches by name, so الإعدادات now has exactly one home: the sidebar.
 */

/* No resting box: the icons sit straight on the chrome. The fill and the
   brighter ink appear on hover and focus, which is where they carry meaning —
   a bordered container around every glyph made the bar read as five buttons
   competing with the workspace column. */
/* The global focus ring is `--action` (teal) — on the teal chrome it is all but
   invisible, so every chrome control names the chrome's own gold instead. */
const CHROME_BUTTON =
  "flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center rounded-md border border-transparent bg-transparent text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink focus-visible:outline-chrome-accent";

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
