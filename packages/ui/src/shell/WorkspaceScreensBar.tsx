import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { useFormat } from "../hooks/useFormat";
import { useTranslation } from "../i18n";
import { POPUP_Z_CLASS, usePopupPosition } from "./popup-position";
import type { NavGroup, NavItem, NavSection } from "./types";

/**
 * ROW TWO IS THE ACTIVE WORKSPACE'S OWN SCREENS — level two of the navigation.
 * The workspace column picks the job (البيع، الشراء، المخزون…), row two shows
 * what that job contains and changes with it. This is what makes ~118
 * destinations browsable instead of recallable: nothing here has to be typed.
 *
 * A workspace holds 12–25 screens, so they cannot all be chips. The shape:
 *
 *   [hub] [اليومي] chip chip chip … | [البيانات الأساسية ▾] [التقارير ▾] …
 *
 * — the workspace's own hub and its FIRST section (the daily work) as direct
 * chips, every later section as a labelled dropdown. Worst case (المخزون) is
 * one hub + five chips + four menus, and every screen is at most two clicks
 * from here.
 *
 * "First section" is derived from the nav config's own order, never matched by
 * name: `sell`, `daily`, `staff` and `access` all mean "the daily work" in
 * their own workspace, and a fifth name will be added by someone who never
 * reads this file.
 *
 * OVERFLOW — truncate to a «+٣» menu, never scroll. Ground rule §2.9 (125%
 * zoom, no sideways scroll) rules out growing the row, `flex-wrap` would eat
 * the vertical budget the two-row bar already costs, and a scrolled strip is
 * invisible in an app that hides every scrollbar — and is where browsers still
 * disagree about the sign of `scrollLeft` in RTL.
 */

/**
 * IN RTL THE ARROW KEYS INVERT. The physical key does not move — its meaning
 * does: on an RTL strip the previous chip is drawn to the RIGHT of the current
 * one, so ArrowRight must step BACK (-1) and ArrowLeft FORWARD (+1). Reversing
 * this is the single most common RTL keyboard defect; do not "simplify" it.
 * The workspace column is VERTICAL and therefore inverts nothing.
 */
function step(key: string, rtl: boolean): number {
  if (key === "ArrowRight") return rtl ? -1 : 1;
  if (key === "ArrowLeft") return rtl ? 1 : -1;
  return 0;
}

const GAP_PX = 6;
/** Sub-pixel slack so a rounding error never pushes the last chip past the row. */
const SAFETY_PX = 4;

const CHIP_BASE =
  "relative inline-flex min-h-[var(--h-btn)] flex-none items-center gap-[7px] whitespace-nowrap border px-[12px] text-xs no-underline";
const CHIP_IDLE = "border-border-strong bg-bg text-ink hover:bg-surface-2";
const CHIP_ACTIVE = "border-accent bg-accent-soft font-semibold text-accent";
/** A section dropdown reads as a container, not a destination — hence the recessed fill. */
const CHIP_SECTION = "border-border-strong bg-surface-2 text-ink hover:bg-surface-3";
const SECTION_LABEL = "flex-none whitespace-nowrap ps-[8px] pe-[2px] text-2xs text-ink-faint";

function Caret() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-[10px] w-[10px] flex-none">
      <path d="m2.5 4.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Cell =
  | { kind: "label"; id: string; text: string }
  | { kind: "screen"; id: string; item: NavItem; active: boolean }
  | { kind: "section"; id: string; section: NavSection; active: boolean };

export interface WorkspaceScreensBarProps {
  /** The active workspace. Its direct items lead, then its sections. */
  group?: NavGroup | null;
  /** The screen currently on display — its chip, or its section's menu, is marked. */
  activeKey?: string;
  ariaLabel: string;
  overflowLabel: string;
  className?: string;
}

