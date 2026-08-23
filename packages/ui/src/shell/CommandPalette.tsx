import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import type { CommandItem } from "./types";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
}

/** CommandPalette — the Ctrl K search modal. Groups items, filters by query, arrow-key navigable. */
export function CommandPalette({ open, onOpenChange, items, placeholder }: CommandPaletteProps) {
  const { t } = useUiTranslation();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) setQuery("");
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

  function runHighlighted() {
    const item = filtered[highlight];
    if (item) {
      item.onSelect();
      onOpenChange(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pb-4 pt-[9vh]">
      <div aria-hidden="true" onClick={() => onOpenChange(false)} className="fixed inset-0 bg-[rgba(8,18,14,0.5)] backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.palette.title")}
        className="relative flex max-h-[82vh] w-[660px] max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2"
      >
        <div className="flex items-center gap-[11px] border-b border-border px-[19px] py-[15px]">
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px] text-ink-faint">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            autoFocus
            value={query}
            placeholder={placeholder ?? t("shell.palette.placeholder")}
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
                runHighlighted();
              } else if (event.key === "Escape") {
                onOpenChange(false);
              }
            }}
            className="flex-1 border-none bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="mz-lat rounded-[5px] border border-border-strong bg-surface px-[6px] py-[2px] font-mono text-[10px] text-ink-faint">
            Esc
          </span>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-[8px]">
          {filtered.length === 0 ? (
            <p className="px-[11px] py-[16px] text-[13px] text-ink-faint">{t("shell.palette.empty")}</p>
          ) : (
            groups.map(([groupName, groupItems]) => (
              <div key={groupName}>
                <div className="px-[11px] pb-[5px] pt-[9px] text-[10px] font-bold uppercase tracking-[1px] text-ink-faint">{groupName}</div>
                {groupItems.map((item) => {
                  const index = filtered.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => {
                        item.onSelect();
                        onOpenChange(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-[11px] rounded-md px-[11px] py-[10px] text-start text-[13.5px]",
                        index === highlight ? "bg-brand-soft text-brand" : "text-ink hover:bg-surface-2",
                      )}
                    >
                      {item.icon ? <span className="flex-none text-ink-faint">{item.icon}</span> : null}
                      <span className="flex-1">{item.label}</span>
                      {item.hint ? <span className="ms-auto text-[10px] text-ink-faint">{item.hint}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
