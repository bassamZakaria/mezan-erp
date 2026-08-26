import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";

export interface SelectOption<TValue extends string = string> {
  value: TValue;
  label: string;
  sublabel?: string;
  disabled?: boolean;
  group?: string;
}

export type SelectSize = "sm" | "md";
/** `chrome` tints the trigger for the dark navigation rail; the popup stays on the surface palette. */
export type SelectVariant = "default" | "chrome";

export interface SelectProps<TValue extends string = string> {
  value: TValue | "";
  onChange: (value: TValue) => void;
  options: ReadonlyArray<SelectOption<TValue>>;
  label?: string;
  "aria-label"?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  size?: SelectSize;
  variant?: SelectVariant;
  leadingIcon?: ReactNode;
  chevron?: boolean;
  id?: string;
  name?: string;
  className?: string;
  emptyMessage?: string;
  renderValue?: (option: SelectOption<TValue> | null) => ReactNode;
}

const SIZE_CLASS: Record<SelectSize, string> = {
  sm: "min-h-[34px] px-[10px] py-[7px] text-[12.5px]",
  md: "min-h-[38px] px-[11px] py-[9px] text-[13px]",
};

interface MenuPosition {
  top: number;
  inlineStart: number;
  width: number;
  maxHeight: number;
}

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 288;
const MENU_MIN_HEIGHT = 120;

function measure(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const rtl = getComputedStyle(trigger).direction === "rtl";
  const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - 8;
  const spaceAbove = rect.top - MENU_GAP - 8;
  const flipUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, flipUp ? spaceAbove : spaceBelow));
  return {
    top: flipUp ? rect.top - MENU_GAP - maxHeight : rect.bottom + MENU_GAP,
    // Measured physically, expressed logically, so the popup tracks the
    // trigger in both directions.
    inlineStart: rtl ? window.innerWidth - rect.right : rect.left,
    width: rect.width,
    maxHeight,
  };
}

/**
 * Select — the app's dropdown. A styled listbox that replaces the native
 * `<select>`, whose popup the OS paints outside the design system (wrong
 * fonts, wrong colours, no dark mode, LTR option list in an RTL app).
 *
 * Keyboard parity with the native control is deliberate: Enter/Space/Arrow
 * opens, arrows and Home/End move, printable characters jump by prefix,
 * Enter commits, Escape and Tab close.
 */
