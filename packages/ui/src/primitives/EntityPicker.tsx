import { useId, useRef, useState, type KeyboardEvent } from "react";
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
}: EntityPickerProps) {
  const { t } = useUiTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listboxId = useId();
  const generatedInputId = useId();
  const inputId = id ?? generatedInputId;
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = options.filter((option) => matchesSearch(query, option.label, option.sublabel));

  function select(option: EntityPickerOption) {
    onChange(option);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[highlight];
      if (option) select(option);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {label ? (
        <label htmlFor={inputId} className="mb-[6px] block text-xs font-semibold text-ink-muted">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        disabled={disabled}
        placeholder={placeholder ?? t("ui.search.placeholder")}
        // A chosen entity is the field's VALUE, not its placeholder: rendering
        // it in placeholder ink made a bound picker read as empty.
        value={open ? query : (value?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setHighlight(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
      {open && !disabled ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute start-0 end-0 z-10 mt-[6px] max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-[6px] shadow-2"
        >
          {filtered.length === 0 ? (
            <li className="px-[10px] py-[10px] text-[12.5px] text-ink-faint">{emptyMessage ?? t("ui.picker.empty")}</li>
          ) : (
            filtered.map((option, index) => (
              <li key={option.id} role="option" aria-selected={value?.id === option.id}>
                <button
                  type="button"
                  // onMouseDown fires before the input's onBlur, so selection isn't lost.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    select(option);
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
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
