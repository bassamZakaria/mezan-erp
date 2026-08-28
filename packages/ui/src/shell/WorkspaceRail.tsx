import { useRef, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import type { NavGroup, NavItem } from "./types";

/**
 * The workspace column — level one of the navigation (design direction ب,
 * `design/directions/nav-level.html`). ONLY THE WORKSPACES: read top to bottom
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
  className,
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
      aria-label={ariaLabel}
      className={cn(
        "flex w-[200px] flex-none flex-col border-e border-chrome-border text-chrome-ink shadow-chrome",
        "bg-[linear-gradient(190deg,var(--chrome),var(--chrome-2))]",
        className,
      )}
    >
      {/*
        The column stretches so its border runs the whole page, but its CONTENTS
        stick under row one: the column and the workspace-screens bar share a top
        edge (see `AppShell`), and a rail that scrolled away would leave that
        shared edge attached to a blank 200px strip. `--h-topbar` is row one's own
        height, which is the button height plus the padding that keeps the chrome
        controls off its edges.
        The list scrolls inside that sticky box once the open workspace's
        sections push it past the viewport.
      */}
      <div className="sticky top-[var(--h-topbar)] flex max-h-[calc(100vh-var(--h-topbar))] flex-col py-[8px]">
        {pinnedItems.length > 0 ? (
          <>
            <ul className="flex-none">
              {pinnedItems.map((item) => {
                const active = item.key === activeItemKey;
                return (
                  <li key={item.key} className="flex">
                    <button
                      type="button"
                      onClick={item.onClick}
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

        <ul onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto">
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
                  onClick={() => onChange?.(group.key)}
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

        <button type="button" onClick={onOpenAllScreens} className={cn(ROW, "flex-none text-chrome-ink-muted hover:text-chrome-ink")}>
          <span aria-hidden className="flex-none">
            ☰
          </span>
          <span className="truncate">{allScreensLabel}</span>
        </button>
      </div>
    </nav>
  );
}