export function Select<TValue extends string = string>({
  value,
  onChange,
  options,
  label,
  "aria-label": ariaLabel,
  placeholder,
  disabled,
  required,
  invalid,
  size = "md",
  variant = "default",
  leadingIcon,
  chevron = true,
  id,
  name,
  className,
  emptyMessage,
  renderValue,
}: SelectProps<TValue>) {
  const { t } = useUiTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ query: string; at: number }>({ query: "", at: 0 });
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listboxId = `${generatedId}-listbox`;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? (options[selectedIndex] ?? null) : null;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { option: SelectOption<TValue>; index: number }[]>();
    options.forEach((option, index) => {
      const key = option.group ?? "";
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)!.push({ option, index });
    });
    return order.map((key) => ({ key, items: byGroup.get(key)! }));
  }, [options]);

  const reposition = useCallback(() => {
    if (triggerRef.current) setPosition(measure(triggerRef.current));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() {
      reposition();
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const node = menuRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openMenu(startAt: number) {
    if (disabled) return;
    setActive(startAt);
    setOpen(true);
  }

  function commit(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function step(from: number, delta: number): number {
    if (options.length === 0) return 0;
    let next = from;
    for (let i = 0; i < options.length; i += 1) {
      next += delta;
      if (next < 0) next = 0;
      if (next > options.length - 1) next = options.length - 1;
      if (!options[next]?.disabled) return next;
      if ((next === 0 && delta < 0) || (next === options.length - 1 && delta > 0)) break;
    }
    return from;
  }

  function edge(direction: "first" | "last"): number {
    if (direction === "first") {
      const found = options.findIndex((option) => !option.disabled);
      return found < 0 ? 0 : found;
    }
    for (let i = options.length - 1; i >= 0; i -= 1) {
      if (!options[i]?.disabled) return i;
    }
    return 0;
  }

  function jumpByPrefix(char: string, from: number) {
    const now = Date.now();
    const state = typeahead.current;
    state.query = now - state.at > 700 ? char : state.query + char;
    state.at = now;
    const query = state.query.toLowerCase();
    const total = options.length;
    for (let offset = 1; offset <= total; offset += 1) {
      const index = (from + offset) % total;
      const option = options[index];
      if (option && !option.disabled && option.label.toLowerCase().startsWith(query)) {
        if (open) setActive(index);
        else commit(index);
        return;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const current = open ? active : Math.max(selectedIndex, 0);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openMenu(selectedIndex >= 0 ? selectedIndex : edge("first"));
        else setActive(step(current, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openMenu(selectedIndex >= 0 ? selectedIndex : edge("last"));
        else setActive(step(current, -1));
        return;
      case "Home":
        if (!open) return;
        event.preventDefault();
        setActive(edge("first"));
        return;
      case "End":
        if (!open) return;
        event.preventDefault();
        setActive(edge("last"));
        return;
      case "Enter":
      case " ":
      case "Spacebar":
        event.preventDefault();
        if (!open) openMenu(selectedIndex >= 0 ? selectedIndex : edge("first"));
        else commit(active);
        return;
      case "Escape":
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          jumpByPrefix(event.key, current);
        }
    }
  }

  const triggerLabel = renderValue
    ? renderValue(selected)
    : (selected?.label ?? placeholder ?? t("ui.select.placeholder"));

  const menu =
    open && position
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[90] overflow-y-auto rounded-md border border-border bg-surface p-[6px] shadow-2"
            style={{
              top: position.top,
              insetInlineStart: position.inlineStart,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            <ul id={listboxId} role="listbox" aria-labelledby={triggerId} aria-activedescendant={`${listboxId}-${active}`}>
              {options.length === 0 ? (
                <li className="px-[10px] py-[10px] text-[12.5px] text-ink-faint">
                  {emptyMessage ?? t("ui.picker.empty")}
                </li>
              ) : (
                groups.map((group) => (
                  <li key={group.key || "__ungrouped"}>
                    {group.key ? (
                      <div className="px-[10px] pb-[4px] pt-[8px] text-[11px] font-semibold text-ink-faint">
                        {group.key}
                      </div>
                    ) : null}
                    <ul role="group" aria-label={group.key || undefined}>
                      {group.items.map(({ option, index }) => {
                        const isSelected = index === selectedIndex;
                        return (
                          <li
                            key={option.value}
                            id={`${listboxId}-${index}`}
                            role="option"
                            aria-selected={isSelected}
                            aria-disabled={option.disabled || undefined}
                            data-active={index === active}
                            onMouseEnter={() => !option.disabled && setActive(index)}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              commit(index);
                            }}
                            className={cn(
                              "flex cursor-pointer items-center justify-between gap-[10px] rounded-sm px-[10px] py-[8px] text-[13px] text-ink",
                              index === active && !option.disabled && "bg-surface-2",
                              isSelected && "bg-brand-soft text-brand",
                              option.disabled && "cursor-not-allowed text-ink-faint",
                            )}
                          >
                            <span className="flex min-w-0 flex-col gap-[1px]">
                              <span className={cn("truncate", isSelected && "font-semibold")}>{option.label}</span>
                              {option.sublabel ? (
                                <span className="truncate text-[11px] text-ink-faint">{option.sublabel}</span>
                              ) : null}
                            </span>
                            {isSelected ? <CheckIcon /> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={cn("relative", className)}>
      {label ? (
        <label htmlFor={triggerId} className="mb-[6px] block text-[12.5px] font-semibold text-ink">
          {label}
        </label>
      ) : null}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu(selectedIndex >= 0 ? selectedIndex : 0))}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex w-full items-center gap-[8px] rounded-md border text-start outline-none transition-colors",
          SIZE_CLASS[size],
          variant === "chrome"
            ? cn(
                "border-chrome-border bg-chrome-hover font-medium text-chrome-ink hover:border-chrome-accent",
                open && "border-chrome-accent",
              )
            : cn(
                "bg-surface text-ink hover:border-border-strong focus-visible:border-brand",
                invalid ? "border-danger" : "border-border",
                open && !invalid && "border-brand",
                disabled && "cursor-not-allowed bg-surface-3 text-ink-faint hover:border-border",
              ),
        )}
      >
        {leadingIcon}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !selected && !renderValue && (variant === "chrome" ? "text-chrome-ink-muted" : "text-ink-faint"),
          )}
        >
          {triggerLabel}
        </span>
        {chevron ? <ChevronIcon open={open} /> : null}
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {menu}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="14"
      height="14"
      className={cn("flex-none opacity-70 transition-transform", open && "rotate-180")}
    >
      <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width="13" height="13" className="flex-none">
      <path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
