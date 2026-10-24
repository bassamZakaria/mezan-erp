import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { matchesSearch } from "../lib/search";
import { useUiTranslation } from "../i18n";

export interface EntityPickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

export interface EntityPickerProps {
  label?: string;
  value: EntityPickerOption | null;
  onChange: (option: EntityPickerOption | null) => void;
  options: EntityPickerOption[];
  placeholder?: string;
  disabled?: boolean;
  emptyMessage?: string;
  id?: string;
  className?: string;
  /** The accessible name when there is no visible `label` (a picker inside a table row). */
  ariaLabel?: string;
  /**
   * Server search: the caller fetches matches for each query and passes them as `options`, shown unfiltered.
   * `loading` MUST stay true until `options` answer the current query, or Enter would bind a row of the previous search.
   */
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  error?: boolean;
}

/**
 * EntityPicker — a searchable combobox for choosing a customer / account /
 * item / cost center. A minimal accessible combobox: type to filter, arrow
 * keys to move the highlight, Enter to select, Escape to close.
 */
export function EntityPicker({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  emptyMessage,
  id,
  className,
  ariaLabel,
  onQueryChange,
  loading = false,
  error = false,
}: EntityPickerProps) {
  const { t } = useUiTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chosenRowId, setChosenRowId] = useState<string | null>(null);
  const [enterQueued, setEnterQueued] = useState(false);
  const listboxId = useId();
  const labelId = useId();
  const generatedInputId = useId();
  const inputId = id ?? generatedInputId;
  const containerRef = useRef<HTMLDivElement>(null);

  const serverMode = onQueryChange !== undefined;
  const stale = serverMode && (loading || error);
  const filtered = serverMode ? (stale ? [] : options) : options.filter((option) => matchesSearch(query, option.label, option.sublabel));
  const firstFresh = filtered[0];

  useEffect(() => {
    if (enterQueued && error) setEnterQueued(false);
  }, [enterQueued, error]);

  const navigated = chosenRowId !== null;
  const enterOnlyOpens = !navigated && query.trim() === "" && (serverMode || value !== null);
  const highlight = navigated ? filtered.findIndex((option) => option.id === chosenRowId) : enterOnlyOpens ? -1 : 0;

  useEffect(() => {
    if (open && highlight >= 0) document.getElementById(`${listboxId}-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, listboxId]);

  useEffect(() => {
    if (!enterQueued || stale) return;
    setEnterQueued(false);
    if (firstFresh) select(firstFresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterQueued, stale, firstFresh]);

  function changeQuery(next: string) {
    setQuery(next);
    setEnterQueued(false);
    setChosenRowId(null);
    onQueryChange?.(next);
  }

  function select(option: EntityPickerOption) {
    onChange(option);
    changeQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      const next = event.key === "ArrowDown" ? Math.min(highlight + 1, filtered.length - 1) : Math.max(highlight - 1, 0);
      if (next !== highlight) setChosenRowId(filtered[next]?.id ?? null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!open || enterOnlyOpens) {
        setOpen(true);
        return;
      }
      if (stale) {
        if (!error && !navigated) setEnterQueued(true);
        return;
      }
      const option = filtered[highlight];
      if (option) select(option);
    } else if (event.key === "Escape") {
      setEnterQueued(false);
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label ? (
        <label id={labelId} htmlFor={inputId} className="mb-[6px] block text-xs font-semibold text-ink-muted">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        role="combobox"
        aria-label={label ? undefined : ariaLabel}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        aria-busy={stale && !error}
        aria-activedescendant={open && filtered[highlight] ? `${listboxId}-${highlight}` : undefined}
        disabled={disabled}
        placeholder={placeholder ?? t("ui.search.placeholder")}
        // A chosen entity is the field's VALUE, not its placeholder: rendering
        // it in placeholder ink made a bound picker read as empty.
        value={open ? query : (value?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setChosenRowId(null);
        }}
        onMouseDown={() => {
          if (open) return;
          setOpen(true);
          setChosenRowId(null);
        }}
        onBlur={() => {
          setEnterQueued(false);
          setOpen(false);
        }}
        onChange={(event) => {
          const typed = event.target.value;
          const shown = value?.label ?? "";
          setOpen(true);
          changeQuery(!open && shown !== "" && typed.startsWith(shown) ? typed.slice(shown.length) : typed);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
      {open && !disabled ? (
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="absolute start-0 end-0 z-10 mt-[6px] max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-[6px] shadow-2"
        >
          <p role="status" className={filtered.length === 0 ? "px-[10px] py-[10px] text-[12.5px] text-ink-faint" : "sr-only"}>
            {filtered.length > 0 ? "" : error ? t("ui.picker.error") : stale ? t("ui.picker.loading") : (emptyMessage ?? t("ui.picker.empty"))}
          </p>
          <ul id={listboxId} role="listbox" aria-busy={stale && !error} aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : ariaLabel}>
            {filtered.map((option, index) => (
              <li key={option.id} id={`${listboxId}-${index}`} role="option" aria-selected={value?.id === option.id} onClick={() => select(option)}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    if (event.button === 0) select(option);
                  }}
                  className={cn(
                    "flex w-full flex-col items-start gap-[1px] rounded-sm px-[10px] py-[8px] text-start text-[13px]",
                    index === highlight ? "bg-brand-soft text-brand" : "text-ink hover:bg-surface-2",
                  )}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.sublabel ? <span className="text-[11px] text-ink-faint">{option.sublabel}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
