import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { latinLetter } from "../lib/keys";
import { useUiTranslation } from "../i18n";
import { Kbd, modKeyLabel } from "../primitives/Kbd";
import type { CommandItem } from "./types";

export interface CommandBarProps {
  items: CommandItem[];
  placeholder?: string;
  className?: string;
  /** Results open above the field — for the field's home at the column's foot. */
  openUp?: boolean;
}

/**
 * CommandBar — the topbar's always-visible command surface (spec §5, §7).
 * `⌘K` / `Ctrl+K` focuses it from anywhere; typing filters, the arrows move
 * the highlight, Enter runs the highlighted command and Escape dismisses the
 * results without leaving the field.
 */
export function CommandBar({ items, placeholder, className, openUp }: CommandBarProps) {
  const { t } = useUiTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && latinLetter(event) === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setHighlight(0);
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

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

  function run(item: CommandItem) {
    item.onSelect();
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="flex items-center gap-[10px] rounded-md border border-chrome-border bg-chrome-hover px-[13px] py-[8px] transition-colors focus-within:border-chrome-accent hover:border-chrome-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-chrome-accent">
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[16px] w-[16px] flex-none text-chrome-ink-muted">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[highlight] ? `${listId}-${highlight}` : undefined}
          aria-label={t("shell.palette.title")}
          value={query}
          placeholder={placeholder ?? t("shell.command.placeholder")}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const item = filtered[highlight];
              if (item) run(item);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-chrome-ink outline-none placeholder:text-chrome-ink-muted"
        />
        <Kbd keys={[modKeyLabel(), "K"]} tone="chrome" />
      </div>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t("shell.palette.title")}
          className={cn(
            "absolute inset-x-0 z-40 max-h-[min(420px,60vh)] animate-[mz-fade-in_160ms_ease_both] overflow-y-auto rounded-md border border-border bg-surface p-[6px] shadow-2",
            openUp ? "bottom-[calc(100%+7px)]" : "top-[calc(100%+7px)]",
          )}
        >
          {filtered.length === 0 ? (
            <p className="px-[11px] py-[14px] text-sm text-ink-faint">{t("shell.palette.empty")}</p>
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
                        "flex w-full items-center gap-[10px] rounded-sm px-[10px] py-[9px] text-start text-sm transition-colors",
                        // Gold marks "current" on every other surface — the screens
                        // bar, «كل الشاشات», the breadcrumb. Teal here made one state
                        // two colours depending on which control you were looking at.
                        index === highlight ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-2",
                      )}
                    >
                      {item.icon ? <span className="flex-none text-ink-faint">{item.icon}</span> : null}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint ? (
                        <Kbd keys={item.hint} className="ms-auto" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
