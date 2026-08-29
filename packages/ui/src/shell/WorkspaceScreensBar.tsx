import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { useTranslation } from "../i18n";
import { BAR_INSET } from "./metrics";
import { POPUP_Z_CLASS, usePopupPosition } from "./popup-position";
import type { NavGroup, NavItem, NavSection } from "./types";

/**
 * ROW TWO IS THE ACTIVE WORKSPACE'S OWN SCREENS — level two of the navigation.
 * The workspace column picks the job (البيع، الشراء، المخزون…), row two shows
 * what that job contains and changes with it. This is what makes ~118
 * destinations browsable instead of recallable: nothing here has to be typed.
 *
 *   [hub] [اليومي ▾] [البيانات الأساسية ▾] [التقارير ▾] [الإعدادات ▾] →
 *
 * — the workspace's own hub as a chip (it belongs to no section), then ONE
 * DROPDOWN PER SECTION, in the nav config's own order. The column stays a flat
 * list of the six jobs the business does, and the shelves inside a job open
 * from the bar: a workspace of 25 screens is four menus wide either way, and
 * every screen is at most two clicks from here.
 *
 * OVERFLOW — the strip scrolls, it never clips. `flex-wrap` would eat the
 * vertical budget the two-row bar already costs, so every cell stays on one
 * line (`flex-none`, `whitespace-nowrap`) inside a horizontally scrolling
 * row; the browser's own scrollbar is suppressed (`mz-scrollbar-none`, the
 * same convention the workspace column uses) so the strip reads as a place
 * rather than a widget. The active chip is scrolled into view whenever the
 * open screen changes, so a screen reached from elsewhere never leaves its
 * own bar showing nothing.
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

/**
 * التقارير NEVER flattens, however few reports a workspace has today.
 *
 * Reports are browsed by name from one known place — "where are the reports"
 * must have the same answer on every workspace — and the list grows: a
 * workspace with two reports this quarter has nine next quarter, and a shelf
 * that silently turns into tabs and back again as it grows is a moving target
 * for anyone who learned where it was.
 */
const ALWAYS_A_MENU = new Set(["reports"]);

/** A shelf this short reads better as tabs than as a caret hiding two rows. */
const FLATTEN_UP_TO = 4;

function isFlattenable(section: NavSection): boolean {
  return !ALWAYS_A_MENU.has(section.key) && section.items.length > 0 && section.items.length <= FLATTEN_UP_TO;
}

/**
 * TABS, NOT CHIPS (direction ت١). Bare text under a gold rule: a row of
 * bordered boxes read as five competing buttons and cost 12px of fill each,
 * and on a bar that is now the ONLY horizontal furniture in the shell the
 * screens have to read as a place, not as controls.
 *
 * "Current" is carried twice — the weight AND the rule — so it survives
 * greyscale and a colour-blind viewer; the rule is drawn as an explicit
 * element rather than `::after` so it can sit 1px BELOW the bar's own hairline
 * instead of anti-aliasing into it.
 */
const CHIP_BASE =
  "relative inline-flex min-h-[var(--h-btn)] flex-none items-center gap-[7px] whitespace-nowrap border-0 bg-transparent px-[13px] text-sm no-underline transition-colors";
const CHIP_IDLE = "text-ink-muted hover:text-ink";
const CHIP_ACTIVE = "font-semibold text-ink";
/** A section dropdown is a container, not a destination: same text, lighter ink. */
const CHIP_SECTION = "text-ink-muted hover:text-ink";

/** The gold rule that marks the open screen. */
function TabRule() {
  return <span aria-hidden className="absolute bottom-[-1px] inset-x-[9px] h-[3px] rounded-t-sm bg-accent" />;
}

function Caret() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-[10px] w-[10px] flex-none">
      <path d="m2.5 4.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
type Cell =
  | { kind: "screen"; id: string; item: NavItem; active: boolean }
  | { kind: "section"; id: string; section: NavSection; active: boolean };

export interface WorkspaceScreensBarProps {
  /** The active workspace. Its direct items (the hub) lead the row. */
  group?: NavGroup | null;
  /** The screen currently on display — its chip, or its section's menu, is marked. */
  activeKey?: string;
  ariaLabel: string;
  className?: string;
}

/**
 * Ground rule §2 — never colour alone — is met by the WEIGHT, not by a bar.
 * The active chip used to carry a 3px edge marker as well; against a chip that
 * is already gold-bordered, gold-filled, gold-inked and semibold it read as a
 * stray rule down one side rather than as a signal, and it fell on the visual
 * left of a right-to-left row.
 */
