import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import type { NavItem } from "./types";

export interface WorkspaceTabsProps {
  items: readonly NavItem[];
  activeKey?: string;
  onChange?: (key: string) => void;
  ariaLabel: string;
  /** Reading direction of the strip. Inverts the arrow keys — see `step()`. */
  direction: "rtl" | "ltr";
  className?: string;
}

/**
 * IN RTL THE ARROW KEYS INVERT. The physical key does not move — its meaning
 * does: on an RTL strip the previous item is drawn to the RIGHT of the current
 * one, so ArrowRight must step BACK (-1) and ArrowLeft FORWARD (+1). Reversing
 * this is the single most common RTL keyboard defect; do not "simplify" it.
 */
function step(key: string, rtl: boolean): number {
  if (key === "ArrowRight") return rtl ? -1 : 1;
  if (key === "ArrowLeft") return rtl ? 1 : -1;
  return 0;
}

/**
 * Row one of the top bar: the six workspaces as labelled tabs. Roving
 * tabindex — the strip is one Tab stop and the arrow keys move within it —
 * and focus only: arrowing does not switch workspace, Enter/Space does.
 */
export function WorkspaceTabs({ items, activeKey, onChange, ariaLabel, direction, className }: WorkspaceTabsProps) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const rtl = direction === "rtl";

  const activeIndex = items.findIndex((item) => item.key === activeKey);
  const rovingIndex = activeIndex >= 0 ? activeIndex : 0;

  function focusAt(index: number) {
    const count = items.length;
    if (count === 0) return;
    const wrapped = ((index % count) + count) % count;
    refs.current[wrapped]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (items.length === 0) return;
    const current = refs.current.findIndex((el) => el === document.activeElement);
    const from = current >= 0 ? current : rovingIndex;

    if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusAt(items.length - 1);
      return;
    }
    const delta = step(event.key, rtl);
    if (delta === 0) return;
    event.preventDefault();
    focusAt(from + delta);
  }

  return (
    <nav aria-label={ariaLabel} className={cn("flex min-w-0 flex-none items-center", className)}>
      <ul className="flex items-center" onKeyDown={onKeyDown}>
        {items.map((item, index) => {
          const active = item.key === activeKey;
          const tabIndex = index === rovingIndex ? 0 : -1;
          const setRef = (el: HTMLElement | null) => {
            refs.current[index] = el;
          };
          const activate = () => {
            item.onClick?.();
            onChange?.(item.key);
          };
          const className = cn(
            "relative flex h-[var(--h-ws)] items-center whitespace-nowrap px-[15px] text-sm no-underline",
            "max-[1180px]:px-[10px] max-[1024px]:text-xs max-[900px]:px-[8px]",
            active
              ? "bg-bg font-semibold text-ink"
              : "font-normal text-chrome-ink-muted hover:bg-chrome-hover hover:text-chrome-ink",
          );
          const content: ReactNode = (
            <>
              {/* Colour is never the only signal: the active tab also carries this
                  edge bar and a heavier weight. */}
              {active ? <span aria-hidden className="absolute start-0 end-0 top-0 h-[3px] bg-accent" /> : null}
              {item.icon ? <span className="me-[7px] flex-none">{item.icon}</span> : null}
              {item.label}
            </>
          );

          return (
            <li key={item.key} className="flex">
              {item.href ? (
                <a
                  ref={setRef}
                  href={item.href}
                  tabIndex={tabIndex}
                  aria-current={active ? "page" : undefined}
                  className={className}
                  onClick={activate}
                >
                  {content}
                </a>
              ) : (
                <button
                  ref={setRef}
                  type="button"
                  tabIndex={tabIndex}
                  aria-current={active ? "page" : undefined}
                  className={className}
                  onClick={activate}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
