import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { useFormat } from "../hooks/useFormat";
import { useUiTranslation } from "../i18n";
import { SearchInput } from "../primitives/form";
import type { NavGroup, NavItem } from "./types";

/**
 * «كل الشاشات» — a real browse surface, not the command palette.
 *
 * Row two's button used to dispatch a synthetic ⌘K, which meant the ONLY way
 * to reach an unpinned screen was to already know its name and type it. That
 * is the exact objection that got the wordless icon spine rejected: a new
 * employee cannot recall a name they have never seen. This panel lists every
 * destination, grouped by workspace and then by the section structure the nav
 * config already carries (اليومي / البيانات الأساسية / التقارير / الإعدادات),
 * so browsing works without recall. Search narrows the same tree; it does not
 * replace it.
 *
 * It is a modal dialog, not a dropdown: a `position: fixed` overlay above the
 * whole page, so the sticky bar's `overflow-hidden` cannot clip it and no new
 * absolutely positioned popup is added inside the bar.
 */

const ALL_WORKSPACES = "__all__";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Row {
  /** Unique across the whole tree — an item may appear in two groups. */
  id: string;
  item: NavItem;
  groupKey: string;
  groupLabel: string;
  sectionLabel: string | null;
}

export interface AllScreensPanelProps {
  open: boolean;
  onClose: () => void;
  /** Every destination, in the same workspace/section shape the nav config carries. */
  groups: readonly NavGroup[];
  /** The screen currently on display — its row is marked `aria-current="page"`. */
  activeKey?: string;
  /**
   * Pre-selects one workspace's filter. Set when the panel is opened from a
   * workspace tab that has no hub of its own, so the click still lands on
   * that workspace's screens rather than on everything.
   */
  workspaceKey?: string | null;
  className?: string;
}

function rowsOf(group: NavGroup): Row[] {
  const out: Row[] = [];
  for (const item of group.items) {
    out.push({ id: `${group.key}:${item.key}`, item, groupKey: group.key, groupLabel: group.label, sectionLabel: null });
  }
  for (const section of group.sections ?? []) {
    for (const item of section.items) {
      out.push({
        id: `${group.key}:${section.key}:${item.key}`,
        item,
        groupKey: group.key,
        groupLabel: group.label,
        sectionLabel: section.label,
      });
    }
  }
  return out;
}

