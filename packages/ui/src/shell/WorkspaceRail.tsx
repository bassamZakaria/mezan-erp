import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "../lib/cn";
import { RAIL_WIDTH } from "./metrics";
import type { NavGroup, NavItem } from "./types";

/**
 * The workspace column — level one of the navigation (design direction ب,
 * `docs/artifacts/directions/nav-level.html`). ONLY THE WORKSPACES: read top to bottom
 * they are a plain list of the jobs the business does, which is what a new
 * employee can scan, and moving them off row one gives the chrome's own
 * controls room to stay visible instead of collapsing into a «⋯».
 *
 * The shelves inside a job (اليومي / البيانات الأساسية / التقارير / الإعدادات)
 * are NOT drawn here — they open as dropdowns on row two, so the column stays
 * the same short list however deep a workspace gets and never scrolls.
 *
 * A VERTICAL list, so the arrow keys are literal: ArrowDown is the next item in
 * BOTH directions. Nothing inverts here — that is row two's problem, because
 * row two is horizontal (see `WorkspaceScreensBar`).
 */

const ROW =
  "relative flex min-h-[var(--h-btn)] w-full items-center gap-[9px] px-[14px] text-start text-[13px] transition-colors hover:bg-chrome-hover";

export interface WorkspaceRailProps {
  /** The workspaces; only their names reach the column. */
  groups: readonly NavGroup[];
  /** The workspace the open screen belongs to; marked `aria-current`. */
  activeKey?: string;
  onChange?: (key: string) => void;
  /**
   * Single destinations that are not workspaces — الموافقات is the one — shown
   * above the list with their own badge. They live here rather than in the
   * chrome bar so every navigation target is in one column.
   */
  pinnedItems?: readonly NavItem[];
  /** The open SCREEN, for the pinned rows; workspaces use `activeKey`. */
  activeItemKey?: string;
  ariaLabel: string;
  /** «كل الشاشات» — below the divider, the browse-everything entry point. */
  allScreensLabel: string;
  onOpenAllScreens?: () => void;
  /** The brand lockup, pinned above the list — the column's own header. */
  brand?: ReactNode;
  /**
   * The column's own element, so the shell can trap focus in it while it is an
   * overlay. Unused above the breakpoint, where it is an ordinary column.
   */
  containerRef?: RefObject<HTMLElement | null>;
  /**
   * Fired after any navigation inside the column. The shell uses it to close
   * the drawer: a drawer that stays open over the screen it just navigated to
   * is the single most common way this pattern is got wrong.
   */
  onNavigate?: () => void;
  /**
   * THE FOOT: everything global — search, the working scope, appearance,
   * language, notifications, the user. It sits at the BOTTOM of the column
   * rather than in a bar of its own, because none of it is touched more than
   * once or twice a day and all of it used to cost a full-width band.
   */
  footer?: ReactNode;
  className?: string;
}

