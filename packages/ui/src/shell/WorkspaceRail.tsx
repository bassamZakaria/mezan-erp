import { useRef, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import type { NavItem } from "./types";

/**
 * The workspace column — level one of the navigation (design direction ب,
 * `design/directions/nav-level.html`). The six workspaces read as a vertical
 * list here rather than as tabs in the top bar: read top to bottom they are a
 * plain list of the six jobs the business does, which is what a new employee
 * can scan, and moving them off row one gives the chrome's own controls room to
 * stay visible instead of collapsing into a «⋯».
 *
 * A VERTICAL list, so the arrow keys are literal: ArrowDown is the next item in
 * BOTH directions. Nothing inverts here — that is row two's problem, because
 * row two is horizontal (see `WorkspaceScreensBar`).
 */

const ROW =
  "relative flex min-h-[var(--h-btn)] w-full items-center gap-[9px] px-[14px] text-start text-[13px] transition-colors hover:bg-surface-2";

export interface WorkspaceRailProps {
  items: readonly NavItem[];
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
  items,
  activeKey,
  onChange,
  heading,
  ariaLabel,
  allScreensLabel,
  onOpenAllScreens,
  className,
}: WorkspaceRailProps) {
  const refs = useRef<(HTMLElement | null)[]>([]);

  const activeIndex = items.findIndex((item) => item.key === activeKey);
  const rovingIndex = activeIndex >= 0 ? activeIndex : 0;

  function focusAt(index: number) {
    const count = items.length;
    if (count === 0) return;
    refs.current[((index % count) + count) % count]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (items.length === 0) return;
    event.preventDefault();
    if (event.key === "Home") return focusAt(0);
    if (event.key === "End") return focusAt(items.length - 1);
    const current = refs.current.findIndex((el) => el === document.activeElement);
    focusAt((current >= 0 ? current : rovingIndex) + (event.key === "ArrowDown" ? 1 : -1));
  }

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("flex w-[172px] flex-none flex-col border-e border-border-strong bg-surface text-ink", className)}
    >
      {/*
        The column stretches so its border runs the whole page, but its CONTENTS
        stick under row one: the column and the workspace-screens bar share a top
        edge (see `AppShell`), and a rail that scrolled away would leave that
        shared edge attached to a blank 172px strip. `--h-btn` is row one's own
        height — its tallest child sets it and the row carries no block padding.
      */}
      <div className="sticky top-[var(--h-btn)] flex flex-col py-[8px]">
        <div className="flex-none px-[14px] pb-[4px] pt-[8px] text-2xs font-semibold text-ink-faint">{heading}</div>

        <ul onKeyDown={onKeyDown}>
          {items.map((item, index) => {
            const active = item.key === activeKey;
            const setRef = (el: HTMLElement | null) => {
              refs.current[index] = el;
            };
            const activate = () => {
              item.onClick?.();
              onChange?.(item.key);
            };
            const classes = cn(ROW, active ? "bg-surface-2 font-semibold text-ink" : "text-ink");
            const content = (
              <>
                {/* Never colour alone: the open workspace also carries this
                    inline-start bar, the recessed fill and a heavier weight. */}
                {active ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[2px] bg-accent" /> : null}
                {item.icon ? <span className="flex-none">{item.icon}</span> : null}
                <span className="truncate">{item.label}</span>
              </>
            );

            return (
              <li key={item.key} className="flex">
                {item.href ? (
                  <a
                    ref={setRef}
                    href={item.href}
                    tabIndex={index === rovingIndex ? 0 : -1}
                    aria-current={active ? "page" : undefined}
                    className={cn(classes, "no-underline")}
                    onClick={activate}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    ref={setRef}
                    type="button"
                    tabIndex={index === rovingIndex ? 0 : -1}
                    aria-current={active ? "page" : undefined}
                    className={classes}
                    onClick={activate}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div aria-hidden className="mx-[12px] my-[8px] h-px flex-none bg-border" />

        <button type="button" onClick={onOpenAllScreens} className={cn(ROW, "text-ink-muted hover:text-ink")}>
          <span aria-hidden className="flex-none">
            ☰
          </span>
          <span className="truncate">{allScreensLabel}</span>
        </button>
      </div>
    </nav>
  );
}
