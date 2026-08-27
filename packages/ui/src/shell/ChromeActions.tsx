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

const CHROME_BUTTON =
  "flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center border border-chrome-border bg-chrome-hover text-chrome-ink-muted transition-colors hover:bg-chrome-active hover:text-chrome-ink";

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

export interface UtilityMenuProps {
  groups: readonly NavGroup[];
  /** Highlights the matching row, mirroring the bar's active chip. */
  activeNavKey?: string;
}

/** The gear menu — settings and system, grouped, opened from the top bar. */
export function UtilityMenu({ groups, activeNavKey }: UtilityMenuProps) {
  const { t } = useUiTranslation();
  const label = t("shell.utility.menu");
  return (
    <ChromeMenu
      label={label}
      glyph={
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
      }
    >
      {(close) => (
        <>
          {groups.map((group) => (
            <div key={group.key} className="border-b border-border last:border-b-0">
              <div className="px-[14px] pb-[4px] pt-[10px] text-2xs font-bold text-ink-faint">{group.label}</div>
              <ul className="pb-[6px]">
                {group.items.map((item) => (
                  <UtilityMenuRow key={item.key} item={item} active={item.key === activeNavKey} close={close} />
                ))}
              </ul>
              {/* الإعدادات keeps all but one of its screens in sections; listing
                  `items` alone hides fifteen of them from this menu entirely. */}
              {(group.sections ?? []).map((section) => (
                <div key={section.key}>
                  <div className="px-[14px] pb-[2px] pt-[4px] text-2xs font-semibold text-ink-faint">{section.label}</div>
                  <ul className="pb-[6px]">
                    {section.items.map((item) => (
                      <UtilityMenuRow key={item.key} item={item} active={item.key === activeNavKey} close={close} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </ChromeMenu>
  );
}

export interface ChromeActionsProps {
  /** Settings and system, grouped — rendered behind the gear. Omit to drop the gear. */
  utilityGroups?: readonly NavGroup[];
  activeNavKey?: string;
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  className?: string;
}

/** The three chrome controls as one cluster: gear, language, appearance. */
export function ChromeActions({ utilityGroups = [], activeNavKey, theme, onToggleTheme, className }: ChromeActionsProps) {
  const { t } = useUiTranslation();
  return (
    <div className={cn("flex flex-none items-center gap-[6px]", className)} aria-label={t("shell.bar.chromeActions")} role="group">
      {utilityGroups.length > 0 ? <UtilityMenu groups={utilityGroups} activeNavKey={activeNavKey} /> : null}
      <LanguageToggle />
      <ThemeToggle theme={theme} onToggleTheme={onToggleTheme} />
    </div>
  );
}