function chipContent(item: NavItem, active: boolean): ReactNode {
  return (
    <>
      {/* Never colour alone: the current chip also carries this edge bar and a heavier weight. */}
      {active ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[3px] bg-accent" /> : null}
      {item.icon ? <span className="flex-none">{item.icon}</span> : null}
      {item.label}
      {item.tag ? (
        <span className="mz-num flex-none border border-current px-[4px] text-2xs leading-[15px]">{item.tag.label}</span>
      ) : null}
    </>
  );
}

interface MenuRowsProps {
  items: readonly NavItem[];
  activeKey?: string;
  close: () => void;
}

function MenuRows({ items, activeKey, close }: MenuRowsProps) {
  return (
    <>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            aria-current={active ? "page" : undefined}
            onClick={() => {
              item.onClick?.();
              close();
            }}
            className={cn(
              "flex min-h-[var(--h-btn)] w-full items-center gap-[8px] px-[12px] text-start text-xs transition-colors hover:bg-surface-2",
              active ? "bg-surface-2 font-semibold text-accent" : "text-ink",
            )}
          >
            <span aria-hidden className={cn("w-[7px] flex-none", active ? "text-accent" : "text-transparent")}>
              ◂
            </span>
            {item.icon ? <span className="flex-none">{item.icon}</span> : null}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </>
  );
}

interface BarMenuProps {
  label: string;
  triggerClassName: string;
  triggerContent: ReactNode;
  triggerAriaLabel?: string;
  /** Lets the strip's roving tabindex reach this trigger. */
  triggerRef?: (el: HTMLElement | null) => void;
  tabIndex?: number;
  children: (close: () => void) => ReactNode;
}

/**
 * A row-two dropdown. Portaled to `document.body` at `POPUP_Z_CLASS`: row two
 * lives inside a `sticky` header whose row one is `overflow-hidden`, and a
 * popup that stays inside that ancestor is confined to its stacking context
 * and clipped by its overflow no matter how high its own z-index goes.
 */
function BarMenu({ label, triggerClassName, triggerContent, triggerAriaLabel, triggerRef: exposeRef, tabIndex, children }: BarMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const position = usePopupPosition(triggerRef, open, "end");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
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

  // A vertical menu: ArrowUp/ArrowDown mean the same thing in both directions.
  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
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
        ref={(el) => {
          triggerRef.current = el;
          exposeRef?.(el);
        }}
        type="button"
        tabIndex={tabIndex}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {triggerContent}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKeyDown}
              className={cn("fixed min-w-[236px] overflow-y-auto border border-border-strong bg-surface py-[4px] shadow-2", POPUP_Z_CLASS)}
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

export function WorkspaceScreensBar({
  group,
  activeKey,
  ariaLabel,
  overflowLabel,
  className,
}: WorkspaceScreensBarProps) {
  const format = useFormat();
  const { direction } = useTranslation();
  const rtl = direction === "rtl";
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  const cells = useMemo<Cell[]>(() => {
    if (!group) return [];
    const out: Cell[] = [];
    for (const item of group.items) {
      out.push({ kind: "screen", id: `item:${item.key}`, item, active: item.key === activeKey });
    }
    const sections = group.sections ?? [];
    const [daily, ...rest] = sections;
    if (daily) {
      out.push({ kind: "label", id: `label:${daily.key}`, text: daily.label });
      for (const item of daily.items) {
        out.push({ kind: "screen", id: `item:${daily.key}:${item.key}`, item, active: item.key === activeKey });
      }
    }
    for (const section of rest) {
      out.push({
        kind: "section",
        id: `section:${section.key}`,
        section,
        active: section.items.some((item) => item.key === activeKey),
      });
    }
    return out;
  }, [group, activeKey]);

  const [visibleCount, setVisibleCount] = useState(cells.length);

  const recalculate = useCallback(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;

    // Zero width means the row is not laid out at all (jsdom, display:none, a
    // detached tree). Measuring there would hide every screen, so show all.
    const available = row.clientWidth - SAFETY_PX;
    if (available <= 0) {
      setVisibleCount(cells.length);
      return;
    }

    const widths = Array.from(measure.children).map((child) => (child as HTMLElement).offsetWidth);
    if (widths.length === 0 || widths.every((w) => w === 0)) {
      setVisibleCount(cells.length);
      return;
    }

    let used = 0;
    let count = 0;
    for (let i = 0; i < widths.length; i += 1) {
      const advance = (widths[i] ?? 0) + (i > 0 ? GAP_PX : 0);
      if (used + advance > available) break;
      used += advance;
      count += 1;
    }
    setVisibleCount(count);
  }, [cells.length]);

  useLayoutEffect(() => {
    recalculate();
  }, [recalculate, cells]);

  useEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => recalculate());
    observer.observe(row);
    // The measuring copy is observed too, and it is NOT redundant: the first
    // pass runs before the web font has swapped in, so every chip is measured
    // at fallback metrics. The row's own width never changes when the font
    // lands — the measuring copy's does, and that is what re-runs the fit.
    observer.observe(measure);
    return () => observer.disconnect();
  }, [recalculate]);

  // A section label with nothing left under it is noise — drop it with its group.
  let shown = Math.min(visibleCount, cells.length);
  while (shown > 0 && cells[shown - 1]?.kind === "label") shown -= 1;

  const visibleCells = cells.slice(0, shown);
  const hiddenCells = cells.slice(shown).filter((cell) => cell.kind !== "label");
  const hiddenScreens = hiddenCells.filter((cell): cell is Extract<Cell, { kind: "screen" }> => cell.kind === "screen");
  const hiddenSections = hiddenCells.filter((cell): cell is Extract<Cell, { kind: "section" }> => cell.kind === "section");
  const hiddenCount = hiddenScreens.length + hiddenSections.reduce((sum, cell) => sum + cell.section.items.length, 0);

  /**
   * The strip is ONE Tab stop: `Tab` reaches the current chip, the arrow keys
   * walk the rest. Ten chips and menus that each took their own Tab stop would
   * put ten presses between the bar and the page it names.
   */
  const cellRefs = useRef<(HTMLElement | null)[]>([]);
  const activeCellIndex = visibleCells.findIndex((cell) => cell.kind !== "label" && cell.active);
  const firstCellIndex = visibleCells.findIndex((cell) => cell.kind !== "label");
  const rovingIndex = activeCellIndex >= 0 ? activeCellIndex : firstCellIndex;

  function focusCell(index: number) {
    const stops = visibleCells.map((cell, at) => (cell.kind === "label" ? -1 : at)).filter((at) => at >= 0);
    if (stops.length === 0) return;
    const current = stops.indexOf(index);
    const wrapped = ((current % stops.length) + stops.length) % stops.length;
    cellRefs.current[stops[wrapped] ?? 0]?.focus();
  }

  function onStripKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const stops = visibleCells.map((cell, at) => (cell.kind === "label" ? -1 : at)).filter((at) => at >= 0);
    if (stops.length === 0) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      cellRefs.current[(event.key === "Home" ? stops[0] : stops[stops.length - 1]) ?? 0]?.focus();
      return;
    }
    const delta = step(event.key, rtl);
    if (delta === 0) return;
    event.preventDefault();
    const at = cellRefs.current.findIndex((el) => el === document.activeElement);
    const from = stops.indexOf(at >= 0 ? at : (rovingIndex ?? stops[0] ?? 0));
    const next = ((from + delta) % stops.length + stops.length) % stops.length;
    cellRefs.current[stops[next] ?? 0]?.focus();
  }

  function renderCell(cell: Cell, index: number) {
    const setRef = (el: HTMLElement | null) => {
      cellRefs.current[index] = el;
    };
    const tabIndex = index === rovingIndex ? 0 : -1;
    if (cell.kind === "label") {
      return (
        <li key={cell.id} className={SECTION_LABEL}>
          {cell.text}
        </li>
      );
    }
    if (cell.kind === "section") {
      return (
        <li key={cell.id} className="flex">
          <BarMenu
            label={cell.section.label}
            triggerRef={setRef}
            tabIndex={tabIndex}
            triggerClassName={cn(CHIP_BASE, cell.active ? CHIP_ACTIVE : CHIP_SECTION)}
            triggerContent={
              <>
                {cell.active ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[3px] bg-accent" /> : null}
                {cell.section.label}
                <Caret />
              </>
            }
          >
            {(close) => <MenuRows items={cell.section.items} activeKey={activeKey} close={close} />}
          </BarMenu>
        </li>
      );
    }
    const { item, active } = cell;
    const classes = cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE);
    return (
      <li key={cell.id} className="flex">
        {item.href ? (
          <a
            ref={setRef}
            href={item.href}
            tabIndex={tabIndex}
            aria-current={active ? "page" : undefined}
            className={classes}
            onClick={item.onClick}
          >
            {chipContent(item, active)}
          </a>
        ) : (
          <button
            ref={setRef}
            type="button"
            tabIndex={tabIndex}
            aria-current={active ? "page" : undefined}
            className={classes}
            onClick={item.onClick}
          >
            {chipContent(item, active)}
          </button>
        )}
      </li>
    );
  }

  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "relative flex items-center gap-[6px] overflow-hidden border-y border-border bg-surface px-[12px] py-[4px] text-ink",
        className,
      )}
    >
      <div ref={rowRef} className="flex min-w-0 flex-1 items-center">
        <ul onKeyDown={onStripKeyDown} className="flex flex-none items-center gap-[6px]">
          {visibleCells.map(renderCell)}
        </ul>
      </div>

      <div className="flex flex-none items-center gap-[6px]">
        {hiddenCount > 0 ? (
          <BarMenu
            label={overflowLabel}
            triggerAriaLabel={`${overflowLabel} (${format.number(hiddenCount)})`}
            triggerClassName={cn(CHIP_BASE, CHIP_IDLE, "min-w-[var(--h-btn)] justify-center")}
            triggerContent={<span className="mz-num">+{format.number(hiddenCount)}</span>}
          >
            {(close) => (
              <>
                {hiddenScreens.length > 0 ? (
                  <MenuRows items={hiddenScreens.map((cell) => cell.item)} activeKey={activeKey} close={close} />
                ) : null}
                {hiddenSections.map((cell) => (
                  <div key={cell.id} role="group" aria-label={cell.section.label}>
                    <div className="px-[12px] pb-[2px] pt-[8px] text-2xs font-semibold text-ink-faint">{cell.section.label}</div>
                    <MenuRows items={cell.section.items} activeKey={activeKey} close={close} />
                  </div>
                ))}
              </>
            )}
          </BarMenu>
        ) : null}
      </div>

      {/*
        Off-layout measuring copy. Every cell is rendered here at its natural
        width whether or not it is currently on the bar, so the fit calculation
        reads from a source that does NOT change when the bar truncates — which
        is what stops the count oscillating. `visibility:hidden` keeps it out of
        the accessibility tree and out of the tab order without `inert`.
      */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 start-0 flex w-max items-center gap-[6px]"
      >
        {cells.map((cell) =>
          cell.kind === "label" ? (
            <span key={cell.id} className={SECTION_LABEL}>
              {cell.text}
            </span>
          ) : cell.kind === "section" ? (
            <span key={cell.id} className={cn(CHIP_BASE, cell.active ? CHIP_ACTIVE : CHIP_SECTION)}>
              {cell.section.label}
              <Caret />
            </span>
          ) : (
            <span key={cell.id} className={cn(CHIP_BASE, cell.active ? CHIP_ACTIVE : CHIP_IDLE)}>
              {chipContent(cell.item, cell.active)}
            </span>
          ),
        )}
      </div>
    </nav>
  );
}