function chipContent(item: NavItem, active: boolean): ReactNode {
  return (
    <>
      {item.icon ? <span className="flex-none">{item.icon}</span> : null}
      {item.label}
      {item.tag ? (
        <span className="mz-num flex-none rounded-pill bg-surface-3 px-[6px] text-2xs leading-[16px] text-ink-faint">
          {item.tag.label}
        </span>
      ) : null}
      {active ? <TabRule /> : null}
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
  className,
}: WorkspaceScreensBarProps) {
  const { direction } = useTranslation();
  const rtl = direction === "rtl";
  const rowRef = useRef<HTMLDivElement | null>(null);

  const cells = useMemo<Cell[]>(() => {
    if (!group) return [];
    const out: Cell[] = group.items.map((item) => ({
      kind: "screen" as const,
      id: `item:${item.key}`,
      item,
      active: item.key === activeKey,
    }));
    for (const section of group.sections ?? []) {
      if (isFlattenable(section)) {
        // A short shelf becomes tabs. A dropdown that opens onto two rows costs
        // a click to show what would have fit on the bar, and hides where the
        // user already is behind a caret.
        for (const item of section.items) {
          out.push({ kind: "screen", id: `item:${item.key}`, item, active: item.key === activeKey });
        }
        continue;
      }
      out.push({
        kind: "section",
        id: `section:${section.key}`,
        section,
        // The menu carries the mark when the open screen is one of its rows —
        // otherwise a screen reached from a dropdown leaves the bar showing
        // nothing as current.
        active: section.items.some((item) => item.key === activeKey),
      });
    }
    return out;
  }, [group, activeKey]);

  /**
   * The strip is ONE Tab stop: `Tab` reaches the current chip, the arrow keys
   * walk the rest. Ten chips and menus that each took their own Tab stop would
   * put ten presses between the bar and the page it names.
   */
  const cellRefs = useRef<(HTMLElement | null)[]>([]);
  const activeCellIndex = cells.findIndex((cell) => cell.active);
  const rovingIndex = activeCellIndex >= 0 ? activeCellIndex : 0;

  /**
   * A screen reached from elsewhere (the column's «كل الشاشات», the command
   * palette, a link) can land on a chip the horizontal scroll has carried out
   * of view — this is what keeps the strip from ever "clipping it out of
   * reach": the moment it becomes current, it scrolls back into view.
   */
  useEffect(() => {
    if (activeCellIndex < 0) return;
    const cell = cellRefs.current[activeCellIndex];
    // jsdom has no layout engine and never implements `scrollIntoView`.
    if (typeof cell?.scrollIntoView === "function") {
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeCellIndex, group?.key]);

  function onStripKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const count = cells.length;
    if (count === 0) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      cellRefs.current[event.key === "Home" ? 0 : count - 1]?.focus();
      return;
    }
    const delta = step(event.key, rtl);
    if (delta === 0) return;
    event.preventDefault();
    const at = cellRefs.current.findIndex((el) => el === document.activeElement);
    const from = at >= 0 ? at : rovingIndex;
    cellRefs.current[((from + delta) % count + count) % count]?.focus();
  }

  function renderCell(cell: Cell, index: number) {
    const setRef = (el: HTMLElement | null) => {
      cellRefs.current[index] = el;
    };
    const tabIndex = index === rovingIndex ? 0 : -1;
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
                {cell.section.label}
                <Caret />
                {cell.active ? <TabRule /> : null}
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
        BAR_INSET,
        // The inline-start inset is shared with the header's scope switchers so
        // the first chip and the branch selector above it begin on one line.
        "relative flex items-center gap-[6px] border-b border-border bg-surface pe-[12px] py-[4px] text-ink",
        className,
      )}
    >
      {/*
        The row itself is the scroll container — `min-w-0` is what lets a flex
        child shrink below its content width and actually overflow instead of
        stretching the bar. The scrollbar is suppressed (`mz-scrollbar-none`)
        so the strip reads as a place, not a widget; wheel/trackpad/keyboard
        scrolling is untouched.
      */}
      <div ref={rowRef} className="mz-scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto">
        <ul onKeyDown={onStripKeyDown} className="flex flex-none items-center gap-[6px]">
          {cells.map(renderCell)}
        </ul>
      </div>
    </nav>
  );
}
