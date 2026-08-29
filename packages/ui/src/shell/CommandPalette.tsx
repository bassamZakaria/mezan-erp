import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { latinLetter } from "../lib/keys";
import { useUiTranslation } from "../i18n";
import { Kbd, modKeyLabel } from "../primitives/Kbd";
import type { CommandItem } from "./types";

/**
 * ⌘K — a MODAL, the same shape as «كل الشاشات».
 *
 * It used to be a field living in the chrome, which forced two compromises:
 * the field had to be narrow enough to share a bar (250px, then 180px under
 * 1280), and its results hung from it as an absolutely positioned dropdown
 * that the bar's own `overflow-hidden` could clip. As a dialog it owns the
 * middle of the screen, so a result row can carry its group and its shortcut
 * without truncating, and nothing in the shell can cut it off.
 *
 * The trigger in the column's foot is a BUTTON, not an input: there is no
 * typing surface until the dialog is open, so a click and `⌘K` land in exactly
 * the same place.
 */
export interface CommandPaletteProps {
  items: CommandItem[];
  open: boolean;
  onClose: () => void;
  placeholder?: string;
}

const FOCUS_DELAY_MS = 0;

export function CommandPalette({ items, open, onClose, placeholder }: CommandPaletteProps) {
  const { t } = useUiTranslation();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlight(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? items : items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  if (!open) return null;

  function run(item: CommandItem) {
    item.onSelect();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-[16px] pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(560px,70vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2"
      >
        <h2 id={titleId} className="sr-only">
          {t("shell.palette.title")}
        </h2>

        <div className="flex flex-none items-center gap-[10px] border-b border-border px-[14px] py-[12px]">
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px] flex-none text-ink-faint">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered[highlight] ? `${listId}-${highlight}` : undefined}
            aria-label={t("shell.palette.title")}
            value={query}
            placeholder={placeholder ?? t("shell.command.placeholder")}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = filtered[highlight];
                if (item) run(item);
              }
            }}
            className="min-w-0 flex-1 border-none bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
          />
          <Kbd keys={["Esc"]} />
        </div>

        <div id={listId} role="listbox" aria-label={t("shell.palette.title")} className="min-h-0 flex-1 overflow-y-auto p-[6px]">
          {filtered.length === 0 ? (
            <p className="px-[11px] py-[18px] text-sm text-ink-faint">{t("shell.palette.empty")}</p>
          ) : (
            groups.map(([groupName, groupItems]) => (
              <div key={groupName}>
                <div className="mz-eyebrow px-[10px] pb-[4px] pt-[8px] text-ink-faint">{groupName}</div>
                {groupItems.map((item) => {
                  const index = filtered.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === highlight}
                      type="button"
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => run(item)}
                      className={cn(
                        "flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[10px] text-start text-sm transition-colors",
                        // Gold marks "current" everywhere else in the shell; teal
                        // here would make one state two colours.
                        index === highlight ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-2",
                      )}
                    >
                      {item.icon ? <span className="flex-none text-ink-faint">{item.icon}</span> : null}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint ? <Kbd keys={item.hint} className="ms-auto" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-none items-center gap-[12px] border-t border-border px-[14px] py-[8px] text-2xs text-ink-faint">
          <span>{t("shell.palette.hint.move")}</span>
          <span>{t("shell.palette.hint.open")}</span>
          <span className="ms-auto">
            <Kbd keys={[modKeyLabel(), "K"]} />
          </span>
        </div>
      </div>
    </div>
  );
}

/** The foot's search row — a button, because the typing surface is the dialog. */
export function CommandTrigger({
  onOpen,
  className,
  compact = false,
}: {
  onOpen: () => void;
  className?: string;
  /**
   * Icon only, sized and styled as one of the foot's utility controls.
   *
   * The full-width box spent a whole row of the column on a control the
   * keyboard already reaches from anywhere. Collapsed to a glyph it joins the
   * row it belongs with and gives the row back to the workspace list, which is
   * the thing that actually overflows.
   *
   * The label and the shortcut do not disappear — they move into the
   * accessible name and the tooltip, because a magnifier alone does not say
   * «بحث وأوامر» and certainly does not say ⌘K.
   */
  compact?: boolean;
}) {
  const { t } = useUiTranslation();
  const label = t("shell.command.trigger");

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${label} (${modKeyLabel()}K)`}
        title={`${label} (${modKeyLabel()}K)`}
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center rounded-md",
          "border border-transparent bg-transparent text-chrome-ink-muted transition-colors",
          "hover:bg-chrome-hover hover:text-chrome-ink focus-visible:outline-chrome-accent",
          className,
        )}
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[18px] w-[18px]">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-[38px] w-full items-center gap-[8px] rounded-md border border-chrome-border bg-chrome-hover px-[10px]",
        "text-start text-xs text-chrome-ink-muted transition-colors hover:border-chrome-accent hover:text-chrome-ink",
        "focus-visible:outline-chrome-accent",
        className,
      )}
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] flex-none">
        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Kbd keys={[modKeyLabel(), "K"]} tone="chrome" />
    </button>
  );
}

/** `⌘K` / `Ctrl+K` from anywhere. Lives here so the shortcut and the dialog cannot drift apart. */
export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && latinLetter(event) === "k") {
        event.preventDefault();
        onOpen();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}