export function AllScreensPanel({ open, onClose, groups, activeKey, workspaceKey, className }: AllScreensPanelProps) {
  const { t } = useUiTranslation();
  const format = useFormat();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<string>(workspaceKey ?? ALL_WORKSPACES);

  // Each opening is its own visit: an old search string left in the field
  // would silently hide most of the tree the next time the panel is used.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setScope(workspaceKey ?? ALL_WORKSPACES);
    searchRef.current?.focus();
  }, [open, workspaceKey]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        restoreFocusRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const allRows = useMemo(() => groups.flatMap(rowsOf), [groups]);

  const countByGroup = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of allRows) map.set(row.groupKey, (map.get(row.groupKey) ?? 0) + 1);
    return map;
  }, [allRows]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      allRows.filter((row) => {
        if (scope !== ALL_WORKSPACES && row.groupKey !== scope) return false;
        if (normalizedQuery === "") return true;
        return (
          row.item.label.toLowerCase().includes(normalizedQuery) ||
          row.groupLabel.toLowerCase().includes(normalizedQuery) ||
          (row.sectionLabel?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      }),
    [allRows, scope, normalizedQuery],
  );

  /** The visible tree, rebuilt from the surviving rows so headings never outlive their contents. */
  const tree = useMemo(() => {
    const byGroup = new Map<string, { label: string; sections: Map<string, { label: string | null; rows: Row[] }> }>();
    for (const row of visibleRows) {
      const group = byGroup.get(row.groupKey) ?? { label: row.groupLabel, sections: new Map() };
      const sectionId = row.sectionLabel ?? "";
      const section = group.sections.get(sectionId) ?? { label: row.sectionLabel, rows: [] };
      section.rows.push(row);
      group.sections.set(sectionId, section);
      byGroup.set(row.groupKey, group);
    }
    return [...byGroup.entries()].map(([key, group]) => ({ key, label: group.label, sections: [...group.sections.values()] }));
  }, [visibleRows]);

  /** Document order of the rendered rows — what the arrow keys walk. */
  const flatOrder = useMemo(() => tree.flatMap((group) => group.sections.flatMap((section) => section.rows)), [tree]);

  function focusRow(index: number) {
    if (flatOrder.length === 0) return;
    const wrapped = ((index % flatOrder.length) + flatOrder.length) % flatOrder.length;
    rowRefs.current[wrapped]?.focus();
  }

  // A VERTICAL list: ArrowUp/ArrowDown carry the same meaning in both
  // directions, so — unlike the workspace strip — nothing is inverted here.
  function onRowsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = rowRefs.current.findIndex((el) => el === document.activeElement);
    if (event.key === "Home") return focusRow(0);
    if (event.key === "End") return focusRow(flatOrder.length - 1);
    const from = current >= 0 ? current : -1;
    focusRow(from + (event.key === "ArrowDown" ? 1 : -1));
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    focusRow(0);
  }

  function choose(row: Row) {
    row.item.onClick?.();
    onClose();
  }

  if (!open) return null;

  let rowIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-scrim p-[24px]"
      onMouseDown={() => {
        onClose();
        restoreFocusRef.current?.focus();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          "flex max-h-[calc(100vh-48px)] w-full max-w-[1000px] flex-col border border-border-strong bg-surface text-ink shadow-2",
          className,
        )}
      >
        <div className="flex flex-none flex-wrap items-center gap-[12px] border-b border-border px-[18px] py-[12px]">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="mz-disp text-lg font-bold text-ink">
              {t("shell.rail.all")}
            </h2>
            <p className="mt-[2px] text-xs text-ink-muted">{t("shell.all.description")}</p>
          </div>
          <SearchInput
            ref={searchRef}
            value={query}
            onValueChange={setQuery}
            onKeyDown={onSearchKeyDown}
            aria-label={t("shell.all.search")}
            placeholder={t("shell.all.search")}
            className="h-[var(--h-btn)] w-[300px] max-w-full"
          />
          <button
            type="button"
            onClick={() => {
              onClose();
              restoreFocusRef.current?.focus();
            }}
            aria-label={t("shell.all.close")}
            className="flex min-h-[var(--h-btn)] min-w-[var(--h-btn)] flex-none items-center justify-center border border-border-strong bg-bg text-ink-muted hover:bg-surface-2 hover:text-ink"
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[16px] w-[16px]">
              <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label={t("shell.all.filter")}
            className="w-[228px] flex-none overflow-y-auto border-e border-border bg-surface-2 py-[8px] max-[820px]:hidden"
          >
            <ul>
              {[{ key: ALL_WORKSPACES, label: t("shell.all.everyWorkspace"), count: allRows.length }, ...groups.map((group) => ({
                key: group.key,
                label: group.label,
                count: countByGroup.get(group.key) ?? 0,
              }))].map((entry) => {
                const selected = entry.key === scope;
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setScope(entry.key)}
                      className={cn(
                        "relative flex min-h-[var(--h-btn)] w-full items-center justify-between gap-[8px] px-[14px] text-start text-sm transition-colors",
                        selected ? "bg-bg font-semibold text-accent" : "text-ink hover:bg-surface-3",
                      )}
                    >
                      {/* Never colour alone: the chosen workspace also carries this edge bar and a heavier weight. */}
                      {selected ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[3px] bg-accent" /> : null}
                      <span className="truncate">{entry.label}</span>
                      <span className="mz-num flex-none text-2xs text-ink-faint">{format.number(entry.count)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-[14px_18px]" onKeyDown={onRowsKeyDown}>
            {flatOrder.length === 0 ? (
              <p className="p-[24px] text-center text-sm text-ink-muted">{t("shell.all.empty")}</p>
            ) : (
              tree.map((group) => (
                <section key={group.key} className="mb-[18px] last:mb-0">
                  <h3 className="border-b border-border pb-[6px] text-sm font-bold text-ink">{group.label}</h3>
                  {group.sections.map((section) => (
                    <div key={section.label ?? "__direct__"} className="mt-[10px]">
                      {section.label ? (
                        <h4 className="pb-[4px] text-2xs font-semibold text-ink-faint">{section.label}</h4>
                      ) : null}
                      <ul>
                        {section.rows.map((row) => {
                          rowIndex += 1;
                          const index = rowIndex;
                          const active = row.item.key === activeKey;
                          return (
                            <li key={row.id}>
                              <button
                                ref={(el) => {
                                  rowRefs.current[index] = el;
                                }}
                                type="button"
                                tabIndex={index === 0 ? 0 : -1}
                                aria-current={active ? "page" : undefined}
                                onClick={() => choose(row)}
                                onPointerEnter={row.item.onIntent}
                                onFocus={row.item.onIntent}
                                className={cn(
                                  "relative flex min-h-[var(--h-btn)] w-full items-center gap-[9px] px-[10px] text-start text-sm transition-colors hover:bg-surface-2",
                                  active ? "bg-accent-soft font-semibold text-accent" : "text-ink",
                                )}
                              >
                                {active ? <span aria-hidden className="absolute bottom-0 start-0 top-0 w-[3px] bg-accent" /> : null}
                                {row.item.icon ? <span className="flex-none">{row.item.icon}</span> : null}
                                <span className="truncate">{row.item.label}</span>
                                {row.item.tag ? (
                                  <span className="mz-num flex-none border border-border-strong px-[5px] text-2xs text-ink-muted">
                                    {row.item.tag.label}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>

        <p className="flex-none border-t border-border px-[18px] py-[8px] text-2xs text-ink-faint">
          <span className="mz-num">{format.number(flatOrder.length)}</span> · {t("shell.all.countSuffix")}
        </p>
      </div>
    </div>
  );
}