export function WorkspaceRail({
  groups,
  activeKey,
  onChange,
  pinnedItems = [],
  activeItemKey,
  ariaLabel,
  allScreensLabel,
  onOpenAllScreens,
  brand,
  footer,
  className,
  containerRef,
  onNavigate,
}: WorkspaceRailProps) {
  const refs = useRef<(HTMLElement | null)[]>([]);

  const activeIndex = groups.findIndex((group) => group.key === activeKey);
  const rovingIndex = activeIndex >= 0 ? activeIndex : 0;

  function focusAt(index: number) {
    const count = groups.length;
    if (count === 0) return;
    refs.current[((index % count) + count) % count]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (groups.length === 0) return;
    event.preventDefault();
    if (event.key === "Home") return focusAt(0);
    if (event.key === "End") return focusAt(groups.length - 1);
    const current = refs.current.findIndex((el) => el === document.activeElement);
    focusAt((current >= 0 ? current : rovingIndex) + (event.key === "ArrowDown" ? 1 : -1));
  }

  return (
    <nav
      ref={containerRef as RefObject<HTMLElement> | undefined}
      aria-label={ariaLabel}
      className={cn(
        RAIL_WIDTH,
        "flex flex-none flex-col border-e border-chrome-border text-chrome-ink shadow-chrome",
        "bg-[linear-gradient(190deg,var(--chrome),var(--chrome-2))]",
        className,
      )}
    >
      {/*
        EXACTLY ONE VIEWPORT TALL, and sticky at the top — the column is now the
        only chrome, carrying the brand at its head and every global control at
        its foot. `h-screen` rather than min/max: the foot must land ON the
        bottom edge, and the workspace list (`flex-1 overflow-y-auto` below)
        absorbs whatever is left, so a long list scrolls inside the column
        instead of pushing the user menu off the end of the screen.

        `overflow-y-auto` ALSO sits on this outer box, not only on the list: on
        a short enough viewport the brand + pinned rows + foot alone (every
        `flex-none` sibling of the list) can exceed one viewport even after the
        list has shrunk to nothing. Without an escape valve here that excess is
        `overflow: visible` past a `position: sticky` box — content the page
        never scrolls into, because the sticky box re-pins to `top: 0` on every
        scroll tick. Giving the box its own scroll turns that into an ordinary,
        reachable overflow instead of a permanently hidden one. `mz-scrollbar-none`
        keeps that fallback bar invisible; it only ever renders in that
        pathological case.
      */}
      <div className="mz-scrollbar-none sticky top-0 flex h-screen flex-col overflow-y-auto pb-[10px]">
        {brand}

        {pinnedItems.length > 0 ? (
          <>
            <ul className="flex-none pt-[4px]">
              {pinnedItems.map((item) => {
                const active = item.key === activeItemKey;
                return (
                  <li key={item.key} className="flex">
                    <button
                      type="button"
                      onClick={item.onClick}
                      onPointerEnter={item.onIntent}
                      onFocus={item.onIntent}
                      // The badge is a bare number, so the count is spelled out
                      // in the accessible name.
                      aria-label={item.tag ? `${item.label} (${item.tag.label})` : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        ROW,
                        active ? "bg-chrome-active font-semibold text-chrome-ink" : "text-chrome-ink-muted",
                      )}
                    >
                      {active ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[2px] bg-chrome-accent" /> : null}
                      {item.icon ? <span className="flex-none">{item.icon}</span> : null}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.tag ? (
                        <span className="mz-num flex-none rounded-pill bg-chrome-accent px-[6px] text-2xs font-bold leading-[16px] text-chrome">
                          {item.tag.label}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div aria-hidden className="mx-[12px] my-[8px] h-px flex-none bg-chrome-border" />
          </>
        ) : null}

        {/*
          `min-h-[88px]` (two rows) rather than `min-h-0`: on a viewport short
          enough that the fixed chrome above and below already exceeds it, a
          bare `min-h-0` lets this list collapse all the way to nothing — the
          list itself would then have no box to scroll, so its own entries
          become unreachable through even the outer fallback scroll (an empty
          box has nothing to scroll into view). Two rows keeps it a real,
          visibly scrollable list in every case; the outer box's own scroll
          (see above) picks up whatever this floor pushes past the viewport.
        */}
        <ul onKeyDown={onKeyDown} className="mz-scrollbar-none min-h-[88px] flex-1 overflow-y-auto">
          {groups.map((group, index) => {
            const active = group.key === activeKey;
            return (
              <li key={group.key} className="flex">
                <button
                  ref={(el) => {
                    refs.current[index] = el;
                  }}
                  type="button"
                  tabIndex={index === rovingIndex ? 0 : -1}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    ROW,
                    active ? "bg-chrome-active font-semibold text-chrome-ink" : "text-chrome-ink-muted",
                  )}
                  onClick={() => { onChange?.(group.key); onNavigate?.(); }}
                  onPointerEnter={group.onIntent}
                  onFocus={group.onIntent}
                >
                  {/* Never colour alone: the open workspace also carries this
                      inline-start bar, the recessed fill and a heavier weight. */}
                  {active ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[2px] bg-chrome-accent" /> : null}
                  {group.icon ? <span className="flex-none">{group.icon}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div aria-hidden className="mx-[12px] my-[8px] h-px flex-none bg-chrome-border" />

        <button type="button" onClick={() => { onOpenAllScreens?.(); onNavigate?.(); }} className={cn(ROW, "flex-none text-chrome-ink-muted hover:text-chrome-ink")}>
          <span aria-hidden className="flex-none">
            ☰
          </span>
          <span className="truncate">{allScreensLabel}</span>
        </button>

        {footer}
      </div>
    </nav>
  );
}
