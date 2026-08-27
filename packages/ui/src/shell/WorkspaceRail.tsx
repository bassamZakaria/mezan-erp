import { useRef, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import type { NavGroup } from "./types";

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
  "relative flex min-h-[var(--h-btn)] w-full items-center gap-[9px] px-[14px] text-start text-[13px] transition-colors hover:bg-surface-2";

export interface WorkspaceRailProps {
  /** The workspaces; only their names reach the column. */
  groups: readonly NavGroup[];
  /** The workspace the open screen belongs to; marked `aria-current`. */
  activeKey?: string;
  onChange?: (key: string) => void;
  /** «مساحات العمل» — the visible column heading, and the list's own name. */
  heading: string;
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
  heading,
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
      className={cn("flex w-[200px] flex-none flex-col border-e border-border-strong bg-surface text-ink", className)}
    >
      {/*
        The column stretches so its border runs the whole page, but its CONTENTS
        stick under row one: the column and the workspace-screens bar share a top
        edge (see `AppShell`), and a rail that scrolled away would leave that
        shared edge attached to a blank 200px strip. `--h-btn` is row one's own
        height — its tallest child sets it and the row carries no block padding.
        The list scrolls inside that sticky box once the open workspace's
        sections push it past the viewport.
      */}
      <div className="sticky top-[var(--h-btn)] flex max-h-[calc(100vh-var(--h-btn))] flex-col py-[8px]">
        <div className="flex-none px-[14px] pb-[4px] pt-[8px] text-2xs font-semibold text-ink-faint">{heading}</div>

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
                  className={cn(ROW, active ? "bg-surface-2 font-semibold text-ink" : "text-ink")}
                  onClick={() => onChange?.(group.key)}
                >
                  {/* Never colour alone: the open workspace also carries this
                      inline-start bar, the recessed fill and a heavier weight. */}
                  {active ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[2px] bg-accent" /> : null}
                  {group.icon ? <span className="flex-none">{group.icon}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div aria-hidden className="mx-[12px] my-[8px] h-px flex-none bg-border" />

        <button type="button" onClick={onOpenAllScreens} className={cn(ROW, "flex-none text-ink-muted hover:text-ink")}>
          <span aria-hidden className="flex-none">
            ☰
          </span>
          <span className="truncate">{allScreensLabel}</span>
        </button>
      </div>
    </nav>
  );
}
