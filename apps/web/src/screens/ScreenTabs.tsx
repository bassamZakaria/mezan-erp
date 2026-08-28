import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { RowMenu } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { useSubPage } from "../navigation";

/**
 * A tab strip that ADDRESSES: the open tab is the screen's first URL segment,
 * so `#/stock/items/templates` opens on القوالب and a reload, a bookmark or a
 * Back press all land where the user was. The first tab is the bare screen
 * (`#/stock/items`) rather than `.../items`, so the default address stays the
 * one every existing link already uses.
 *
 * Use it where one SUBJECT was split across sibling nav entries — الأصناف and
 * its templates, a report and its other views. It is not for a document's own
 * detail tabs; `DocumentDetail` already owns those.
 *
 * IN RTL THE ARROW KEYS INVERT — the physical key does not move, its meaning
 * does: on an RTL strip the previous tab is drawn to the RIGHT, so ArrowRight
 * steps BACK. Same rule as the workspace screens bar; do not "simplify" it.
 */

export interface ScreenTab {
  readonly key: string;
  readonly label: string;
  /** A render function, not a node: only the open tab's body is ever built. */
  readonly render: () => ReactNode;
}

export interface ScreenTabsProps {
  readonly tabs: readonly ScreenTab[];
  readonly ariaLabel: string;
  /**
   * How many tabs stay on the strip. The rest fold into a «…» menu — they are
   * still tabs, still addressed, still one click away, they just stop
   * competing for attention with the one the screen is named after. The OPEN
   * tab is always on the strip whatever this says, so the way back from a
   * folded tab is never hidden inside the menu that opened it.
   */
  readonly primaryCount?: number;
  /** Accessible name for that menu — «المزيد من أقسام الأصناف». */
  readonly moreLabel?: string;
}

export function ScreenTabs({ tabs, ariaLabel, primaryCount, moreLabel }: ScreenTabsProps) {
  const { direction } = useAppTranslation();
  const { segments, open, close } = useSubPage();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // An unknown segment is the default tab, not an empty page: a stale link to
  // a tab that no longer exists still lands on the subject it named.
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === segments[0]),
  );
  const active = tabs[activeIndex] ?? tabs[0];

  function select(index: number) {
    const tab = tabs[index];
    if (!tab) return;
    if (index === 0) close();
    else open(tab.key);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = direction === "rtl";
    const delta = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    if (delta === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : ((activeIndex + delta) % tabs.length + tabs.length) % tabs.length;
    select(next);
    refs.current[next]?.focus();
  }

  const shown = primaryCount === undefined ? tabs.length : Math.max(1, primaryCount);
  const stripTabs = tabs.filter((tab, index) => index < shown || index === activeIndex);
  const foldedTabs = tabs.filter((tab, index) => index >= shown && index !== activeIndex);

  return (
    <div className="flex w-full flex-col gap-[16px]">
      <div role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className="flex flex-wrap items-center gap-[6px] border-b border-border pb-[10px]">
        {stripTabs.map((tab) => {
          const index = tabs.indexOf(tab);
          const selected = index === activeIndex;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              // One Tab stop for the strip; the arrow keys walk the rest.
              tabIndex={selected ? 0 : -1}
              onClick={() => select(index)}
              className={
                selected
                  ? "inline-flex min-h-[var(--h-btn)] items-center rounded-md border border-accent bg-accent-soft px-[14px] text-xs font-semibold text-accent"
                  : "inline-flex min-h-[var(--h-btn)] items-center rounded-md border border-border-strong bg-surface px-[14px] text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              }
            >
              {tab.label}
            </button>
          );
        })}

        {foldedTabs.length > 0 ? (
          <RowMenu
            // The strip sits at the page's inline start, so the panel has to
            // open away from that edge rather than back across it.
            align="start"
            label={moreLabel ?? ariaLabel}
            items={foldedTabs.map((tab) => ({
              key: tab.key,
              label: tab.label,
              onSelect: () => select(tabs.indexOf(tab)),
            }))}
          />
        ) : null}
      </div>

      <div role="tabpanel">{active?.render()}</div>
    </div>
  );
}
